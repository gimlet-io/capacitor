import { render } from "solid-js/web";
import { HashRouter, Route } from "@solidjs/router";
import { KustomizationDetails } from "./views/kustomizationDetails.tsx";
import { ApplicationDetails } from "./views/applicationDetails.tsx";
import { SecretDetails } from "./views/secretDetails.tsx";
import { Dashboard } from "./views/dashboard.tsx";
import { FilterProvider } from "./store/filterStore.tsx";
import { ApiResourceProvider } from "./store/apiResourceStore.tsx";
import { ErrorProvider } from "./store/errorStore.tsx";
import { UpdateNotice } from "./components/UpdateNotice.tsx";

function App() {
  return (
    <ErrorProvider>
      <ApiResourceProvider>
        <FilterProvider>
          <UpdateNotice />
          <HashRouter>
            <Route path="/" component={Dashboard} />
            <Route path="/kustomization/:namespace/:name" component={KustomizationDetails} />
            <Route path="/application/:namespace/:name" component={ApplicationDetails} />
            <Route path="/secret/:namespace/:name" component={SecretDetails} />
          </HashRouter>
        </FilterProvider>
      </ApiResourceProvider>
    </ErrorProvider>
  );
}

render(() => <App />, document.getElementById("root")!);
