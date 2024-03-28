import React, { useState, useMemo } from 'react';
import { filterResources } from './utils.js';
import { Source } from "./Source"
import FilterBar from "./FilterBar";

export function Sources(props) {
  const { capacitorClient, fluxState, targetReference } = props
  const [filterErrors, setFilterErrors] = useState(false)
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

  const filteredSources = filterResources(sortedSources, filters, filterErrors)

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
