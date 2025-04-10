import { render } from "solid-js/web";
import { HashRouter, Route } from "@solidjs/router";
import { KustomizationDetails } from "./views/kustomizationDetails.tsx";
import { Dashboard } from "./views/dashboard.tsx";

function App() {
  return (
    <HashRouter>
      <Route path="/" component={Dashboard} />
      <Route path="/kustomization/:namespace/:name" component={KustomizationDetails} />
    </HashRouter>
  );
}

render(() => <App />, document.getElementById("root")!);
