import React, { useMemo, useState } from 'react';
import { HelmRelease } from "./HelmRelease"
import { filterResources } from './utils.js';
import FilterBar from './FilterBar.js';

export function HelmReleases(props) {
  const { capacitorClient, helmReleases, targetReference, handleNavigationSelect } = props
  const [filters, setFilters] = useState([])
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
            capacitorClient={capacitorClient}
            item={helmRelease}
            handleNavigationSelect={handleNavigationSelect}
            targetReference={targetReference}
          />
        )}
    </div>
  )
}