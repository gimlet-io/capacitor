import React, { useMemo, useState, useEffect } from 'react';
import { HelmRelease } from "./HelmRelease"
import { filterResources } from './utils.js';
import FilterBar from './FilterBar';

const getHelmReleasesFilters = () => {
  try {
    return JSON.parse(localStorage.getItem("helmReleasesFilters")) || [];
  } catch (error) {
    return [];
  }
};

export function HelmReleases({ capacitorClient, helmReleases, targetReference, handleNavigationSelect }) {
  const [filters, setFilters] = useState(getHelmReleasesFilters())
  const sortedHelmReleases = useMemo(() => {
    if (!helmReleases) return null;

    return [...helmReleases].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
  }, [helmReleases]);

  const filteredHelmReleases = filterResources(sortedHelmReleases, filters)

    useEffect(() => {
      localStorage.setItem("helmReleasesFilters", JSON.stringify(filters));
    }, [JSON.stringify(filters)])

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