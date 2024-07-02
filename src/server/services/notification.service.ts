import { NotificationCategory, Prisma } from '@prisma/client';
import { dbRead, dbWrite } from '~/server/db/client';
import { notifDbRead, notifDbWrite } from '~/server/db/notifDb';
import { NotificationPendingRow } from '~/server/jobs/send-notifications';
import { populateNotificationDetails } from '~/server/notifications/detail-fetchers';
import {
  notificationCache,
  NotificationCategoryCount,
} from '~/server/notifications/notification-cache';
import {
  GetUserNotificationsSchema,
  MarkReadNotificationInput,
  ToggleNotificationSettingInput,
} from '~/server/schema/notification.schema';
import { BlockedByUsers, BlockedUsers } from '~/server/services/user-preferences.service';
import { DEFAULT_PAGE_SIZE } from '~/server/utils/pagination-helpers';

type NotificationsRaw = {
  id: number;
  type: string;
  category: NotificationCategory;
  details: MixedObject;
  createdAt: Date;
  read: boolean;
};

export const createNotification = async (
  data: Omit<NotificationPendingRow, 'users'> & {
    userId?: number;
    userIds?: number[];
  }
) => {
  if (!data.userIds) data.userIds = [];
  if (data.userId) data.userIds.push(data.userId);
  if (data.userIds.length === 0) return;

  const userNotificationSettings = await dbRead.userNotificationSettings.findMany({
    where: { userId: { in: data.userIds }, type: data.type },
  });
  const blockedUsers = await Promise.all([
    BlockedUsers.getCached({ userId: data.userId }),
    BlockedByUsers.getCached({ userId: data.userId }),
  ]);
  const blocked = [...new Set([...blockedUsers].flatMap((x) => x.map((u) => u.id)))];
  const targets = data.userIds.filter(
    (x) => !userNotificationSettings.some((y) => y.userId === x) && !blocked.includes(x)
  );
  // If the user has this notification type disabled, don't create a notification.
  if (targets.length === 0) return;

  await notifDbWrite.cancellableQuery(Prisma.sql`
    INSERT INTO "PendingNotification" (key, type, category, users, details)
    VALUES
      (${data.key},
       ${data.type},
       ${data.category}::"NotificationCategory",
       ${targets},
       ${JSON.stringify(data.details)}::jsonb)
    ON CONFLICT DO NOTHING
  `);
};

export async function getUserNotifications({
  limit = DEFAULT_PAGE_SIZE,
  cursor,
  userId,
  category,
  count = false,
  unread = false,
}: Partial<GetUserNotificationsSchema> & {
  userId: number;
  count?: boolean;
}) {
  const AND = [Prisma.sql`un."userId" = ${userId}`];
  if (unread) AND.push(Prisma.sql`un.viewed IS FALSE`);
  if (category) AND.push(Prisma.sql`n.category = ${category}::"NotificationCategory"`);

  if (cursor) AND.push(Prisma.sql`un."createdAt" < ${cursor}`);
  else AND.push(Prisma.sql`un."createdAt" > NOW() - interval '1 month'`);

  const query = await notifDbRead.cancellableQuery<NotificationsRaw>(`
    SELECT un.id, n.type, n.category, n.details, un."createdAt", un.viewed as read 
    FROM "UserNotification" un
    JOIN "Notification" n ON n."id" = un."notificationId"
    WHERE ${Prisma.join(AND, ' AND ')}
    ORDER BY un."createdAt" DESC
    LIMIT ${limit}
  `);
  const items = await query.result();

  await populateNotificationDetails(items);

  if (count) return { items, count: await getUserNotificationCount({ userId, unread }) };

  return { items };
}

export async function getUserNotificationCount({
  userId,
  unread,
  category,
}: {
  userId: number;
  unread: boolean;
  category?: NotificationCategory;
}) {
  const cachedCount = await notificationCache.getUser(userId);
  if (cachedCount) return cachedCount;

  const AND = [Prisma.sql`un."userId" = ${userId}`];
  if (unread) AND.push(Prisma.sql`un.viewed IS FALSE`);
  else AND.push(Prisma.sql`un."createdAt" > NOW() - interval '1 month'`);

  if (category) AND.push(Prisma.sql`n.category = ${category}::"NotificationCategory"`);

  const query = await notifDbRead.cancellableQuery<NotificationCategoryCount>(`
    SELECT n.category, count(*) as count
    FROM "UserNotification" un
    JOIN "Notification" n ON n."id" = un."notificationId"
    WHERE ${Prisma.join(AND, ' AND ')}
    GROUP BY category
  `);

  const result = await query.result();
  await notificationCache.setUser(userId, result);
  return result;
}

export const markNotificationsRead = async ({
  id,
  userId,
  all = false,
  category,
}: MarkReadNotificationInput & { userId: number }) => {
  if (all) {
    const AND = [
      Prisma.sql`un."notificationId" = n.id`,
      Prisma.sql`un."userId" = ${userId}`,
      Prisma.sql`un.viewed IS FALSE`,
    ];
    if (category) AND.push(Prisma.sql`n."category" = ${category}::"NotificationCategory"`);

    await notifDbWrite.query(`
      UPDATE "UserNotification" un
      SET viewed = true
      FROM "Notification" n
      WHERE ${Prisma.join(AND, ' AND ')}
    `);

    // Update cache
    if (category) await notificationCache.clearCategory(userId, category);
    else await notificationCache.bustUser(userId);
  } else {
    const resp = await notifDbWrite.query(`
      UPDATE "UserNotification" un
      SET viewed = true
      WHERE id = ${id} and viewed IS FALSE
    `);

    // Update cache if the notification was marked read
    if (resp.rowCount) {
      const catQuery = await notifDbRead.cancellableQuery<{ category: NotificationCategory }>(`
        SELECT n.category
        FROM "UserNotification" un JOIN "Notification" n ON un."notificationId" = n.id
        WHERE un.id = ${id}
      `);
      const catData = await catQuery.result();
      if (catData && catData.length)
        await notificationCache.decrementUser(userId, catData[0].category);
    }
  }
};

export const createUserNotificationSetting = async ({
  type,
  userId,
}: ToggleNotificationSettingInput & { userId: number }) => {
  const values = type.map((t) => Prisma.sql`(${t}, ${userId})`);
  return dbWrite.$executeRaw`
    INSERT INTO "UserNotificationSettings" ("type", "userId") VALUES
    ${Prisma.join(values)}
    ON CONFLICT DO NOTHING
  `;
};

export const deleteUserNotificationSetting = async ({
  type,
  userId,
}: ToggleNotificationSettingInput & { userId: number }) => {
  return dbWrite.userNotificationSettings.deleteMany({ where: { type: { in: type }, userId } });
};
