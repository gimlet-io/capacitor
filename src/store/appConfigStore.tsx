// Global application configuration store.
// Fetches `/api/config` once near the top of the view tree and exposes the
// result via a SolidJS context so that views can consume config without
// issuing their own network requests.

import { createContext, useContext, createSignal, onMount, type Accessor, type JSX } from "solid-js";

export type AppConfigPayload = {
  // These properties are intentionally loose; the backend is the source of truth.
  systemViews?: unknown;
  fluxcd?: unknown;
  permissionElevation?: unknown;
  // Allow additional keys without typing every field here.
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
};

export type FluxcdConfig = {
  namespace: string;
  helmController: {
    deploymentName: string;
    labelKey: string;
    labelValue: string;
  };
  kustomizeController: {
    deploymentName: string;
    labelKey: string;
    labelValue: string;
  };
};

// Permission elevation configuration for read-only setups.
// When enabled, certain operations bypass user RBAC and use elevated permissions.
export type PermissionElevationConfig = {
  // Enables pod deletion and deployment/statefulset/daemonset rollout restart
  workloadRestart: boolean;
  // Enables triggering FluxCD reconciliation
  fluxReconciliation: boolean;
  // Enables reading Helm secrets for history, values, and manifest
  helmInfo: boolean;
};

type AppConfigContextValue = {
  appConfig: Accessor<AppConfigPayload | null>;
  configLoading: Accessor<boolean>;
  configError: Accessor<string | null>;
  fluxcdConfig: Accessor<FluxcdConfig | null>;
  permissionElevation: Accessor<PermissionElevationConfig | null>;
};

const AppConfigContext = createContext<AppConfigContextValue>();

export function AppConfigProvider(props: { children: JSX.Element }) {
  const [appConfig, setAppConfig] = createSignal<AppConfigPayload | null>(null);
  const [configLoading, setConfigLoading] = createSignal(false);
  const [configError, setConfigError] = createSignal<string | null>(null);
  const [fluxcdConfig, setFluxcdConfig] = createSignal<FluxcdConfig | null>(null);
  const [permissionElevation, setPermissionElevation] = createSignal<PermissionElevationConfig | null>(null);

  onMount(() => {
    (async () => {
      setConfigLoading(true);
      setConfigError(null);
      try {
        const res = await fetch("/api/config");
        if (!res.ok) {
          setConfigError(`Failed to load config (HTTP ${res.status})`);
          return;
        }
        const data = (await res.json()) as AppConfigPayload;
        setAppConfig(data);

        // Parse fluxcd config
        const rawFluxcd = (data && (data as any).fluxcd) as any;
        if (rawFluxcd && typeof rawFluxcd === "object") {
          setFluxcdConfig(rawFluxcd as FluxcdConfig);
        } else {
          setFluxcdConfig(null);
        }

        // Parse permission elevation config
        const rawElevation = (data && (data as any).permissionElevation) as any;
        if (rawElevation && typeof rawElevation === "object") {
          setPermissionElevation({
            workloadRestart: !!rawElevation.workloadRestart,
            fluxReconciliation: !!rawElevation.fluxReconciliation,
            helmInfo: !!rawElevation.helmInfo,
          });
        } else {
          setPermissionElevation(null);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConfigError(msg);
        setFluxcdConfig(null);
        setPermissionElevation(null);
      } finally {
        setConfigLoading(false);
      }
    })();
  });

  return (
    <AppConfigContext.Provider
      value={{
        appConfig,
        configLoading,
        configError,
        fluxcdConfig,
        permissionElevation,
      }}
    >
      {props.children}
    </AppConfigContext.Provider>
  );
}

export function useAppConfig(): AppConfigContextValue {
  const ctx = useContext(AppConfigContext);
  if (!ctx) {
    throw new Error("useAppConfig must be used within an AppConfigProvider");
  }
  return ctx;
}

