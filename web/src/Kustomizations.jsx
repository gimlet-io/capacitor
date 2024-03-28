import React, { useMemo, useState } from 'react';
import { Kustomization } from './Kustomization.jsx'
import { filterResources } from './utils.js';
import FilterBar from './FilterBar.js';

export function Kustomizations(props) {
  const { capacitorClient, fluxState, targetReference, handleNavigationSelect } = props
  const [filters, setFilters] = useState([])
  const kustomizations = fluxState.kustomizations;

  const sortedKustomizations = useMemo(() => {
    if (!kustomizations) {
      return null;
    }

    return [...kustomizations].sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));
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
            capacitorClient={capacitorClient}
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
