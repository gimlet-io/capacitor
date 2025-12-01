// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createSignal, createEffect, For, Show } from 'solid-js';
import { useApiResourceStore } from '../../store/apiResourceStore.tsx';
import { parse as parseYAML, stringify as stringifyYAML } from '@std/yaml';

interface ValuesSource {
  kind: 'ConfigMap' | 'Secret' | 'InlineValues';
  name: string;
  valuesKey: string;
  targetPath?: string;
  optional: boolean;
  data: string | null;
  exists: boolean;
  error: string | null;
}

export function ValuesFromViewer(props: {
  namespace: string;
  name: string;
  valuesFrom: any[];
  inlineValues?: any;
}) {
  const apiResourceStore = useApiResourceStore();
  const [sources, setSources] = createSignal<ValuesSource[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [selectedSource, setSelectedSource] = createSignal<ValuesSource | null>(null);
  const [helmValues, setHelmValues] = createSignal<string>('');
  const [helmValuesLoading, setHelmValuesLoading] = createSignal(false);
  const [showAllValues, setShowAllValues] = createSignal(false);

  createEffect(() => {
    if (props.valuesFrom && props.valuesFrom.length > 0) {
      fetchValuesSources();
    }
  });

  createEffect(() => {
    // Fetch Helm values whenever showAllValues changes
    fetchHelmValues();
  });

  async function fetchValuesSources() {
    setLoading(true);
    try {
      const ctxName = apiResourceStore.contextInfo?.current;
      const k8sPrefix = ctxName ? `/k8s/${encodeURIComponent(ctxName)}` : '/k8s';
      const namespace = props.namespace;

      const sourcesPromises = props.valuesFrom.map(async (ref: any) => {
        const kind = ref.kind || '';
        const name = ref.name || '';
        const valuesKey = ref.valuesKey || 'values.yaml';
        const targetPath = ref.targetPath;
        const optional = ref.optional || false;

        const source: ValuesSource = {
          kind: kind as 'ConfigMap' | 'Secret',
          name,
          valuesKey,
          targetPath,
          optional,
          data: null,
          exists: false,
          error: null,
        };

        try {
          let url: string;
          if (kind === 'ConfigMap') {
            url = `${k8sPrefix}/api/v1/namespaces/${encodeURIComponent(namespace)}/configmaps/${encodeURIComponent(name)}`;
          } else if (kind === 'Secret') {
            url = `${k8sPrefix}/api/v1/namespaces/${encodeURIComponent(namespace)}/secrets/${encodeURIComponent(name)}`;
          } else {
            source.error = `Unsupported kind: ${kind}`;
            return source;
          }

          const response = await fetch(url);
          
          if (!response.ok) {
            if (response.status === 404) {
              source.exists = false;
              if (!optional) {
                source.error = `${kind} not found`;
              }
            } else {
              source.error = `Failed to fetch ${kind}: ${response.statusText}`;
            }
            return source;
          }

          const resource = await response.json();
          
          let data: string | null = null;
          
          if (kind === 'ConfigMap') {
            // ConfigMap data is plain text
            if (!resource.data) {
              source.exists = false;
              if (!optional) {
                source.error = `ConfigMap ${name} has no data`;
              }
            } else if (resource.data[valuesKey]) {
              data = resource.data[valuesKey];
              source.exists = true;
            } else {
              source.exists = false;
              if (!optional) {
                source.error = `Key "${valuesKey}" not found in ConfigMap`;
              }
            }
          } else if (kind === 'Secret') {
            // Secret data can be in data (base64) or stringData (plain)
            if (resource.stringData && resource.stringData[valuesKey]) {
              data = resource.stringData[valuesKey];
              source.exists = true;
            } else if (resource.data && resource.data[valuesKey]) {
              try {
                // Decode base64-encoded secret data
                data = atob(resource.data[valuesKey]);
                source.exists = true;
              } catch (e) {
                source.exists = false;
                if (!optional) {
                  source.error = `Failed to decode secret data: ${e instanceof Error ? e.message : String(e)}`;
                }
              }
            } else {
              source.exists = false;
              if (!optional) {
                if (!resource.data && !resource.stringData) {
                  source.error = `Secret ${name} has no data`;
                } else {
                  source.error = `Key "${valuesKey}" not found in Secret`;
                }
              }
            }
          }

          source.data = data;
        } catch (error) {
          source.exists = false;
          if (!optional) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            source.error = `Error fetching ${kind}/${name}: ${errorMsg}`;
          }
        }

        return source;
      });

      const fetchedSources = await Promise.all(sourcesPromises);
      
      // Build complete sources list (add inline values last)
      const allSources = buildCompleteSources(fetchedSources);
      setSources(allSources);
    } catch (error) {
      console.error('Error fetching values sources:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchHelmValues() {
    setHelmValuesLoading(true);
    try {
      const ctxName = apiResourceStore.contextInfo?.current;
      const apiPrefix = ctxName ? `/api/${encodeURIComponent(ctxName)}` : '/api';
      const namespace = props.namespace;
      const url = `${apiPrefix}/helm/values/${namespace}/${props.name}?allValues=${showAllValues()}`;
      
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch Helm values');
      
      const data = await response.json();
      const valuesYaml = data.values ? stringifyYAML(data.values) : 'No values found';
      setHelmValues(valuesYaml);
    } catch (error) {
      console.error('Error fetching Helm values:', error);
      setHelmValues('Error loading values');
    } finally {
      setHelmValuesLoading(false);
    }
  }

  function buildCompleteSources(apiSources: ValuesSource[]): ValuesSource[] {
    const result: ValuesSource[] = [];

    // Add valuesFrom sources (ConfigMaps/Secrets)
    result.push(...apiSources);

    // Add inline values as the last source
    if (props.inlineValues) {
      result.push({
        kind: 'InlineValues',
        name: 'Inline Values (spec.values)',
        valuesKey: 'spec.values',
        optional: false,
        data: typeof props.inlineValues === 'string'
          ? props.inlineValues
          : stringifyYAML(props.inlineValues),
        exists: true,
        error: null,
      });
    }

    return result;
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      console.log('Copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy to clipboard:', err);
    });
  }

  return (
    <div class="values-from-viewer">

      <Show when={loading()}>
        <div class="loading">Loading configuration sources...</div>
      </Show>

      <Show when={!loading()}>
        {/* Three-column grid layout */}
        <div class="values-content-grid">
          {/* Left Column: Merge Flow Diagram */}
          <div class="merge-flow-diagram">
            <div class="flow-start">Merge Order</div>
            <For each={sources()}>
              {(source, index) => (
                <>
                  <div class="flow-arrow">↓</div>
                  <div classList={{
                    "flow-step": true,
                    "overwrites-all": !!source.targetPath
                  }}>
                    <span class="step-number">#{index()}</span>
                    <span class="step-name">{source.name}</span>
                    <Show when={source.targetPath}>
                      <span class="step-target">→ {source.targetPath}</span>
                    </Show>
                  </div>
                </>
              )}
            </For>
            <div class="flow-arrow">↓</div>
            <div class="flow-result">Final Merged Values</div>
          </div>

          {/* Center Column: Source Cards */}
          <div class="sources-list">
          <For each={sources()}>
            {(source, index) => (
              <div 
                classList={{
                  "source-card": true,
                  "missing": !source.exists,
                  "error": !!source.error
                }}
                onClick={() => setSelectedSource(source)}
              >
                <div class="source-header">
                  <div class="source-order">#{index()}</div>
                  <div class="source-info">
                    <div class="source-name">
                      <span class="source-kind">{source.kind}</span>
                      <span class="source-resource-name">{source.name}</span>
                    </div>
                    <div class="source-key">Key: {source.valuesKey}</div>
                  </div>
                  <div class="source-status">
                    <Show when={source.exists}>
                      <span class="status-badge success">✓ Found</span>
                    </Show>
                    <Show when={!source.exists && source.optional}>
                      <span class="status-badge warning">⚠ Not Found (Optional)</span>
                    </Show>
                    <Show when={!source.exists && !source.optional}>
                      <span class="status-badge error">✗ Missing (Required)</span>
                    </Show>
                  </div>
                </div>

                <Show when={source.targetPath}>
                  <div class="source-target-path">
                    <span class="target-label">Target Path:</span>
                    <code class="target-path">{source.targetPath}</code>
                    <span class="overwrites-badge">Overwrites Everything</span>
                  </div>
                </Show>

                <Show when={source.error}>
                  <div class="source-error">
                    Error: {source.error}
                  </div>
                </Show>
              </div>
            )}
          </For>
          </div>

          {/* Right Column: Helm Values */}
          <div class="merged-values-section">
            <div class="merged-values-header">
              <h3>Helm Values</h3>
              <div class="values-actions">
                <label title="Show all values including defaults" class="checkbox-label">
                  <input
                    type="checkbox"
                    checked={showAllValues()}
                    onChange={() => setShowAllValues(!showAllValues())}
                  />
                  Show all values (including defaults)
                </label>
                <button 
                  class="action-button"
                  onClick={() => copyToClipboard(helmValues())}
                >
                  Copy Values
                </button>
              </div>
            </div>
            <p class="merge-note">
              {showAllValues() 
                ? 'Showing all values including chart defaults.' 
                : 'Showing computed values (without chart defaults).'}
            </p>
            <Show when={helmValuesLoading()}>
              <div class="loading">Loading values...</div>
            </Show>
            <Show when={!helmValuesLoading()}>
              <pre class="yaml-content">{helmValues()}</pre>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={selectedSource()}>
        <div class="source-detail-modal">
          <div class="modal-overlay" onClick={() => setSelectedSource(null)}></div>
          <div class="modal-content">
            <div class="modal-header">
              <h2>{selectedSource()!.kind}/{selectedSource()!.name}</h2>
              <button class="close-btn" onClick={() => setSelectedSource(null)}>✕</button>
            </div>

            <div class="modal-body">
              <div class="detail-row">
                <span class="detail-label">Values Key:</span>
                <code>{selectedSource()!.valuesKey}</code>
              </div>

              <Show when={selectedSource()!.targetPath}>
                <div class="detail-row">
                  <span class="detail-label">Target Path:</span>
                  <code>{selectedSource()!.targetPath}</code>
                </div>
              </Show>

              <div class="detail-row">
                <span class="detail-label">Optional:</span>
                <span>{selectedSource()!.optional ? 'Yes' : 'No'}</span>
              </div>

              <Show when={selectedSource()!.data}>
                <div class="source-data">
                  <h3>Content:</h3>
                  <pre class="yaml-content">{selectedSource()!.data}</pre>
                </div>
              </Show>

              <Show when={!selectedSource()!.data}>
                <div class="no-data">
                  {selectedSource()!.optional 
                    ? 'Source not found (optional)'
                    : 'Source not found (REQUIRED)'}
                </div>
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
