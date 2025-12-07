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

  async function fetchCarvelValues() {
    setLoading(true);
    setError(null);
    try {
      const ctxName = apiResourceStore.contextInfo?.current;
      const apiPrefix = ctxName ? `/api/${encodeURIComponent(ctxName)}` : '/api';
      const namespace = props.namespace;
      const name = props.name;
      
      // Choose the correct endpoint based on kind
      const endpoint = props.kind === 'App' 
        ? `${apiPrefix}/carvelAppValues/${namespace}/${name}`
        : `${apiPrefix}/carvelPackageInstallValues/${namespace}/${name}`;
      
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error(`Failed to fetch Carvel ${props.kind} values`);
      
      const data = await response.json();
      setValuesData(data);
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
