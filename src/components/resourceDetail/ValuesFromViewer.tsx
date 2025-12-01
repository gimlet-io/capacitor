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

interface SourceProvenance {
  source: ValuesSource;
  index: number;
}

type ProvenanceMap = Record<string, SourceProvenance>;

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
  const [helmValuesHtml, setHelmValuesHtml] = createSignal<string>('');
  const [helmValuesLoading, setHelmValuesLoading] = createSignal(false);
  const [showAllValues, setShowAllValues] = createSignal(false);
  const [provenanceState, setProvenanceState] = createSignal<ProvenanceMap>({});

  createEffect(() => {
    if (props.valuesFrom && props.valuesFrom.length > 0) {
      fetchValuesSources();
    }
  });

  createEffect(() => {
    const allValues = showAllValues();
    const currentSources = sources();

    if (allValues) {
      // When showing all values (including defaults), keep using the backend API.
      fetchHelmValues();
      return;
    }

    // For computed values (without defaults), locally merge sources and annotate
    setHelmValuesLoading(true);
    try {
      const yaml = buildAnnotatedValuesYamlFromSources(currentSources);
      const effective = yaml || 'No values found';
      setHelmValuesWithHtml(effective);
    } catch (error) {
      console.error('Error building annotated Helm values:', error);
      setHelmValuesWithHtml('Error building annotated values');
    } finally {
      setHelmValuesLoading(false);
    }
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
      const valuesObject = data.values || {};

      // Use provenance from valuesFrom sources to annotate the full values
      const annotatedYaml = emitYamlWithComments(valuesObject, provenanceState());
      const valuesYaml = annotatedYaml || 'No values found';
      setHelmValuesWithHtml(valuesYaml);
    } catch (error) {
      console.error('Error fetching Helm values:', error);
      setHelmValuesWithHtml('Error loading values');
    } finally {
      setHelmValuesLoading(false);
    }
  }

  function setHelmValuesWithHtml(value: string) {
    setHelmValues(value);
    setHelmValuesHtml(renderYamlHtml(value));
  }

  function buildAnnotatedValuesYamlFromSources(allSources: ValuesSource[]): string {
    if (!allSources || allSources.length === 0) {
      return '';
    }

    let merged: unknown = {};
    const provenance: ProvenanceMap = {};

    allSources.forEach((source, index) => {
      if (!source.data) {
        return;
      }

      let parsed: unknown;
      try {
        parsed = parseYAML(source.data);
      } catch (e) {
        console.error(`Failed to parse YAML for source ${source.kind}/${source.name}:`, e);
        return;
      }

      if (parsed === null || parsed === undefined) {
        return;
      }

      if (source.targetPath) {
        merged = applySourceAtTargetPath(
          merged,
          parsed,
          source,
          index,
          source.targetPath,
          provenance,
        );
      } else {
        merged = mergeWithProvenance(merged, parsed, source, index, '', provenance);
      }
    });

    // Store for reuse (e.g. when including defaults)
    setProvenanceState(provenance);

    return emitYamlWithComments(merged, provenance);
  }

  function applySourceAtTargetPath(
    target: unknown,
    value: unknown,
    source: ValuesSource,
    sourceIndex: number,
    targetPath: string,
    provenance: ProvenanceMap,
  ): unknown {
    if (!targetPath) {
      return mergeWithProvenance(target, value, source, sourceIndex, '', provenance);
    }

    const pathSegments = targetPath.split('.').filter(Boolean);
    if (pathSegments.length === 0) {
      return mergeWithProvenance(target, value, source, sourceIndex, '', provenance);
    }

    const result: Record<string, unknown> =
      typeof target === 'object' && target !== null && !Array.isArray(target)
        ? { ...(target as Record<string, unknown>) }
        : {};

    let container: Record<string, unknown> = result;
    let currentPath = '';

    for (let i = 0; i < pathSegments.length - 1; i++) {
      const segment = pathSegments[i];
      currentPath = currentPath ? `${currentPath}.${segment}` : segment;

      const existing = container[segment];
      if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
        container[segment] = {};
      }
      container = container[segment] as Record<string, unknown>;
    }

    const lastKey = pathSegments[pathSegments.length - 1];
    const fullPath = currentPath ? `${currentPath}.${lastKey}` : lastKey;
    const existingAtTarget = container[lastKey];

    container[lastKey] = mergeWithProvenance(
      existingAtTarget,
      value,
      source,
      sourceIndex,
      fullPath,
      provenance,
    );

    return result;
  }

  function mergeWithProvenance(
    target: unknown,
    source: unknown,
    sourceInfo: ValuesSource,
    sourceIndex: number,
    basePath: string,
    provenance: ProvenanceMap,
  ): unknown {
    // Scalars and arrays replace the entire value at basePath
    if (source === null || source === undefined || typeof source !== 'object') {
      if (basePath) {
        provenance[basePath] = { source: sourceInfo, index: sourceIndex };
      }
      return source;
    }

    if (Array.isArray(source)) {
      if (basePath) {
        provenance[basePath] = { source: sourceInfo, index: sourceIndex };
      }
      // Arrays fully overwrite
      return source.slice();
    }

    const result: Record<string, unknown> =
      target && typeof target === 'object' && !Array.isArray(target)
        ? { ...(target as Record<string, unknown>) }
        : {};

    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      const childPath = basePath ? `${basePath}.${key}` : key;
      const existing = result[key];

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = mergeWithProvenance(
          existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {},
          value,
          sourceInfo,
          sourceIndex,
          childPath,
          provenance,
        );
      } else if (Array.isArray(value)) {
        result[key] = mergeWithProvenance(
          existing,
          value,
          sourceInfo,
          sourceIndex,
          childPath,
          provenance,
        );
      } else {
        result[key] = value;
        provenance[childPath] = { source: sourceInfo, index: sourceIndex };
      }
    }

    return result;
  }

  function emitYamlWithComments(value: unknown, provenance: ProvenanceMap): string {
    const lines: string[] = [];
    emitNode(value, '', 0, provenance, lines);
    return lines.join('\n');
  }

  function emitNode(
    value: unknown,
    path: string,
    indentLevel: number,
    provenance: ProvenanceMap,
    lines: string[],
  ) {
    const indent = ' '.repeat(indentLevel);

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const itemPath = path ? `${path}[${index}]` : `[${index}]`;
        const prov = provenance[itemPath];
        const comment = prov ? ` # from ${formatSourceLabel(prov)}` : '';

        if (item === null || typeof item !== 'object') {
          lines.push(`${indent}- ${formatScalar(item)}${comment}`);
        } else {
          lines.push(`${indent}-${comment}`);
          emitNode(item, itemPath, indentLevel + 2, provenance, lines);
        }
      });
      return;
    }

    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const childPath = path ? `${path}.${key}` : key;
        const prov = provenance[childPath];
        const comment = prov ? ` # from ${formatSourceLabel(prov)}` : '';

        if (child === null || typeof child !== 'object' || Array.isArray(child)) {
          if (Array.isArray(child)) {
            lines.push(`${indent}${key}:${comment}`);
            emitNode(child, childPath, indentLevel + 2, provenance, lines);
          } else {
            lines.push(`${indent}${key}: ${formatScalar(child)}${comment}`);
          }
        } else {
          lines.push(`${indent}${key}:${comment}`);
          emitNode(child, childPath, indentLevel + 2, provenance, lines);
        }
      }
      return;
    }

    // Root scalar
    const prov = provenance[path];
    const comment = prov ? ` # from ${formatSourceLabel(prov)}` : '';
    lines.push(`${indent}${formatScalar(value)}${comment}`);
  }

  function formatScalar(value: unknown): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    // Use JSON-style quoting to keep things simple and valid YAML (JSON ⊂ YAML)
    return JSON.stringify(String(value));
  }

  function formatSourceLabel(prov: SourceProvenance): string {
    const { source, index } = prov;
    if (source.kind === 'InlineValues') {
      return `Inline spec.values (#${index})`;
    }
    const resourceName = source.name || '(unknown)';
    return `${source.kind}/${resourceName} (#${index})`;
  }

  function renderYamlHtml(yaml: string): string {
    if (!yaml) {
      return '';
    }

    const lines = yaml.split(/\r?\n/);
    const htmlLines = lines.map((line) => {
      const match = line.match(/^(\s*)(.*)$/);
      const indent = match ? match[1] : '';
      const rest = match ? match[2] : line;
      const indentHtml = escapeHtml(indent);
      const contentHtml = renderYamlLineContent(rest);
      return indentHtml + contentHtml;
    });

    return htmlLines.join('\n');
  }

  function renderYamlLineContent(rest: string): string {
    if (!rest) {
      return '';
    }

    const commentIndex = findCommentIndex(rest);
    let main = rest;
    let comment = '';

    if (commentIndex >= 0) {
      main = rest.slice(0, commentIndex);
      comment = rest.slice(commentIndex);
    }

    // Array items starting with "-"
    if (main.trimStart().startsWith('-')) {
      const trimmed = main.trimStart();
      const dashIndex = trimmed.indexOf('-');
      const afterDash = trimmed.slice(dashIndex + 1); // includes following space if any
      const dashHtml = '<span class="hljs-meta">-</span>';
      const valueHtml = `<span class="hljs-string">${escapeHtml(afterDash)}</span>`;
      const commentHtml = comment
        ? `<span class="hljs-comment">${escapeHtml(comment)}</span>`
        : '';
      const leadingSpaces = main.slice(0, main.indexOf('-'));
      return `${escapeHtml(leadingSpaces)}${dashHtml}${valueHtml}${commentHtml}`;
    }

    // Object keys with ":" separator
    const keyColonIndex = findKeyColonIndex(main);
    let keyPart = '';
    let valuePart = main;

    if (keyColonIndex >= 0) {
      keyPart = main.slice(0, keyColonIndex);
      valuePart = main.slice(keyColonIndex + 1);
    }

    let result = '';

    if (keyPart) {
      const keyHtml = `<span class="hljs-attr">${escapeHtml(keyPart)}</span>`;
      const sepHtml = ':';
      const valueHtml = `<span class="hljs-string">${escapeHtml(valuePart)}</span>`;
      result = `${keyHtml}${sepHtml}${valueHtml}`;
    } else {
      result = `<span class="hljs-string">${escapeHtml(valuePart)}</span>`;
    }

    if (comment) {
      const commentHtml = `<span class="hljs-comment">${escapeHtml(comment)}</span>`;
      result += commentHtml;
    }

    return result;
  }

  function findCommentIndex(line: string): number {
    let inString = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const prev = i > 0 ? line[i - 1] : '';

      if (ch === '"' && prev !== '\\') {
        inString = !inString;
      }
      if (!inString && ch === '#') {
        return i;
      }
    }

    return -1;
  }

  function findKeyColonIndex(line: string): number {
    let inString = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const prev = i > 0 ? line[i - 1] : '';

      if (ch === '"' && prev !== '\\') {
        inString = !inString;
      }
      if (!inString && ch === ':') {
        return i;
      }
    }

    return -1;
  }

  function escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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
        {/* Two-column grid layout: Helm values (2/3) + merge flow (1/3) */}
        <div
          class="values-content-grid"
          style={{ 'grid-template-columns': '2fr 1fr' }}
        >
          {/* Left Column: Helm Values (wider) */}
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
                  Include defaults
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
              <pre class="yaml-content">
                <code
                  class="hljs language-yaml"
                  innerHTML={helmValuesHtml()}
                />
              </pre>
            </Show>
          </div>

          {/* Right Column: Merge Flow Diagram (extended with source details) */}
          <div class="merge-flow-diagram">
            <div class="flow-start">Merge Order</div>
            <For each={sources()}>
              {(source, index) => (
                <>
                  <div class="flow-arrow">↓</div>
                  <div 
                    classList={{
                      "flow-step": true,
                      "missing": !source.exists,
                      "error": !!source.error,
                      "overwrites-all": !!source.targetPath
                    }}
                    onClick={() => setSelectedSource(source)}
                  >
                    <div class="flow-step-header">
                      <span class="step-number">#{index()}</span>
                      <div class="step-main">
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
                </>
              )}
            </For>
            <div class="flow-arrow">↓</div>
            <div class="flow-result">Final Merged Values</div>

            {/* Source detail modal moved next to the merge order widget */}
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

        </div>
      </Show>

    </div>
  );
}
