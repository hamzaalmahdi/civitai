import { NextApiRequest, NextApiResponse } from 'next';
import { getGetUrl } from '~/utils/s3-utils';
import { UserActivityType } from '@prisma/client';
import { getServerAuthSession } from '~/server/common/get-server-auth-session';
import { prisma } from '~/server/db/client';

export default async function downloadModel(req: NextApiRequest, res: NextApiResponse) {
  const modelVersionId = req.query.modelVersionId as string;
  if (!modelVersionId) {
    return res.status(400).json({ error: 'Missing modelVersionId' });
  }

  const modelVersion = await prisma.modelVersion.findFirst({
    where: { id: parseInt(modelVersionId) },
    select: { model: { select: { id: true, name: true } }, name: true, url: true },
  });
  if (!modelVersion) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const session = await getServerAuthSession({ req, res });
  const userId = session?.user?.id;
  if (!userId) {
    if (req.headers['content-type'] === 'application/json')
      return res.status(401).json({ error: 'Unauthorized' });
    else return res.redirect(`/login?returnUrl=/models/${modelVersion.model.id}`);
  }

  // Track activity
  try {
    await prisma.userActivity.create({
      data: {
        userId,
        activity: UserActivityType.ModelDownload,
        details: { modelId: modelVersion.model.id, modelVersionId },
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Invalid database operation', cause: error });
  }

  const { url } = await getGetUrl(modelVersion.url);

  res.redirect(url);
}
