import { render } from "solid-js/web";
import { HashRouter, Route } from "@solidjs/router";
import { KustomizationDetails } from "./views/kustomizationDetails.tsx";
import { ApplicationDetails } from "./views/applicationDetails.tsx";
import { Dashboard } from "./views/dashboard.tsx";
import { FilterProvider } from "./store/filterStore.tsx";
import { ApiResourceProvider } from "./store/apiResourceStore.tsx";

function App() {
  return (
    <ApiResourceProvider>
      <FilterProvider>
        <HashRouter>
          <Route path="/" component={Dashboard} />
          <Route path="/kustomization/:namespace/:name" component={KustomizationDetails} />
          <Route path="/application/:namespace/:name" component={ApplicationDetails} />
        </HashRouter>
      </FilterProvider>
    </ApiResourceProvider>
  );
}

render(() => <App />, document.getElementById("root")!);
