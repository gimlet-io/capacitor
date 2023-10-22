import logo from './logo.svg';
import './App.css';
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
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Edit <code>src/App.js</code> and save to reload.
        </p>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
      </header>
    </div>
    </>
  );
}

export default App;
