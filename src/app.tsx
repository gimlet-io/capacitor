import { render } from "solid-js/web";
import { Router, Route } from "@solidjs/router";
import { KustomizationDetails } from "./components/KustomizationDetails.tsx";
import { Dashboard } from "./views/dashboard.tsx";

function App() {
  return (
    <Router>
      <Route path="/" component={Dashboard} />
      <Route path="/kustomization/:namespace/:name" component={KustomizationDetails} />
    </Router>
  );
}

render(() => <App />, document.getElementById("root")!);
