import React, { useMemo, useState } from "react";
import { TerraformResource } from "./TerraformResource";
import { filterResources } from "./utils.js";
import FilterBar from "./FilterBar.js";

export function TerraformResources(props) {
  const {
    capacitorClient,
    tfResources,
    targetReference,
    handleNavigationSelect,
  } = props;
  const [filters, setFilters] = useState([]);
  const sortedHelmReleases = useMemo(() => {
    if (!tfResources) {
      return null;
    }

    return [...tfResources].sort((a, b) =>
      a.metadata.name.localeCompare(b.metadata.name),
    );
  }, [tfResources]);

  const filteredHelmReleases = filterResources(sortedHelmReleases, filters);

  return (
    <div className="space-y-4">
      <FilterBar
        properties={["Name", "Namespace", "Errors"]}
        filters={filters}
        change={setFilters}
      />
      {filteredHelmReleases?.map((resource) => (
        <TerraformResource
          key={"hr-" + resource.metadata.namespace + resource.metadata.name}
          capacitorClient={capacitorClient}
          item={resource}
          handleNavigationSelect={handleNavigationSelect}
          targetReference={targetReference}
        />
      ))}
    </div>
  );
}
