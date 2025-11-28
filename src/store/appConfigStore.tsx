// Global application configuration store.
// Fetches `/api/config` once near the top of the view tree and exposes the
// result via a SolidJS context so that views can consume config without
// issuing their own network requests.

import { createContext, useContext, createSignal, onMount, type Accessor, type JSX } from "solid-js";

export type AppConfigPayload = {
  // These properties are intentionally loose; the backend is the source of truth.
  systemViews?: unknown;
  fluxcd?: unknown;
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

const defaultFluxcdConfig: FluxcdConfig = {
  namespace: "fluxcd-system",
  helmController: {
    deploymentName: "fluxcd-helm-controller",
    labelKey: "app.kubernetes.io/component",
    labelValue: "helm-controller",
  },
  kustomizeController: {
    deploymentName: "fluxcd-kustomize-controller",
    labelKey: "app.kubernetes.io/component",
    labelValue: "kustomize-controller",
  },
};

type AppConfigContextValue = {
  appConfig: Accessor<AppConfigPayload | null>;
  configLoading: Accessor<boolean>;
  configError: Accessor<string | null>;
  fluxcdConfig: Accessor<FluxcdConfig>;
};

const AppConfigContext = createContext<AppConfigContextValue>();

export function AppConfigProvider(props: { children: JSX.Element }) {
  const [appConfig, setAppConfig] = createSignal<AppConfigPayload | null>(null);
  const [configLoading, setConfigLoading] = createSignal(false);
  const [configError, setConfigError] = createSignal<string | null>(null);
  const [fluxcdConfig, setFluxcdConfig] = createSignal<FluxcdConfig>(defaultFluxcdConfig);

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

        const raw = (data && (data as any).fluxcd) as any;
        if (raw && typeof raw === "object") {
          const namespace = typeof raw.namespace === "string" && raw.namespace.trim()
            ? raw.namespace
            : defaultFluxcdConfig.namespace;

          const helm = raw.helmController || {};
          const kustomize = raw.kustomizeController || {};

          setFluxcdConfig({
            namespace,
            helmController: {
              deploymentName: typeof helm.deploymentName === "string" && helm.deploymentName.trim()
                ? helm.deploymentName
                : defaultFluxcdConfig.helmController.deploymentName,
              labelKey: typeof helm.labelKey === "string" && helm.labelKey.trim()
                ? helm.labelKey
                : defaultFluxcdConfig.helmController.labelKey,
              labelValue: typeof helm.labelValue === "string" && helm.labelValue.trim()
                ? helm.labelValue
                : defaultFluxcdConfig.helmController.labelValue,
            },
            kustomizeController: {
              deploymentName: typeof kustomize.deploymentName === "string" && kustomize.deploymentName.trim()
                ? kustomize.deploymentName
                : defaultFluxcdConfig.kustomizeController.deploymentName,
              labelKey: typeof kustomize.labelKey === "string" && kustomize.labelKey.trim()
                ? kustomize.labelKey
                : defaultFluxcdConfig.kustomizeController.labelKey,
              labelValue: typeof kustomize.labelValue === "string" && kustomize.labelValue.trim()
                ? kustomize.labelValue
                : defaultFluxcdConfig.kustomizeController.labelValue,
            },
          });
        } else {
          setFluxcdConfig(defaultFluxcdConfig);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConfigError(msg);
        setFluxcdConfig(defaultFluxcdConfig);
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

