// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { render } from "solid-js/web";
import { HashRouter, Route } from "@solidjs/router";
import { onCleanup, onMount } from "solid-js";
import { KustomizationDetails } from "./views/kustomizationDetails.tsx";
import { HelmReleaseDetails } from "./views/helmReleaseDetails.tsx";
import { TerraformDetails } from "./views/TerraformDetails.tsx";
import { HelmClassicReleaseDetails } from "./views/helmClassicReleaseDetails.tsx";
import { ApplicationDetails } from "./views/applicationDetails.tsx";
import { SecretDetails } from "./views/secretDetails.tsx";
import { Dashboard } from "./views/dashboard.tsx";
import { FilterProvider } from "./store/filterStore.tsx";
import { ApiResourceProvider } from "./store/apiResourceStore.tsx";
import { ErrorProvider } from "./store/errorStore.tsx";
import { UpdateNotice } from "./components/UpdateNotice.tsx";
import { applyTheme, fetchDefaultTheme, loadInitialTheme } from "./utils/theme.ts";
import { keyboardManager } from "./utils/keyboardManager.ts";

function App() {
  // Initialize centralized keyboard manager
  onMount(() => {
    keyboardManager.setup();
  });
  
  onCleanup(() => {
    keyboardManager.cleanup();
  });
  
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
            <Route path="/terraform/:namespace/:name" component={TerraformDetails} />
            <Route path="/helmclassic/:namespace/:name" component={HelmClassicReleaseDetails} />
            <Route path="/application/:namespace/:name" component={ApplicationDetails} />
            <Route path="/secret/:namespace/:name" component={SecretDetails} />
          </HashRouter>
        </FilterProvider>
      </ApiResourceProvider>
    </ErrorProvider>
  );
}

render(() => <App />, document.getElementById("root")!);
