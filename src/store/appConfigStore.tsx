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

export type CarvelConfig = {
  namespace: string;
  kappController: {
    deploymentName: string;
    labelKey: string;
    labelValue: string;
  };
};

type AppConfigContextValue = {
  appConfig: Accessor<AppConfigPayload | null>;
  configLoading: Accessor<boolean>;
  configError: Accessor<string | null>;
  fluxcdConfig: Accessor<FluxcdConfig | null>;
  carvelConfig: Accessor<CarvelConfig | null>;
};

const AppConfigContext = createContext<AppConfigContextValue>();

export function AppConfigProvider(props: { children: JSX.Element }) {
  const [appConfig, setAppConfig] = createSignal<AppConfigPayload | null>(null);
  const [configLoading, setConfigLoading] = createSignal(false);
  const [configError, setConfigError] = createSignal<string | null>(null);
  const [fluxcdConfig, setFluxcdConfig] = createSignal<FluxcdConfig | null>(null);
  const [carvelConfig, setCarvelConfig] = createSignal<CarvelConfig | null>(null);

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
          setFluxcdConfig(raw as FluxcdConfig);
        } else {
          setFluxcdConfig(null);
        }

        const carvelRaw = (data && (data as any).carvel) as any;
        if (carvelRaw && typeof carvelRaw === "object") {
          setCarvelConfig(carvelRaw as CarvelConfig);
        } else {
          setCarvelConfig(null);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConfigError(msg);
        setFluxcdConfig(null);
        setCarvelConfig(null);
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

