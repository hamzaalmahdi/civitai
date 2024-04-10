import {
  Button,
  Group,
  Stack,
  Text,
  Tooltip,
  TooltipProps,
  ActionIcon,
  Grid,
  Avatar,
  Modal,
  Divider,
  Center,
  Loader,
  Box,
  Input,
  Select,
  SelectItemProps,
  Paper,
} from '@mantine/core';
import React, { forwardRef, useEffect, useMemo, useState } from 'react';

import {
  Form,
  InputDatePicker,
  InputNumber,
  InputRTE,
  InputSwitch,
  InputText,
  useForm,
} from '~/libs/form';
import { z } from 'zod';
import { CosmeticGetById, CosmeticShopItemGetById } from '~/types/router';
import { showSuccessNotification } from '~/utils/notifications';
import { useDialogContext } from '~/components/Dialog/DialogProvider';
import { useMutateCosmeticShop } from '~/components/CosmeticShop/cosmetic-shop.util';
import { useQueryCosmeticsPaged } from '~/components/Cosmetics/cosmetics.util';
import { GetPaginatedCosmeticsInput } from '~/server/schema/cosmetic.schema';
import { useDebouncedValue } from '@mantine/hooks';
import { upsertCosmeticShopItemInput } from '~/server/schema/cosmetic-shop.schema';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { trpc } from '~/utils/trpc';
import { CosmeticSample } from '~/pages/moderator/cosmetic-store/cosmetics';
import { CurrencyIcon } from '~/components/Currency/CurrencyIcon';
import { IconCalendar } from '@tabler/icons-react';
import { IconCalendarDue } from '@tabler/icons-react';
import { isDefined } from '~/utils/type-guards';

const formSchema = upsertCosmeticShopItemInput;

type Props = {
  shopItem?: CosmeticShopItemGetById;
  onSuccess?: () => void;
  onCancel?: () => void;
};

type CosmeticSearchSelectItemProps = { name: string; description: string } & SelectItemProps;

const CosmeticSearchSelectItem = forwardRef<HTMLDivElement, CosmeticSearchSelectItemProps>(
  ({ name, description, ...others }: CosmeticSearchSelectItemProps, ref) => (
    <div ref={ref} {...others}>
      <Stack spacing={0}>
        <Text size="sm">{name}</Text>
        <Text size="xs" color="dimmed">
          {description}
        </Text>
      </Stack>
    </div>
  )
);

CosmeticSearchSelectItem.displayName = 'CosmeticSearchSelectItem';

const CosmeticSearch = ({
  cosmetic,
  onCosmeticSelected,
}: {
  cosmetic?: CosmeticGetById;
  onCosmeticSelected: (id: number) => void;
}) => {
  const [filters, setFilters] = useState<Omit<GetPaginatedCosmeticsInput, 'limit'>>({
    page: 1,
  });
  const [debouncedFilters, cancel] = useDebouncedValue(filters, 500);
  const { cosmetics, isLoading: isLoadingCosmetics } = useQueryCosmeticsPaged(debouncedFilters);
  const data = useMemo(
    () =>
      [cosmetic, ...cosmetics].filter(isDefined).map((c) => ({
        value: c.id.toString(),
        label: c.name,
        name: c.name,
        description: c.description,
      })),
    [cosmetics, cosmetic]
  );

  return (
    <Select
      label="Cosmetic"
      description="Select a cosmetic to make it available in the shop"
      onChange={(cosmeticId: string) => onCosmeticSelected(Number(cosmeticId))}
      onSearchChange={(query) => setFilters({ ...filters, name: query })}
      searchValue={filters.name}
      nothingFound="No options"
      itemComponent={CosmeticSearchSelectItem}
      data={data}
      searchable
      withAsterisk
      value={cosmetic?.id.toString() ?? ''}
    />
  );
};

export const CosmeticShopItemUpsertForm = ({ shopItem, onSuccess, onCancel }: Props) => {
  const currentUser = useCurrentUser();
  const form = useForm({
    schema: formSchema,
    defaultValues: {
      ...shopItem,
    },
    shouldUnregister: false,
  });

  const [title, description, cosmeticId] = form.watch(['title', 'description', 'cosmeticId']);
  const { data: cosmetic, isLoading: isLoadingCosmetic } = trpc.cosmetic.getById.useQuery(
    {
      id: cosmeticId,
    },
    {
      enabled: !!cosmeticId,
    }
  );

  const { updateUpsertShopItem, upsertingShopItem } = useMutateCosmeticShop();

  const handleSubmit = async (data: z.infer<typeof formSchema>) => {
    try {
      await updateUpsertShopItem({
        ...data,
      });

      if (!data.id) {
        form.reset();
      }

      onSuccess?.();
    } catch (error) {
      // Do nothing since the query event will show an error notification
    }
  };

  useEffect(() => {
    if (cosmetic && (!title || !description)) {
      // Resource changed, change our data. Fallback to current data if resource data is not available
      form.setValue('title', cosmetic.name || title);
      form.setValue('description', `<p>${cosmetic.description || description}</p>`);
    }
  }, [cosmetic]);

  return (
    <Form form={form} onSubmit={handleSubmit}>
      <Stack spacing="md">
        <Stack spacing="md">
          {!shopItem && (
            <CosmeticSearch
              cosmetic={cosmetic ?? undefined}
              onCosmeticSelected={(newCosmeticId) => form.setValue('cosmeticId', newCosmeticId)}
            />
          )}
          {cosmetic && (
            <Paper radius="md" withBorder p="md">
              <Stack>
                <Text color="dimmed" weight="bold">
                  The following cosmetic will be made into a shop product
                </Text>
                <Divider mx="-md" />
                <Group>
                  <CosmeticSample cosmetic={cosmetic} />
                  <Stack spacing={0}>
                    <Text>{cosmetic.name}</Text>
                    <Text color="dimmed" size="sm">
                      {cosmetic.description}
                    </Text>
                  </Stack>
                </Group>
              </Stack>
            </Paper>
          )}
          <InputText
            name="title"
            label="Title"
            description="This title will be shown in the shop. It can be different from the cosmetic's original name"
            withAsterisk
          />
          <InputRTE
            name="description"
            description="This description will be shown in the shop"
            label="Content"
            editorSize="xl"
            includeControls={['heading', 'formatting', 'list', 'link', 'media', 'colors']}
            withAsterisk
            stickyToolbar
          />
          <Group spacing="md" grow>
            <InputNumber
              name="unitAmount"
              label="Price"
              description="The amount of buzz required to purchase 1 instance of this item"
              min={500}
              step={100}
              icon={<CurrencyIcon currency="BUZZ" size={16} />}
              format={undefined}
              withAsterisk
            />
            <InputNumber
              name="availableQuantity"
              label="Available Quantity"
              description="The amount of this item available for purchase. Leave empty for unlimited"
              clearable
            />
          </Group>
          <Group spacing="md" grow>
            <InputDatePicker
              name="availableFrom"
              label="Available From"
              placeholder="Select a start date"
              icon={<IconCalendar size={16} />}
              clearable
            />
            <InputDatePicker
              name="availableTo"
              label="Available To"
              placeholder="Select an end date"
              icon={<IconCalendarDue size={16} />}
              clearable
            />
          </Group>
        </Stack>
        <Group position="right">
          {onCancel && (
            <Button
              loading={upsertingShopItem}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCancel?.();
              }}
              color="gray"
            >
              Cancel
            </Button>
          )}
          <Button loading={upsertingShopItem} type="submit">
            Save
          </Button>
        </Group>
      </Stack>
    </Form>
  );
};
