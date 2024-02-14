import { useContext, createContext, ReactNode, useMemo, useDeferredValue } from 'react';
import { useBrowsingLevel } from '~/components/BrowsingLevel/BrowsingLevelProvider';
import { getIsPublicBrowsingLevel } from '~/components/BrowsingLevel/browsingLevel.utils';

import { useQueryHiddenPreferences } from '~/hooks/hidden-preferences';
import { NsfwLevel } from '~/server/common/enums';
import { Flags } from '~/shared/utils';

type HiddenPreferencesState = {
  users: Map<number, boolean>;
  tags: Map<number, boolean>;
  models: Map<number, boolean>;
  images: Map<number, boolean>;
  isLoading: boolean;
  browsingLevel: number;
  isSfw: boolean;
};

const HiddenPreferencesContext = createContext<HiddenPreferencesState | null>(null);
export const useHiddenPreferencesContext = () => {
  const context = useContext(HiddenPreferencesContext);
  if (!context)
    throw new Error('useHiddenPreferences can only be used inside HiddenPreferencesProvider');
  return context;
};

export const HiddenPreferencesProvider = ({
  children,
  browsingLevel: browsingLevelOverride,
}: {
  children: ReactNode;
  browsingLevel?: NsfwLevel[];
}) => {
  const browsingLevelGlobal = useBrowsingLevel();
  const browsingLevel = browsingLevelOverride?.length
    ? Flags.arrayToInstance(browsingLevelOverride)
    : browsingLevelGlobal;
  const { data, isLoading } = useQueryHiddenPreferences();

  const hidden = useMemo(() => {
    const tags = new Map(
      data.tag
        .filter((x) => !x.nsfwLevel || !Flags.hasFlag(browsingLevel, x.nsfwLevel))
        .map((x) => [x.id, true])
    );

    const images = new Map(
      data.image.filter((x) => !x.tagId || tags.get(x.tagId)).map((x) => [x.id, true])
    );

    return {
      users: new Map(data.user.map((x) => [x.id, true])),
      models: new Map(data.model.map((x) => [x.id, true])),
      tags,
      images,
      isLoading,
      browsingLevel,
      isSfw: getIsPublicBrowsingLevel(browsingLevel),
    };
  }, [data, browsingLevel, isLoading]);

  const hiddenDeferred = useDeferredValue(hidden);

  return (
    <HiddenPreferencesContext.Provider value={hiddenDeferred}>
      {children}
    </HiddenPreferencesContext.Provider>
  );
};
