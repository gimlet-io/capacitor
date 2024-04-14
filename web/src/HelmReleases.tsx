import React, { useMemo, useState } from 'react';
import { HelmRelease } from "./HelmRelease.tsx"
import { filterResources } from './utils.ts';
import FilterBar from "./FilterBar.tsx";
import { FilterType } from './types/filterType.ts';

export type HelmReleasesProps = {
  helmReleases: any;
  targetReference: any;
  handleNavigationSelect: any;
}
export function HelmReleases(props: HelmReleasesProps) {
  const {  helmReleases, targetReference, handleNavigationSelect } = props
  const [filters, setFilters] = useState<FilterType[]>([])
  const sortedHelmReleases = useMemo(() => {
    if (!helmReleases) {
      return null;
    }

    return [...helmReleases].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
  }, [helmReleases]);

  const filteredHelmReleases = filterResources(sortedHelmReleases, filters)

  return (
    <div className="space-y-4">
      <FilterBar
        properties={["Name", "Namespace", "Errors"]}
        filters={filters}
        change={setFilters}
      />
      {
        filteredHelmReleases?.map(helmRelease =>
          <HelmRelease
            key={"hr-" + helmRelease.metadata.namespace + helmRelease.metadata.name}
            item={helmRelease}
            handleNavigationSelect={handleNavigationSelect}
            targetReference={targetReference}
          />
        )}
    </div>
  )
}