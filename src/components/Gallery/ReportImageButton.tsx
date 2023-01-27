import React, { cloneElement } from 'react';
import { useRoutedContext } from '~/routed-context/routed-context.provider';
import { ReportEntity } from '~/server/schema/report.schema';

export const ReportImageButton = ({
  children,
  imageId,
}: {
  children: React.ReactElement;
  imageId: number;
}) => {
  const { openContext } = useRoutedContext();

  const handleClick = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openContext('report', { type: ReportEntity.Image, entityId: imageId });
  };

  return cloneElement(children, { onClick: handleClick });
};
