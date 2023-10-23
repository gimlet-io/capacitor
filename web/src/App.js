import APIBackend from "./apiBackend";
import StreamingBackend from "./streamingBackend";
import CapacitorClient from "./client";
import { createStore } from 'redux'
import { rootReducer } from './redux';

function App() {
  const capacitorClient = new CapacitorClient(
    (response) => {
      console.log(`${response.status}: ${response.statusText} on ${response.path}`);
    }
  );

  const store = createStore(rootReducer);
  store.subscribe(() => console.log(store.getState()))

  return (
    <>
    <APIBackend capacitorClient={capacitorClient} store={store}/>
    <StreamingBackend capacitorClient={capacitorClient} store={store}/>
    <div className="App">
      <div>hello</div>
    </div>
    </>
  );
}

export default App;
