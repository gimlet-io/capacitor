import APIBackend from "./apiBackend";
import StreamingBackend from "./streamingBackend";
import CapacitorClient from "./client";
import { createStore } from 'redux'
import { rootReducer } from './redux';
import Footer from "./Footer";

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
    <Footer store={store} />
    </>
  );
}

export default App;
