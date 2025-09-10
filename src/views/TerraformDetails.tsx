// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import type { Terraform, Event, Kustomization, ExtendedKustomization } from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { checkPermissionSSAR, type MinimalK8sResource } from "../utils/permissions.ts";
import { handleFluxReconcile, handleFluxReconcileWithSources, handleFluxSuspend, handleFluxDiff } from "../utils/fluxUtils.tsx";
import { DiffDrawer } from "../components/resourceDetail/DiffDrawer.tsx";
import { stringify as stringifyYAML } from "@std/yaml";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { StatusBadges } from "../components/resourceList/KustomizationList.tsx";

export function TerraformDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const apiResourceStore = useApiResourceStore();

  const [terraform, setTerraform] = createSignal<Terraform & { events?: Event[] } | null>(null);

  const [canReconcile, setCanReconcile] = createSignal<boolean | undefined>(undefined);
  const [canReconcileWithSources, setCanReconcileWithSources] = createSignal<boolean | undefined>(undefined);
  const [canPatch, setCanPatch] = createSignal<boolean | undefined>(undefined);

  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  // Diff drawer state
  const [diffDrawerOpen, setDiffDrawerOpen] = createSignal(false);
  type FluxDiffResult = { fileName: string; clusterYaml: string; appliedYaml: string; created: boolean; hasChanges: boolean; deleted: boolean };
  const [diffData, setDiffData] = createSignal<FluxDiffResult[] | null>(null);
  const [diffLoading, setDiffLoading] = createSignal(false);

  // Dropdown state for reconcile split button
  const [dropdownOpen, setDropdownOpen] = createSignal(false);

  // Compute permissions
  createEffect(() => {
    const tf = terraform();
    if (!tf) {
      setCanReconcile(undefined);
      setCanReconcileWithSources(undefined);
      setCanPatch(undefined);
      return;
    }

    const mainRes: MinimalK8sResource = { apiVersion: tf.apiVersion, kind: tf.kind, metadata: { name: tf.metadata.name, namespace: tf.metadata.namespace } };
    (async () => {
      const canPatchMain = await checkPermissionSSAR(mainRes, { verb: 'patch' }, apiResourceStore.apiResources);
      setCanReconcile(canPatchMain);
      setCanPatch(canPatchMain);

      const src = tf.spec?.sourceRef;
      if (src?.kind && src?.name) {
        const srcRes: MinimalK8sResource = {
          apiVersion: ((tf as unknown) as { spec?: { sourceRef?: { apiVersion?: string } } }).spec?.sourceRef?.apiVersion || '',
          kind: src.kind,
          metadata: { name: src.name, namespace: src.namespace || tf.metadata.namespace }
        };
        const canPatchSrc = await checkPermissionSSAR(srcRes, { verb: 'patch' }, apiResourceStore.apiResources);
        setCanReconcileWithSources(canPatchMain && canPatchSrc);
      } else {
        setCanReconcileWithSources(canPatchMain);
      }
    })();
  });

  // Set up watches when params present and API resources loaded
  createEffect(() => {
    if (params.namespace && params.name && apiResourceStore.apiResources) {
      setupWatches(params.namespace, params.name);
    }
  });

  onCleanup(() => {
    untrack(() => {
      watchControllers().forEach((c) => c.abort());
    });
  });

  const setupWatches = (ns: string, name: string) => {
    untrack(() => {
      watchControllers().forEach((c) => c.abort());
    });

    setTerraform(null);

    const controllers: AbortController[] = [];

    // Resolve API path and plural for Terraform dynamically
    const tfApi = (apiResourceStore.apiResources || []).find(r => r.group === 'infra.contrib.fluxcd.io' && r.kind === 'Terraform');
    const baseApiPath = tfApi?.apiPath || '/k8s/apis/infra.contrib.fluxcd.io/v1alpha1';
    const pluralName = tfApi?.name || 'terraforms';

    // Watch Terraform resources in namespace
    {
      const controller = new AbortController();
      const path = `${baseApiPath}/namespaces/${ns}/${pluralName}?watch=true`;
      const callback = (event: { type: string; object: Terraform }) => {
        if ((event.type === 'ADDED' || event.type === 'MODIFIED') && event.object.metadata.name === name) {
          setTerraform((prev) => {
            const currentEvents = prev?.events || [];
            return { ...event.object, events: currentEvents } as Terraform & { events?: Event[] };
          });
        }
      };
      const noopSetWatchStatus = (_: string) => {};
      watchResource(path, callback, controller, noopSetWatchStatus);
      controllers.push(controller);
    }

    // Watch Events in namespace and keep relevant ones for this Terraform
    {
      const controller = new AbortController();
      const path = `/k8s/api/v1/namespaces/${ns}/events?watch=true`;
      const callback = (event: { type: string; object: Event }) => {
        const obj = event.object;
        setTerraform((prev) => {
          if (!prev) return prev;
          const relevant = obj.involvedObject.kind === 'Terraform' && obj.involvedObject.name === name && obj.involvedObject.namespace === ns;
          if (!relevant) return prev;
          const list = (prev.events || []).filter((e) => e.metadata.name !== obj.metadata.name);
          return { ...prev, events: [obj, ...list].slice(0, 50) } as Terraform & { events?: Event[] };
        });
      };
      const noopSetWatchStatus = (_: string) => {};
      watchResource(path, callback, controller, noopSetWatchStatus);
      controllers.push(controller);
    }

    setWatchControllers(controllers);
  };

  const handleBackClick = () => {
    navigate("/");
  };

  return (
    <div class="kustomization-details">
      <Show when={terraform()} fallback={<div class="loading">Loading...</div>}>
        {(tf) => {
          return (
            <>
              <header class="kustomization-header">
                <div class="header-top">
                  <div class="header-left">
                    <button class="back-button" onClick={handleBackClick}>
                      <span class="icon">←</span> Back
                    </button>
                    <h1>{tf().metadata.namespace}/{tf().metadata.name}</h1>
                    <div class="kustomization-status">
                      {StatusBadges(tf() as unknown as ExtendedKustomization)}
                    </div>
                  </div>
                  <div class="header-actions">
                    <button class="sync-button" onClick={async () => {
                      setDiffLoading(true);
                      setDiffDrawerOpen(true);
                      try {
                        const result = await handleFluxDiff(tf());
                        setDiffData(result);
                      } catch (error) {
                        console.error("Failed to generate diff:", error);
                        setDiffData(null);
                      } finally {
                        setDiffLoading(false);
                      }
                    }}>Diff</button>

                    <div class="dropdown-container">
                      <div class="split-button">
                        <button
                          class="sync-button reconcile-button"
                          disabled={canReconcile() === false}
                          title={canReconcile() === false ? "Not permitted" : undefined}
                          onClick={() => {
                            handleFluxReconcile(tf());
                            setDropdownOpen(false);
                          }}
                          style={{ "border-top-right-radius": "0", "border-bottom-right-radius": "0", "margin-right": "1px" }}
                        >
                          Reconcile
                        </button>
                        <button
                          class="sync-button dropdown-toggle"
                          onClick={(e) => { e.stopPropagation(); setDropdownOpen(!dropdownOpen()); }}
                          style={{ "border-top-left-radius": "0", "border-bottom-left-radius": "0", "padding": "0 8px", "min-width": "24px" }}
                          aria-label="Show more reconcile options"
                          title="More reconcile options"
                        >
                          <span style={{ "font-size": "10px" }}>▼</span>
                        </button>
                      </div>
                      <Show when={dropdownOpen()}>
                        <div class="context-menu">
                          <div
                            class={`context-menu-item ${canReconcileWithSources() === false ? 'disabled' : ''}`}
                            onClick={() => {
                              if (canReconcileWithSources() === false) return;
                              handleFluxReconcileWithSources(tf());
                              setDropdownOpen(false);
                            }}
                            title={canReconcileWithSources() === false ? "Not permitted" : undefined}
                          >
                            <span>Reconcile with sources</span>
                          </div>
                        </div>
                      </Show>
                    </div>

                    {tf().spec.suspend ? (
                      <button
                        class="sync-button resume"
                        style={{ "background-color": "#188038", "color": "white" }}
                        disabled={canPatch() === false}
                        title={canPatch() === false ? "Not permitted" : undefined}
                        onClick={() => {
                          handleFluxSuspend(tf(), false).catch((e) => console.error("Failed to resume Terraform:", e));
                        }}
                      >
                        <span style={{ "margin-right": "5px", "font-weight": "bold" }}>▶</span> Resume
                      </button>
                    ) : (
                      <button
                        class="sync-button suspend"
                        disabled={canPatch() === false}
                        title={canPatch() === false ? "Not permitted" : undefined}
                        onClick={() => {
                          handleFluxSuspend(tf(), true).catch((e) => console.error("Failed to suspend Terraform:", e));
                        }}
                      >
                        <span style={{ "margin-right": "5px", "font-weight": "bold" }}>⏸</span> Suspend
                      </button>
                    )}
                  </div>
                </div>

                <div class="header-info">
                  <div class="info-grid">
                    <div class="info-item">
                      <span class="label">Source:</span>
                      <span class="value">{tf().spec.sourceRef.kind}/{tf().spec.sourceRef.namespace ? `${tf().spec.sourceRef.namespace}/` : ''}{tf().spec.sourceRef.name}</span>
                    </div>
                    {tf().spec.path && (
                      <div class="info-item">
                        <span class="label">Path:</span>
                        <span class="value">{tf().spec.path}</span>
                      </div>
                    )}
                    <div class="info-item">
                      <span class="label">Interval:</span>
                      <span class="value">{tf().spec.interval}</span>
                    </div>
                    {tf().spec.approvePlan && (
                      <div class="info-item">
                        <span class="label">Approve Plan:</span>
                        <span class="value">{tf().spec.approvePlan}</span>
                      </div>
                    )}
                    {tf().spec.writeOutputsToSecret?.name && (
                      <div class="info-item">
                        <span class="label">Outputs Secret:</span>
                        <span class="value">{tf().spec.writeOutputsToSecret?.name}</span>
                      </div>
                    )}
                    <div class="info-item" style="grid-column: 4 / 10; grid-row: 1 / 4;">
                      <span class="label">Events:</span>
                      <ul style="font-family: monospace; font-size: 12px;">
                        {(tf().events || []).sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()).slice(0, 5).map((event) => (
                          <li><span title={event.lastTimestamp}>{useCalculateAge(event.lastTimestamp)()}</span> {event.involvedObject.kind}/{event.involvedObject.namespace}/{event.involvedObject.name}: {event.message}</li>
                        ))}
                      </ul>
                    </div>
                    {tf().status && (
                      <div class="info-item full-width">
                        <div class="info-grid">
                          <div class="info-item" style={{ "grid-column": "1 / 3" }}>
                            <span class="label">Last Attempted Revision:</span>
                            <span class="value">{tf().status?.lastAttemptedRevision || 'None'}</span>
                          </div>
                          <div class="info-item">
                            <span class="label">Last Applied Revision:</span>
                            <span class="value">{tf().status?.lastAppliedRevision || 'None'}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div class="info-item full-width">
                      <details>
                        <summary class="label">Conditions</summary>
                        <pre class="conditions-yaml">
                          {tf().status?.conditions ? stringifyYAML(tf().status!.conditions) : 'No conditions available'}
                        </pre>
                      </details>
                    </div>
                  </div>
                </div>
              </header>

              {/* Diff Drawer */}
              <Show when={diffDrawerOpen()}>
                <DiffDrawer
                  resource={(terraform() as unknown as Kustomization) as Kustomization}
                  diffData={diffData()}
                  isOpen={diffDrawerOpen()}
                  onClose={() => {
                    setDiffDrawerOpen(false);
                    setDiffData(null);
                    setDiffLoading(false);
                  }}
                  loading={diffLoading()}
                />
              </Show>
            </>
          );
        }}
      </Show>
    </div>
  );
}


