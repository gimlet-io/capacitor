import APIBackend from "./apiBackend";
import StreamingBackend from "./streamingBackend";
import CapacitorClient from "./client";
import { createStore } from 'redux'
import { rootReducer } from './redux';
import Footer from "./Footer";
import Service from "./Service";
import FilterBar from "./FilterBar";
import { Footer2 } from "./Footer2";

function App() {
  const capacitorClient = new CapacitorClient(
    (response) => {
      console.log(`${response.status}: ${response.statusText} on ${response.path}`);
    }
  );

  const store = createStore(rootReducer);

  return (
    <>
      <APIBackend capacitorClient={capacitorClient} store={store} />
      <StreamingBackend capacitorClient={capacitorClient} store={store} />
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
          <Service
            stack={{
              deployment: {
                pods: [
                  { name: "xxx", status: "Running" },
                  { name: "yyy", status: "Running" }
                ]
              },
              service: {
                name: "my-app",
                namespace: "default"
              }
            }}
            alerts={[]}
          />
          <Service
            stack={{
              deployment: {
                pods: [
                  { name: "zzz", status: "Running" },
                  { name: "uuu", status: "Running" }
                ]
              },
              service: {
                name: "your-app",
                namespace: "default"
              }
            }}
            alerts={[]}
          />
        </div>
      </div>
      {/* <Footer store={store} /> */}
      <Footer2 store={store} />
    </>
  );
}

export default App;
