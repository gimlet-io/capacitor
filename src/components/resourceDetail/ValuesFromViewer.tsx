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
      const apiPrefix = ctxName ? `/api/${encodeURIComponent(ctxName)}` : '/api';
      const response = await fetch(
        `${apiPrefix}/helm/values-sources/${props.namespace}/${props.name}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            valuesFrom: props.valuesFrom,
          }),
        }
      );

      if (!response.ok) throw new Error('Failed to fetch values sources');

      const data = await response.json();
      
      // Build sources list from ConfigMaps/Secrets
      const allSources = buildCompleteSources(data.sources);
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
