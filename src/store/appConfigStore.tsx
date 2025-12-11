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

export type CarvelConfig = {
  namespace: string;
  kappController: {
    deploymentName: string;
    labelKey: string;
    labelValue: string;
  };
};

// Permission elevation configuration for read-only setups.
// When enabled, certain operations bypass user RBAC and use elevated permissions.
// Operations are scoped to specific namespaces for security.
export type PermissionElevationConfig = {
  // Namespaces where pod deletion and deployment/statefulset/daemonset rollout restart are allowed
  // Empty array means disabled. Use ["*"] for all namespaces (not recommended).
  workloadRestartNamespaces: string[];
  // Namespaces where FluxCD reconciliation is allowed
  // Empty array means disabled. Use ["*"] for all namespaces (not recommended).
  fluxReconciliationNamespaces: string[];
};

// Helper function to check if a namespace is allowed for a permission
function isNamespaceAllowed(allowedNamespaces: string[] | undefined, namespace: string): boolean {
  if (!allowedNamespaces || allowedNamespaces.length === 0) return false;
  return allowedNamespaces.includes("*") || allowedNamespaces.includes(namespace);
}

// Check if workload restart is allowed for a namespace
export function isWorkloadRestartAllowed(config: PermissionElevationConfig | null, namespace: string): boolean {
  if (!config) return false;
  return isNamespaceAllowed(config.workloadRestartNamespaces, namespace);
}

// Check if Flux reconciliation is allowed for a namespace
export function isFluxReconciliationAllowed(config: PermissionElevationConfig | null, namespace: string): boolean {
  if (!config) return false;
  return isNamespaceAllowed(config.fluxReconciliationNamespaces, namespace);
}

// Check if workload restart elevation is enabled for any namespace
export function isWorkloadRestartEnabled(config: PermissionElevationConfig | null): boolean {
  return !!config && config.workloadRestartNamespaces.length > 0;
}

// Check if Flux reconciliation elevation is enabled for any namespace
export function isFluxReconciliationEnabled(config: PermissionElevationConfig | null): boolean {
  return !!config && config.fluxReconciliationNamespaces.length > 0;
}

type AppConfigContextValue = {
  appConfig: Accessor<AppConfigPayload | null>;
  configLoading: Accessor<boolean>;
  configError: Accessor<string | null>;
  fluxcdConfig: Accessor<FluxcdConfig | null>;
  carvelConfig: Accessor<CarvelConfig | null>;
  permissionElevation: Accessor<PermissionElevationConfig | null>;
};

const AppConfigContext = createContext<AppConfigContextValue>();

export function AppConfigProvider(props: { children: JSX.Element }) {
  const [appConfig, setAppConfig] = createSignal<AppConfigPayload | null>(null);
  const [configLoading, setConfigLoading] = createSignal(false);
  const [configError, setConfigError] = createSignal<string | null>(null);
  const [fluxcdConfig, setFluxcdConfig] = createSignal<FluxcdConfig | null>(null);
  const [carvelConfig, setCarvelConfig] = createSignal<CarvelConfig | null>(null);
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

        const carvelRaw = (data && (data as any).carvel) as any;
        if (carvelRaw && typeof carvelRaw === "object") {
          setCarvelConfig(carvelRaw as CarvelConfig);
        } else {
          setCarvelConfig(null);
        }

        // Parse permission elevation config
        const rawElevation = (data && (data as any).permissionElevation) as any;
        if (rawElevation && typeof rawElevation === "object") {
          setPermissionElevation({
            workloadRestartNamespaces: Array.isArray(rawElevation.workloadRestartNamespaces)
              ? rawElevation.workloadRestartNamespaces
              : [],
            fluxReconciliationNamespaces: Array.isArray(rawElevation.fluxReconciliationNamespaces)
              ? rawElevation.fluxReconciliationNamespaces
              : [],
          });
        } else {
          setPermissionElevation(null);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConfigError(msg);
        setFluxcdConfig(null);
        setCarvelConfig(null);
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
        carvelConfig,
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

