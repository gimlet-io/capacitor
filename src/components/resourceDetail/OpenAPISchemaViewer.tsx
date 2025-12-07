// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// Component to render OpenAPI v3 schema in human-readable format
import { For, Show } from "solid-js";

interface OpenAPISchemaViewerProps {
  schema: any;
}

export function OpenAPISchemaViewer(props: OpenAPISchemaViewerProps) {
  const renderProperty = (name: string, prop: any, level: number = 0) => {
    const indent = level * 20;
    const isRequired = prop.required || false;
    const hasNested = prop.properties && Object.keys(prop.properties).length > 0;
    
    return (
      <div style={`margin-left: ${indent}px; margin-bottom: 0.75rem;`}>
        <div style="display: flex; gap: 0.5rem; align-items: baseline;">
          <span style="font-weight: 600; color: var(--linear-text-primary); font-family: monospace;">
            {name}
          </span>
          <Show when={prop.type}>
            <span style="color: var(--linear-text-secondary); font-size: 0.85rem; font-style: italic;">
              {prop.type}
            </span>
          </Show>
          <Show when={isRequired}>
            <span style="color: var(--red-text); font-size: 0.75rem; font-weight: 600;">
              REQUIRED
            </span>
          </Show>
          <Show when={prop.default !== undefined && prop.default !== null}>
            <span style="color: var(--linear-text-tertiary); font-size: 0.85rem;">
              (default: {typeof prop.default === 'object' ? JSON.stringify(prop.default) : String(prop.default)})
            </span>
          </Show>
        </div>
        
        <Show when={prop.description}>
          <div style="margin-top: 0.25rem; color: var(--linear-text-secondary); font-size: 0.9rem; line-height: 1.4;">
            {prop.description}
          </div>
        </Show>
        
        <Show when={prop.enum && prop.enum.length > 0}>
          <div style="margin-top: 0.25rem; color: var(--linear-text-tertiary); font-size: 0.85rem;">
            Allowed values: {prop.enum.join(', ')}
          </div>
        </Show>
        
        <Show when={hasNested}>
          <div style="margin-top: 0.5rem; padding-left: 1rem; border-left: 2px solid var(--linear-border);">
            <For each={Object.entries(prop.properties)}>
              {([nestedName, nestedProp]: [string, any]) => renderProperty(nestedName, nestedProp, level + 1)}
            </For>
          </div>
        </Show>
      </div>
    );
  };

  return (
    <div class="openapi-schema-viewer">
      <Show when={props.schema?.openAPIv3?.properties}>
        <For each={Object.entries(props.schema.openAPIv3.properties)}>
          {([name, prop]: [string, any]) => renderProperty(name, prop)}
        </For>
      </Show>
      <Show when={!props.schema?.openAPIv3?.properties}>
        <p style="color: var(--linear-text-secondary); font-style: italic;">
          No schema properties defined
        </p>
      </Show>
    </div>
  );
}
