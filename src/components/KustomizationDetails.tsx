import { For, Show, createResource } from "solid-js";
import { A, useParams } from "@solidjs/router";
import type { Kustomization } from "../types/k8s.ts";

export function KustomizationDetails() {
  const params = useParams();
  
  const [kustomization] = createResource(async () => {
    const response = await fetch(`/k8s/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/${params.namespace}/kustomizations/${params.name}`);
    if (!response.ok) throw new Error('Failed to fetch kustomization');
    return response.json() as Promise<Kustomization>;
  });

  return (
    <div class="kustomization-details">
      <div class="header">
        <A href="/" class="back-button">← Back</A>
        <div class="breadcrumbs">
          <A href="/">Home</A>
          <span> / </span>
          <span>Kustomization: {params.name}</span>
        </div>
      </div>
      
      <Show when={kustomization()}>
        {(k) => (
          <div class="content">
            <h1>{k().metadata.name}</h1>
            
            <section class="details-section">
              <h2>Metadata</h2>
              <div class="metadata-grid">
                <div class="metadata-item">
                  <span class="label">Namespace:</span>
                  <span class="value">{k().metadata.namespace}</span>
                </div>
                <div class="metadata-item">
                  <span class="label">Created:</span>
                  <span class="value">{new Date(k().metadata.creationTimestamp).toLocaleString()}</span>
                </div>
              </div>
            </section>

            <section class="details-section">
              <h2>Spec</h2>
              <div class="spec-grid">
                <div class="spec-item">
                  <span class="label">Path:</span>
                  <span class="value">{k().spec.path}</span>
                </div>
                <div class="spec-item">
                  <span class="label">Source:</span>
                  <span class="value">{k().spec.sourceRef.name}</span>
                </div>
                <div class="spec-item">
                  <span class="label">Interval:</span>
                  <span class="value">{k().spec.interval}</span>
                </div>
              </div>
            </section>

            <Show when={k().status}>
              <section class="details-section">
                <h2>Status</h2>
                <div class="status-grid">
                  <div class="status-item">
                    <span class="label">Last Applied Revision:</span>
                    <span class="value">{k().status?.lastAppliedRevision}</span>
                  </div>
                  <div class="status-item">
                    <span class="label">Last Attempted Revision:</span>
                    <span class="value">{k().status?.lastAttemptedRevision}</span>
                  </div>
                  <div class="status-item">
                    <span class="label">Conditions:</span>
                    <div class="conditions">
                      <For each={k().status?.conditions || []}>
                        {(condition) => (
                          <div class="condition" classList={{ [condition.type]: true, [condition.status]: true }}>
                            <span class="type">{condition.type}</span>
                            <span class="status">{condition.status}</span>
                            <span class="message">{condition.message}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              </section>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
} 