import React, { useState, useMemo } from 'react';
import { filterResources } from './utils.js';
import { Source } from "./Source"
import FilterBar from "./FilterBar";

export function Sources(props) {
  const { capacitorClient, fluxState, targetReference } = props
  const [filters, setFilters] = useState([])
  const sortedSources = useMemo(() => {
    const sources = [];
    if (fluxState.ociRepositories) {
      sources.push(...fluxState.ociRepositories)
      sources.push(...fluxState.gitRepositories)
      sources.push(...fluxState.buckets)
    }
    return [...sources].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
  }, [fluxState]);

  const filteredSources = filterResources(sortedSources, filters)

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
          />
        )
      }
    </div>
  )
}
