import React, { useState, useMemo } from 'react';
import { filterResources } from './utils.ts';
import { Source } from "./Source.tsx"
import FilterBar from "./FilterBar.tsx";
import { Source as SourceType } from './types/source.ts';
import { FilterType } from './types/filterType.ts';


export type SourcesProps = {
  fluxState: any;
  targetReference: any;
  handleNavigationSelect: any;
}

export function Sources(props) {
  const {  fluxState, targetReference, handleNavigationSelect } = props
  const [filters, setFilters] = useState<FilterType[]>([])
  const sortedSources = useMemo(() => {
    const sources: SourceType[] = [];
    if (fluxState.ociRepositories) {
      sources.push(...fluxState.ociRepositories)
      sources.push(...fluxState.gitRepositories)
      sources.push(...fluxState.buckets)
      sources.push(...fluxState.helmRepositories)
      sources.push(...fluxState.helmCharts)
    }
    return [...sources].sort((a, b) => (a.metadata?.name || '').localeCompare(b.metadata?.name || ''));
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
            source={source}
            targetReference={targetReference}
            handleNavigationSelect={handleNavigationSelect}
          />
        )
      }
    </div>
  )
}
