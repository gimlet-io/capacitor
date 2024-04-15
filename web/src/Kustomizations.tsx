import React, { useMemo, useState } from 'react';
import { Kustomization } from './Kustomization.tsx'
import { filterResources } from './utils.ts';
import FilterBar from "./FilterBar.tsx";
import { FilterType } from './types/filterType.ts';
import { FluxState } from './types/fluxState.ts';
import { TargetReference } from './types/targetReference.ts';

export type KustomizationsProps = {
  fluxState: FluxState;
  targetReference: TargetReference | null;
  handleNavigationSelect: any;
}

export function Kustomizations(props: KustomizationsProps) {
  const { fluxState, targetReference, handleNavigationSelect } = props

  const [filters, setFilters] = useState<FilterType[]>([])
  const kustomizations = fluxState.kustomizations;

  const sortedKustomizations = useMemo(() => {
    if (!kustomizations) {
      return null;
    }

    return [...kustomizations].sort((a, b) => a.metadata!.name!.localeCompare(b.metadata!.name));
  }, [kustomizations]);

  const filteredKustomizations = filterResources(sortedKustomizations, filters)

  return (
    <div className="space-y-4">
      <FilterBar
        properties={["Name", "Namespace", "Errors"]}
        filters={filters}
        change={setFilters}
      />
      {
        filteredKustomizations?.map(kustomization =>
          <Kustomization
            key={kustomization.metadata.namespace + kustomization.metadata.name}
            item={kustomization}
            fluxState={fluxState}
            handleNavigationSelect={handleNavigationSelect}
            targetReference={targetReference}
          />
        )
      }
    </div>
  )
}
