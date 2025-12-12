// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createSignal, createEffect, For, Show } from 'solid-js';
import { useApiResourceStore } from '../../store/apiResourceStore.tsx';

interface CarvelValueSource {
  type: string;      // "secret" or "configmap" or "inline"
  name: string;      // name of the secret/configmap, or "inline-paths" for inline
  namespace: string; // namespace of the resource
  data: Record<string, string>; // actual data from the secret/configmap
  order: number;     // application order
}

interface CarvelOverlaySource {
  type: string;      // "secret" (overlays are always from secrets)
  name: string;      // name of the secret
  namespace: string; // namespace of the resource
  data: Record<string, string>; // actual data from the secret
  order: number;     // application order (from annotation number)
}

interface CarvelFetchSource {
  type: string;   // "inline", "image", "imgpkgBundle", "http", "git", "helmChart"
  config?: Record<string, any>; // configuration for the fetch source
  path?: string;  // optional path for fetched artifacts
}

interface CarvelPackageRef {
  refName: string;     // package reference name
  constraints?: string; // version constraints
}

interface CarvelValuesResponse {
  kind: string;        // "App" or "PackageInstall"
  name: string;        // resource name
  namespace: string;   // resource namespace
  fetch?: CarvelFetchSource[];      // fetch sources (App only)
  packageRef?: CarvelPackageRef;    // package reference (PackageInstall only)
  values: CarvelValueSource[];      // list of value sources in order
  overlays: CarvelOverlaySource[];  // list of overlay sources in order
}

export function CarvelValuesViewer(props: {
  namespace: string;
  name: string;
  kind: 'App' | 'PackageInstall';
}) {
  const apiResourceStore = useApiResourceStore();
  const [valuesData, setValuesData] = createSignal<CarvelValuesResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [selectedSource, setSelectedSource] = createSignal<CarvelValueSource | CarvelOverlaySource | null>(null);

  createEffect(() => {
    fetchCarvelValues();
  });

  function decodeSecretData(secret: any): Record<string, string> {
    const data = (secret && secret.data) || {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string") {
        try {
          out[k] = atob(v);
        } catch {
          // If it's not valid base64, keep original
          out[k] = v;
        }
      }
    }
    return out;
  }

  async function fetchJson(url: string) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    return await response.json();
  }

  async function getSecret(namespace: string, name: string) {
    const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : "";
    const k8sPrefix = ctxName ? `/k8s/${ctxName}` : "/k8s";
    return await fetchJson(`${k8sPrefix}/api/v1/namespaces/${namespace}/secrets/${name}`);
  }

  async function getConfigMap(namespace: string, name: string) {
    const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : "";
    const k8sPrefix = ctxName ? `/k8s/${ctxName}` : "/k8s";
    return await fetchJson(`${k8sPrefix}/api/v1/namespaces/${namespace}/configmaps/${name}`);
  }

  async function fetchCarvelValues() {
    setLoading(true);
    setError(null);
    try {
      const namespace = props.namespace;
      const name = props.name;

      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : "";
      const k8sPrefix = ctxName ? `/k8s/${ctxName}` : "/k8s";
      const withContextK8sApiPath = (apiPath: string) => {
        if (apiPath.startsWith("/k8s/api/") || apiPath.startsWith("/k8s/apis/")) {
          return apiPath.replace("/k8s", k8sPrefix);
        }
        return apiPath;
      };

      if (props.kind === "App") {
        const appApi = (apiResourceStore.apiResources || []).find(r => r.group === "kappctrl.k14s.io" && r.kind === "App");
        const baseApiPath = withContextK8sApiPath(appApi?.apiPath || "/k8s/apis/kappctrl.k14s.io/v1alpha1");
        const pluralName = appApi?.name || "apps";

        const app = await fetchJson(`${baseApiPath}/namespaces/${namespace}/${pluralName}/${name}`);

        // Fetch sources: keep the UI expectations (type + config + optional path)
        const fetchSources: CarvelFetchSource[] = [];
        const fetchArr = app?.spec?.fetch;
        if (Array.isArray(fetchArr)) {
          for (const item of fetchArr) {
            const path = (item && typeof item === "object") ? (item as any).path : undefined;
            if ((item as any)?.inline) fetchSources.push({ type: "inline", config: (item as any).inline, path });
            else if ((item as any)?.image) fetchSources.push({ type: "image", config: (item as any).image, path });
            else if ((item as any)?.imgpkgBundle) fetchSources.push({ type: "imgpkgBundle", config: (item as any).imgpkgBundle, path });
            else if ((item as any)?.http) fetchSources.push({ type: "http", config: (item as any).http, path });
            else if ((item as any)?.git) fetchSources.push({ type: "git", config: (item as any).git, path });
            else if ((item as any)?.helmChart) fetchSources.push({ type: "helmChart", config: (item as any).helmChart, path });
          }
        }

        const values: CarvelValueSource[] = [];
        let order = 1;

        const templateArr = app?.spec?.template;
        if (Array.isArray(templateArr)) {
          for (const tmpl of templateArr) {
            const ytt = (tmpl as any)?.ytt;
            if (ytt) {
              const inlinePaths = ytt?.inline?.paths;
              if (inlinePaths && typeof inlinePaths === "object") {
                const data: Record<string, string> = {};
                for (const [k, v] of Object.entries(inlinePaths)) {
                  if (typeof v === "string") data[k] = v;
                }
                if (Object.keys(data).length > 0) {
                  values.push({ type: "inline", name: "inline-paths", namespace, data, order });
                  order += 1;
                }
              }

              const pathsFrom = ytt?.inline?.pathsFrom;
              if (Array.isArray(pathsFrom)) {
                for (const pf of pathsFrom) {
                  const secretName = (pf as any)?.secretRef?.name;
                  if (typeof secretName === "string" && secretName) {
                    const secret = await getSecret(namespace, secretName);
                    values.push({ type: "secret", name: secretName, namespace, data: decodeSecretData(secret), order });
                    order += 1;
                  }
                  const configMapName = (pf as any)?.configMapRef?.name;
                  if (typeof configMapName === "string" && configMapName) {
                    const configMap = await getConfigMap(namespace, configMapName);
                    values.push({ type: "configmap", name: configMapName, namespace, data: (configMap?.data || {}) as Record<string, string>, order });
                    order += 1;
                  }
                }
              }

              const valuesFrom = ytt?.valuesFrom;
              if (Array.isArray(valuesFrom)) {
                for (const vf of valuesFrom) {
                  const secretName = (vf as any)?.secretRef?.name;
                  if (typeof secretName === "string" && secretName) {
                    const secret = await getSecret(namespace, secretName);
                    values.push({ type: "secret", name: secretName, namespace, data: decodeSecretData(secret), order });
                    order += 1;
                  }
                  const configMapName = (vf as any)?.configMapRef?.name;
                  if (typeof configMapName === "string" && configMapName) {
                    const configMap = await getConfigMap(namespace, configMapName);
                    values.push({ type: "configmap", name: configMapName, namespace, data: (configMap?.data || {}) as Record<string, string>, order });
                    order += 1;
                  }
                }
              }
            }

            const helmTemplate = (tmpl as any)?.helmTemplate;
            if (helmTemplate?.valuesFrom && Array.isArray(helmTemplate.valuesFrom)) {
              for (const vf of helmTemplate.valuesFrom) {
                const secretName = (vf as any)?.secretRef?.name;
                if (typeof secretName === "string" && secretName) {
                  const secret = await getSecret(namespace, secretName);
                  values.push({ type: "secret", name: secretName, namespace, data: decodeSecretData(secret), order });
                  order += 1;
                }
                const configMapName = (vf as any)?.configMapRef?.name;
                if (typeof configMapName === "string" && configMapName) {
                  const configMap = await getConfigMap(namespace, configMapName);
                  values.push({ type: "configmap", name: configMapName, namespace, data: (configMap?.data || {}) as Record<string, string>, order });
                  order += 1;
                }
              }
            }

            const cue = (tmpl as any)?.cue;
            if (cue?.valuesFrom && Array.isArray(cue.valuesFrom)) {
              for (const vf of cue.valuesFrom) {
                const secretName = (vf as any)?.secretRef?.name;
                if (typeof secretName === "string" && secretName) {
                  const secret = await getSecret(namespace, secretName);
                  values.push({ type: "secret", name: secretName, namespace, data: decodeSecretData(secret), order });
                  order += 1;
                }
                const configMapName = (vf as any)?.configMapRef?.name;
                if (typeof configMapName === "string" && configMapName) {
                  const configMap = await getConfigMap(namespace, configMapName);
                  values.push({ type: "configmap", name: configMapName, namespace, data: (configMap?.data || {}) as Record<string, string>, order });
                  order += 1;
                }
              }
            }
          }
        }

        setValuesData({
          kind: "App",
          name,
          namespace,
          fetch: fetchSources,
          values,
          overlays: [],
        });
      } else {
        const pkgiApi = (apiResourceStore.apiResources || []).find(r => r.group === "packaging.carvel.dev" && r.kind === "PackageInstall");
        const baseApiPath = withContextK8sApiPath(pkgiApi?.apiPath || "/k8s/apis/packaging.carvel.dev/v1alpha1");
        const pluralName = pkgiApi?.name || "packageinstalls";

        const pkgi = await fetchJson(`${baseApiPath}/namespaces/${namespace}/${pluralName}/${name}`);

        const packageRef: CarvelPackageRef | undefined = pkgi?.spec?.packageRef?.refName
          ? {
              refName: pkgi.spec.packageRef.refName,
              constraints: pkgi.spec.packageRef?.versionSelection?.constraints,
            }
          : undefined;

        const values: CarvelValueSource[] = [];
        let order = 1;
        const specValues = pkgi?.spec?.values;
        if (Array.isArray(specValues)) {
          for (const v of specValues) {
            const secretName = (v as any)?.secretRef?.name;
            if (typeof secretName === "string" && secretName) {
              const secret = await getSecret(namespace, secretName);
              values.push({ type: "secret", name: secretName, namespace, data: decodeSecretData(secret), order });
              order += 1;
            }
            const configMapName = (v as any)?.configMapRef?.name;
            if (typeof configMapName === "string" && configMapName) {
              const configMap = await getConfigMap(namespace, configMapName);
              values.push({ type: "configmap", name: configMapName, namespace, data: (configMap?.data || {}) as Record<string, string>, order });
              order += 1;
            }
          }
        }

        // Overlays from annotations: ext.packaging.carvel.dev/ytt-paths-from-secret-name.<n>
        const overlays: CarvelOverlaySource[] = [];
        const annotations = pkgi?.metadata?.annotations || {};
        const overlayPairs: Array<{ order: number; secretName: string }> = [];
        if (annotations && typeof annotations === "object") {
          for (const [k, v] of Object.entries(annotations)) {
            if (k.startsWith("ext.packaging.carvel.dev/ytt-paths-from-secret-name.") && typeof v === "string") {
              const suffix = k.split(".").pop() || "";
              const parsed = Number.parseInt(suffix, 10);
              if (!Number.isNaN(parsed)) {
                overlayPairs.push({ order: parsed, secretName: v });
              }
            }
          }
        }
        overlayPairs.sort((a, b) => a.order - b.order);
        for (const entry of overlayPairs) {
          const secret = await getSecret(namespace, entry.secretName);
          overlays.push({ type: "secret", name: entry.secretName, namespace, data: decodeSecretData(secret), order: entry.order });
        }

        setValuesData({
          kind: "PackageInstall",
          name,
          namespace,
          packageRef,
          values,
          overlays,
        });
      }
    } catch (err) {
      console.error('Error fetching Carvel values:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function renderSourceData(source: CarvelValueSource | CarvelOverlaySource): string {
    if (!source.data || Object.keys(source.data).length === 0) {
      return 'No data';
    }
    
    // Pretty print the data as YAML-like format
    const lines: string[] = [];
    for (const [key, value] of Object.entries(source.data)) {
      lines.push(`${key}:`);
      // Indent the value content
      const valueLines = value.split('\n');
      valueLines.forEach(line => {
        lines.push(`  ${line}`);
      });
    }
    return lines.join('\n');
  }

  return (
    <div class="values-from-viewer">
      <Show when={loading()}>
        <div class="loading">Loading Carvel values...</div>
      </Show>

      <Show when={error()}>
        <div style="padding: 2rem; color: var(--linear-red);">
          <strong>Error:</strong> {error()}
        </div>
      </Show>

      <Show when={!loading() && !error() && valuesData()}>
        {/* Single column: Apply Order */}
        <div class="merge-flow-diagram" style="max-width: 600px; margin: 0 auto;">
            <div class="flow-start">Apply Order</div>
            
            {/* Show fetch sources for App */}
            <Show when={valuesData()?.kind === 'App' && valuesData()?.fetch && valuesData()!.fetch!.length > 0}>
              <div class="flow-arrow">↓</div>
              <For each={valuesData()!.fetch}>
                {(source) => (
                  <div class="flow-step">
                    <div class="flow-step-header">
                      <div class="step-main">
                        <div class="source-name">
                          <span class="source-kind">{source.type}</span>
                          <Show when={source.config?.url}>
                            <span class="source-resource-name" style="font-size: 11px;">
                              {source.config!.url as string}
                            </span>
                          </Show>
                          <Show when={source.config?.name}>
                            <span class="source-resource-name">{source.config!.name as string}</span>
                          </Show>
                        </div>
                        <Show when={source.path}>
                          <div class="source-key" style="font-size: 11px;">Path: {source.path}</div>
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </For>
              <div class="flow-arrow">↓</div>
            </Show>

            {/* Show packageRef for PackageInstall */}
            <Show when={valuesData()?.kind === 'PackageInstall' && valuesData()?.packageRef}>
              <div class="flow-arrow">↓</div>
              <div class="flow-step">
                <div class="flow-step-header">
                  <div class="step-main">
                    <div class="source-name">
                      <span class="source-kind">Package</span>
                      <span class="source-resource-name">{valuesData()!.packageRef!.refName}</span>
                    </div>
                    <Show when={valuesData()!.packageRef!.constraints}>
                      <div class="source-key" style="font-size: 11px;">
                        Version: {valuesData()!.packageRef!.constraints}
                      </div>
                    </Show>
                  </div>
                </div>
              </div>
              <div class="flow-arrow">↓</div>
            </Show>

            {/* Value sources */}
            <Show when={valuesData()?.values && valuesData()!.values.length > 0}>
              <For each={valuesData()!.values}>
                {(source) => (
                  <>
                    <div 
                      classList={{
                        "flow-step": true,
                        "missing": !source.data || Object.keys(source.data).length === 0,
                      }}
                      onClick={() => setSelectedSource(source)}
                    >
                      <div class="flow-step-header">
                        <span class="step-number">#{source.order}</span>
                        <div class="step-main">
                          <div class="source-name">
                            <span class="source-kind">{source.type}</span>
                            <span class="source-resource-name">{source.name}</span>
                          </div>
                          <div class="source-key" style="font-size: 11px;">
                            Namespace: {source.namespace}
                          </div>
                        </div>
                        <div class="source-status">
                          <Show when={source.data && Object.keys(source.data).length > 0}>
                            <span class="status-badge success">✓ {Object.keys(source.data).length} key(s)</span>
                          </Show>
                          <Show when={!source.data || Object.keys(source.data).length === 0}>
                            <span class="status-badge warning">⚠ No data</span>
                          </Show>
                        </div>
                      </div>
                    </div>
                    <div class="flow-arrow">↓</div>
                  </>
                )}
              </For>
            </Show>

            {/* Overlay sources (PackageInstall only) */}
            <Show when={valuesData()?.overlays && valuesData()!.overlays.length > 0}>
              <For each={valuesData()!.overlays}>
                {(overlay) => (
                  <>
                    <div 
                      classList={{
                        "flow-step": true,
                        "missing": !overlay.data || Object.keys(overlay.data).length === 0,
                        "overwrites-all": true,
                      }}
                      onClick={() => setSelectedSource(overlay)}
                    >
                      <div class="flow-step-header">
                        <span class="step-number">#{overlay.order}</span>
                        <div class="step-main">
                          <div class="source-name">
                            <span class="source-kind">{overlay.type}</span>
                            <span class="source-resource-name">{overlay.name}</span>
                          </div>
                          <div class="source-key" style="font-size: 11px;">
                            Namespace: {overlay.namespace}
                          </div>
                        </div>
                        <div class="source-status">
                          <Show when={overlay.data && Object.keys(overlay.data).length > 0}>
                            <span class="status-badge success">✓ {Object.keys(overlay.data).length} file(s)</span>
                          </Show>
                          <Show when={!overlay.data || Object.keys(overlay.data).length === 0}>
                            <span class="status-badge warning">⚠ No data</span>
                          </Show>
                        </div>
                      </div>
                    </div>
                    <div class="flow-arrow">↓</div>
                  </>
                )}
              </For>
            </Show>

            <Show when={!valuesData()?.values || valuesData()!.values.length === 0}>
              <p style="color: var(--linear-text-secondary); font-style: italic; padding: 1rem;">
                No value sources found
              </p>
            </Show>

            <div class="flow-result">Applied Configuration</div>

            {/* Source detail modal */}
            <Show when={selectedSource()}>
              <div class="source-detail-modal">
                <div class="modal-overlay" onClick={() => setSelectedSource(null)}></div>
                <div class="modal-content">
                  <div class="modal-header">
                    <h2>{selectedSource()!.type}/{selectedSource()!.name}</h2>
                    <button class="close-btn" onClick={() => setSelectedSource(null)}>✕</button>
                  </div>

                  <div class="modal-body">
                    <div class="detail-row">
                      <span class="detail-label">Type:</span>
                      <code>{selectedSource()!.type}</code>
                    </div>

                    <div class="detail-row">
                      <span class="detail-label">Namespace:</span>
                      <code>{selectedSource()!.namespace}</code>
                    </div>

                    <div class="detail-row">
                      <span class="detail-label">Order:</span>
                      <span>#{selectedSource()!.order}</span>
                    </div>

                    <Show when={selectedSource()!.data && Object.keys(selectedSource()!.data).length > 0}>
                      <div class="source-data">
                        <h3>Content:</h3>
                        <pre class="yaml-content">{renderSourceData(selectedSource()!)}</pre>
                      </div>
                    </Show>

                    <Show when={!selectedSource()!.data || Object.keys(selectedSource()!.data).length === 0}>
                      <div class="no-data">
                        No data found in this source
                      </div>
                    </Show>
                  </div>
                </div>
              </div>
            </Show>
        </div>
      </Show>

    </div>
  );
}
