import APIBackend from "./apiBackend";
import StreamingBackend from "./streamingBackend";
import CapacitorClient from "./client";
import { createStore } from 'redux'
import { rootReducer } from './redux';
import Footer from "./Footer";
import Service from "./Service";

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
    <div className="mt-16 max-w-6xl mx-auto grid grid-cols-1 gap-y-4">
      <Service 
        stack={{
          deployment: {
            pods: [
              {name: "xxx", status: "Running"},
              {name: "xxx", status: "Running"}
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
              {name: "xxx", status: "Running"},
              {name: "xxx", status: "Running"}
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
    <Footer store={store} />
    </>
  );
}

export default App;
