import React, { useState, useMemo, useEffect } from 'react';
import { filterResources } from './utils.js';
import { Source } from "./Source"
import FilterBar from "./FilterBar";

const getSourcesFilters = () => {
  try {
    return JSON.parse(localStorage.getItem("sourcesFilters")) || [];
  } catch (error) {
    return [];
  }
};

export function Sources({ capacitorClient, fluxState, targetReference, handleNavigationSelect }) {
  const [filters, setFilters] = useState(getSourcesFilters())
  const sortedSources = useMemo(() => {
    const sources = [];
    if (fluxState.ociRepositories) {
      sources.push(...fluxState.ociRepositories)
      sources.push(...fluxState.gitRepositories)
      sources.push(...fluxState.buckets)
      sources.push(...fluxState.helmRepositories)
      sources.push(...fluxState.helmCharts)
    }
    return [...sources].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
  }, [fluxState]);

  const filteredSources = filterResources(sortedSources, filters)

  useEffect(() => {
        localStorage.setItem("sourcesFilters", JSON.stringify(filters));
      }, [JSON.stringify(filters)])

  return (
    <div className="space-y-4">
      <FilterBar
        properties={["Name", "Namespace", "Errors"]}
        filters={filters}
        change={setFilters}
      />
      {
        filteredSources?.map(source =>
          <Source
            key={"source-" + source.metadata.namespace + source.metadata.name}
            capacitorClient={capacitorClient}
            source={source}
            targetReference={targetReference}
            handleNavigationSelect={handleNavigationSelect}
          />
        )
      }
    </div>
  )
}
