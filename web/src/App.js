import APIBackend from "./apiBackend";
import StreamingBackend from "./streamingBackend";
import CapacitorClient from "./client";
import { createStore } from 'redux'
import { rootReducer } from './redux';
import Footer from "./Footer";
import FilterBar from "./FilterBar";
import Services from "./Services";

function App() {
  const capacitorClient = new CapacitorClient(
    (response) => {
      console.log(`${response.status}: ${response.statusText} on ${response.path}`);
    }
  );

  const store = createStore(rootReducer);

  return (
    <>
    <APIBackend capacitorClient={capacitorClient} store={store}/>
    <StreamingBackend capacitorClient={capacitorClient} store={store}/>
    <div className="max-w-6xl mx-auto">
      <div className="my-16">
        <FilterBar 
          filters={[
            {
              property: "Owner",
              value: "backend-team"
            },
            {
              property: "App",
              value: "*app*"
            },
          ]}
        />
      </div>
      <div className="grid grid-cols-1 gap-y-4">
        <Services store={store} />
      </div>
    </div>
    <Footer store={store} />
    </>
  );
}

export default App;
