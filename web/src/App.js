import APIBackend from "./apiBackend";
import StreamingBackend from "./streamingBackend";
import CapacitorClient from "./client";
import { createStore } from 'redux'
import { rootReducer } from './redux';
import Footer from "./Footer";
import FilterBar from "./FilterBar";
import Services from "./Services";
import { useState, useEffect, useCallback } from "react";

function App() {
  const capacitorClient = new CapacitorClient(
    (response) => {
      console.log(`${response.status}: ${response.statusText} on ${response.path}`);
    }
  );

  const store = createStore(rootReducer);
  const [filters, setFilters] = useState(JSON.parse(localStorage.getItem("filters")) ?? [])
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState('Kustomizations');
  const [targetReference, setTargetReference] = useState("")

  const handleNavigationSelect = useCallback((selectedNav, ref) => {
    setExpanded(true)
    setSelected(selectedNav);
    setTargetReference(ref)
  },
    [setSelected, setTargetReference]
  )

  const handleToggle = () => {
    setExpanded(!expanded)
  }

  useEffect(() => {
    localStorage.setItem("filters", JSON.stringify(filters));
  }, [filters]);

  const addFilter = (filter) => {
    setFilters([...filters, filter]);
  }
  
  const filterValueByProperty = (property) => {
    const filter = filters.find(f => f.property === property)
    if (!filter) {
      return ""
    }
  
    return filter.value
  }
  
  const deleteFilter = (filter) => {
    setFilters(filters.filter(f => f.property !== filter.property))
  }
  
  const resetFilters = () => {
    setFilters([])
  }

  return (
    <>
    <APIBackend capacitorClient={capacitorClient} store={store}/>
    <StreamingBackend capacitorClient={capacitorClient} store={store}/>
    <div className="max-w-6xl mx-auto">
      <div className="my-16">
        <FilterBar 
          filters={filters}
          addFilter={addFilter}
          deleteFilter={deleteFilter}
          resetFilters={resetFilters}
          filterValueByProperty={filterValueByProperty}
        />
      </div>
      <div className="grid grid-cols-1 gap-y-4 pb-32">
        <Services
          capacitorClient={capacitorClient}
          store={store}
          filters={filters}
          handleNavigationSelect={handleNavigationSelect}
        />
      </div>
    </div>
    <Footer
      capacitorClient={capacitorClient}
      store={store}
      expanded={expanded}
      selected={selected}
      targetReference={targetReference}
      handleToggle={handleToggle}
      handleNavigationSelect={handleNavigationSelect}
    />
    </>
  );
}

export default App;
