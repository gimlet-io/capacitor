import APIBackend from "./apiBackend.ts";
import StreamingBackend from "./streamingBackend.ts";
import CapacitorClient from "./client.ts";
import { createStore } from 'redux'
import { rootReducer } from './redux.ts';
import Footer from "./Footer.tsx";
import FilterBar from "./FilterBar.tsx";
import Services from "./Services.tsx";
import ToastNotifications from "./ToastNotifications.tsx";
import React, { useState, useEffect, useCallback } from "react";
import { TargetReference } from "./types/targetReference.ts";
import { FilterType } from "./types/filterType.ts";
import { ContextProvider } from "./context.tsx";

function App() {
  const capacitorClient = new CapacitorClient(
    (response) => {
      console.log(`${response.status}: ${response.statusText} on ${response.path}`);
    }
  );

  const store = createStore(rootReducer);

  const [filters, setFilters] = useState<FilterType[]>(JSON.parse(localStorage.getItem("filters")?? '[]') )
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState('Kustomizations');
  const [targetReference, setTargetReference] = useState<TargetReference | null>(null)

  const handleNavigationSelect = useCallback((selectedNav, objectNs, objectName, objectKind) => {
    setExpanded(true)
    setSelected(selectedNav);
    setTargetReference({ objectNs, objectName, objectKind })
  },
    [setSelected, setTargetReference]
  )

  const handleToggle = () => {
    setExpanded(!expanded)
  }

  useEffect(() => {
    localStorage.setItem("filters", JSON.stringify(filters));
  }, [filters]);

  return (
    <ContextProvider client={capacitorClient}>
      <APIBackend capacitorClient={capacitorClient} store={store} />
      <StreamingBackend store={store} />
      <ToastNotifications store={store} handleNavigationSelect={handleNavigationSelect} />
      <div className="max-w-6xl mx-auto">
        <div className="my-16">
          <FilterBar
            properties={["Service", "Namespace", "Domain"]}
            filters={filters}
            change={setFilters}
          />
        </div>
        <div className="grid grid-cols-1 gap-y-4 pb-32">
          <Services
            store={store}
            filters={filters}
            handleNavigationSelect={handleNavigationSelect}
          />
        </div>
      </div>
      <Footer
        store={store}
        expanded={expanded}
        selected={selected}
        targetReference={targetReference}
        handleToggle={handleToggle}
        handleNavigationSelect={handleNavigationSelect}
      />
    </ContextProvider>
  );
}

export default App;
