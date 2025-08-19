import { render } from "solid-js/web";
import { HashRouter, Route } from "@solidjs/router";
import { KustomizationDetails } from "./views/kustomizationDetails.tsx";
import { HelmReleaseDetails } from "./views/helmReleaseDetails.tsx";
import { ApplicationDetails } from "./views/applicationDetails.tsx";
import { SecretDetails } from "./views/secretDetails.tsx";
import { Dashboard } from "./views/dashboard.tsx";
import { FilterProvider } from "./store/filterStore.tsx";
import { ApiResourceProvider } from "./store/apiResourceStore.tsx";
import { ErrorProvider } from "./store/errorStore.tsx";
import { UpdateNotice } from "./components/UpdateNotice.tsx";
import { applyTheme, fetchDefaultTheme, loadInitialTheme } from "./utils/theme.ts";

function App() {
  // Apply theme early
  const storedTheme = loadInitialTheme();
  applyTheme(storedTheme);

  // Fetch default theme from server (if provided) and apply only if user has no explicit choice
  fetchDefaultTheme().then((serverTheme) => {
    try {
      const hasUserPref = !!localStorage.getItem("ui.theme");
      if (!hasUserPref && serverTheme) {
        applyTheme(serverTheme);
      }
    } catch {
      // Ignore storage errors
    }
  });

  return (
    <ErrorProvider>
      <ApiResourceProvider>
        <FilterProvider>
          <UpdateNotice />
          <HashRouter>
            <Route path="/" component={Dashboard} />
            <Route path="/kustomization/:namespace/:name" component={KustomizationDetails} />
            <Route path="/helmrelease/:namespace/:name" component={HelmReleaseDetails} />
            <Route path="/application/:namespace/:name" component={ApplicationDetails} />
            <Route path="/secret/:namespace/:name" component={SecretDetails} />
          </HashRouter>
        </FilterProvider>
      </ApiResourceProvider>
    </ErrorProvider>
  );
}

render(() => <App />, document.getElementById("root")!);
