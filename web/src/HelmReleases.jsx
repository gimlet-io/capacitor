import React, { useMemo, useState } from 'react';
import { HelmRelease } from "./HelmRelease"
import { filterResources } from './utils.js';
import FilterBar from './FilterBar.js';

export function HelmReleases(props) {
  const { capacitorClient, helmReleases, targetReference, handleNavigationSelect } = props
  const [filterErrors, setFilterErrors] = useState(false)
  const [filters, setFilters] = useState([])
  const sortedHelmReleases = useMemo(() => {
    if (!helmReleases) {
      return null;
    }

    return [...helmReleases].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
  }, [helmReleases]);

  const filteredHelmReleases = filterResources(sortedHelmReleases, filters, filterErrors)

  return (
    <div className="space-y-4">
      <FilterBar
        properties={["Name", "Namespace"]}
        filters={filters}
        change={setFilters}
      />
      <button className={(filterErrors ? "text-blue-50 bg-blue-600" : "bg-gray-50 text-gray-600") + " rounded-full px-3"}
        onClick={() => setFilterErrors(!filterErrors)}
      >
        Filter errors
      </button>
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