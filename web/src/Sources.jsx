import React, { useState, useMemo } from 'react';
import { filterResources } from './utils.js';
import { Source } from "./Source"

export function Sources(props) {
  const { capacitorClient, fluxState, targetReference, handleNavigationSelect } = props
  const [filter, setFilter] = useState(false)
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

  const filteredSources = filterResources(sortedSources, filter)

  return (
    <div className="space-y-4">
      <button className={(filter ? "text-blue-50 bg-blue-600" : "bg-gray-50 text-gray-600") + " rounded-full px-3"}
        onClick={() => setFilter(!filter)}
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
            handleNavigationSelect={handleNavigationSelect}
          />
        )
      }
    </div>
  )
}
