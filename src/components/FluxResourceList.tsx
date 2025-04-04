import { For } from "solid-js/web";
import type { Kustomization, Source, OCIRepository, HelmRepository, HelmChart, GitRepository } from '../types/k8s.ts';

export function FluxResourceList(props: { 
  kustomizations: Kustomization[],
  sources: Source[]
}) {
  return (
    <div class="resource-list">
      <For each={props.kustomizations}>
        {(kustomization) => (
          <div class="resource-item kustomization-item">
            <h2>Kustomization: {kustomization.metadata.namespace}/{kustomization.metadata.name}</h2>
            <p>Path: {kustomization.spec.path}</p>
            <p>Source: {kustomization.spec.sourceRef.kind}/{kustomization.spec.sourceRef.name}</p>
            <p>Interval: {kustomization.spec.interval}</p>
            {kustomization.spec.prune && <p>Prune: Yes</p>}
            {kustomization.spec.validation && <p>Validation: {kustomization.spec.validation}</p>}

            <details>
              <summary>Conditions</summary>
              <div class="conditions">
                <For each={kustomization.status?.conditions || []}>
                  {(condition) => (
                    <div class={`condition ${condition.status.toLowerCase()}`}>
                      <p>Type: {condition.type}</p>
                      <p>Status: {condition.status}</p>
                      {condition.reason && <p>Reason: {condition.reason}</p>}
                      {condition.message && <p>Message: {condition.message}</p>}
                      <p>Last Transition: {new Date(condition.lastTransitionTime).toLocaleString()}</p>
                    </div>
                  )}
                </For>
              </div>
            </details>

            {kustomization.status?.healthChecks && (
              <details>
                <summary>Health Checks</summary>
                <div class="health-checks">
                  <For each={kustomization.status.healthChecks}>
                    {(check) => (
                      <div class="health-check">
                        <p>Kind: {check.kind}</p>
                        <p>Name: {check.name}</p>
                        <p>Namespace: {check.namespace}</p>
                      </div>
                    )}
                  </For>
                </div>
              </details>
            )}

            {kustomization.status?.inventory?.entries && (
              <details>
                <summary>Inventory</summary>
                <div class="inventory">
                  <For each={kustomization.status.inventory.entries}>
                    {(entry) => (
                      <div class="inventory-entry">
                        <p>ID: {entry.id}</p>
                        <p>Version: {entry.v}</p>
                      </div>
                    )}
                  </For>
                </div>
              </details>
            )}
          </div>
        )}
      </For>

      <For each={props.sources}>
        {(source) => (
          <div class="resource-item flux-source-item" data-kind={source.kind}>
            <h2>{source.kind}: {source.metadata.namespace}/{source.metadata.name}</h2>
            <p>Interval: {source.spec.interval}</p>
            {source.spec.timeout && <p>Timeout: {source.spec.timeout}</p>}
            {source.spec.suspend && <p>Status: Suspended</p>}

            {source.kind === 'OCIRepository' && (
              <div class="source-details">
                <p>URL: {(source as OCIRepository).spec.url}</p>
                {(source as OCIRepository).spec.provider && <p>Provider: {(source as OCIRepository).spec.provider}</p>}
                {(source as OCIRepository).spec.insecure && <p>Insecure: Yes</p>}
              </div>
            )}

            {source.kind === 'HelmRepository' && (
              <div class="source-details">
                <p>URL: {(source as HelmRepository).spec.url}</p>
                {(source as HelmRepository).spec.passCredentials && <p>Pass Credentials: Yes</p>}
              </div>
            )}

            {source.kind === 'HelmChart' && (
              <div class="source-details">
                <p>Chart: {(source as HelmChart).spec.chart}</p>
                <p>Source: {(source as HelmChart).spec.sourceRef.kind}/{(source as HelmChart).spec.sourceRef.name}</p>
                {(source as HelmChart).spec.valuesFiles && (
                  <p>Values Files: {(source as HelmChart).spec.valuesFiles?.join(', ')}</p>
                )}
              </div>
            )}

            {source.kind === 'GitRepository' && (
              <div class="source-details">
                <p>URL: {(source as GitRepository).spec.url}</p>
                {(source as GitRepository).spec.ref && (
                  <div>
                    <p>Reference:</p>
                    <ul>
                      {(source as GitRepository).spec.ref?.branch && <li>Branch: {(source as GitRepository).spec.ref.branch}</li>}
                      {(source as GitRepository).spec.ref?.tag && <li>Tag: {(source as GitRepository).spec.ref.tag}</li>}
                      {(source as GitRepository).spec.ref?.semver && <li>Semver: {(source as GitRepository).spec.ref.semver}</li>}
                      {(source as GitRepository).spec.ref?.commit && <li>Commit: {(source as GitRepository).spec.ref.commit}</li>}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <details>
              <summary>Conditions</summary>
              <div class="conditions">
                <For each={source.status?.conditions || []}>
                  {(condition) => (
                    <div class={`condition ${condition.status.toLowerCase()}`}>
                      <p>Type: {condition.type}</p>
                      <p>Status: {condition.status}</p>
                      {condition.reason && <p>Reason: {condition.reason}</p>}
                      {condition.message && <p>Message: {condition.message}</p>}
                      <p>Last Transition: {new Date(condition.lastTransitionTime).toLocaleString()}</p>
                    </div>
                  )}
                </For>
              </div>
            </details>

            {source.status?.artifact && (
              <details>
                <summary>Artifact</summary>
                <div class="artifact">
                  <p>Path: {source.status.artifact.path}</p>
                  <p>URL: {source.status.artifact.url}</p>
                  <p>Revision: {source.status.artifact.revision}</p>
                  {source.status.artifact.checksum && <p>Checksum: {source.status.artifact.checksum}</p>}
                  <p>Last Update: {new Date(source.status.artifact.lastUpdateTime).toLocaleString()}</p>
                </div>
              </details>
            )}
          </div>
        )}
      </For>
    </div>
  );
} 