import APIBackend from "./apiBackend";
import StreamingBackend from "./streamingBackend";
import CapacitorClient from "./client";
import { createStore } from 'redux'
import { rootReducer } from './redux';
import Footer from "./Footer";
import FilterBar from "./FilterBar";
import Services from "./Services";
import ToastNotifications from "./ToastNotifications";
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

  const handleNavigationSelect = useCallback((selectedNav, objectNs, objectName, objectKind) => {
    setExpanded(true)
    setSelected(selectedNav);
    setTargetReference({objectNs, objectName, objectKind})
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
    <>
    <APIBackend capacitorClient={capacitorClient} store={store}/>
    <StreamingBackend capacitorClient={capacitorClient} store={store}/>
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
