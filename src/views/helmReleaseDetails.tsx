// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Show } from "solid-js";
import type { HelmRelease, Event, Kustomization, ExtendedKustomization } from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { handleFluxReconcile, handleFluxReconcileWithSources, handleFluxSuspend, handleFluxDiff } from "../utils/fluxUtils.tsx";
import { checkPermissionSSAR, type MinimalK8sResource } from "../utils/permissions.ts";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { DiffDrawer } from "../components/resourceDetail/DiffDrawer.tsx";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { stringify as stringifyYAML } from "@std/yaml";
import { StatusBadges } from "../components/resourceList/KustomizationList.tsx";

export function HelmReleaseDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const apiResourceStore = useApiResourceStore();

  const [helmRelease, setHelmRelease] = createSignal<HelmRelease & { events?: Event[] } | null>(null);
  const [canReconcile, setCanReconcile] = createSignal<boolean | undefined>(undefined);
  const [canReconcileWithSources, setCanReconcileWithSources] = createSignal<boolean | undefined>(undefined);
  const [canPatch, setCanPatch] = createSignal<boolean | undefined>(undefined);

  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  // Diff drawer state
  const [diffDrawerOpen, setDiffDrawerOpen] = createSignal(false);
  type FluxDiffResult = { fileName: string; clusterYaml: string; appliedYaml: string; created: boolean; hasChanges: boolean; deleted: boolean };
  const [diffData, setDiffData] = createSignal<FluxDiffResult[] | null>(null);
  const [diffLoading, setDiffLoading] = createSignal(false);

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

  // Compute permissions
  createEffect(() => {
    const hr = helmRelease();
    if (!hr) {
      setCanReconcile(undefined);
      setCanReconcileWithSources(undefined);
      setCanPatch(undefined);
      return;
    }

    const mainRes: MinimalK8sResource = { apiVersion: hr.apiVersion, kind: hr.kind, metadata: { name: hr.metadata.name, namespace: hr.metadata.namespace } };
    (async () => {
      const canPatchMain = await checkPermissionSSAR(mainRes, { verb: 'patch' }, apiResourceStore.apiResources);
      setCanReconcile(canPatchMain);
      setCanPatch(canPatchMain);

      // Check source permission when available (HelmRepository or GitRepository)
      type SourceRefLike = { apiVersion?: string; kind: string; name: string; namespace?: string };
      const src = hr.spec?.chart?.spec?.sourceRef as SourceRefLike | undefined;
      if (src?.kind && src?.name) {
        const srcRes: MinimalK8sResource = {
          apiVersion: src.apiVersion || '',
          kind: src.kind,
          metadata: { name: src.name, namespace: src.namespace || hr.metadata.namespace }
        };
        const canPatchSrc = await checkPermissionSSAR(srcRes, { verb: 'patch' }, apiResourceStore.apiResources);
        setCanReconcileWithSources(canPatchMain && canPatchSrc);
      } else {
        setCanReconcileWithSources(canPatchMain);
      }
    })();
  });

  const setupWatches = (ns: string, name: string) => {
    untrack(() => {
      watchControllers().forEach((c) => c.abort());
    });

    setHelmRelease(null);

    type HelmReleaseEvent = { type: string; object: HelmRelease };
    type EventWatch = { type: string; object: Event };
    const controllers: AbortController[] = [];

    // Resolve API path and plural for HelmRelease dynamically
    const helmReleaseApi = (apiResourceStore.apiResources || []).find(r => r.group === 'helm.toolkit.fluxcd.io' && r.kind === 'HelmRelease');
    const baseApiPath = helmReleaseApi?.apiPath || '/k8s/apis/helm.toolkit.fluxcd.io/v2beta1';
    const pluralName = helmReleaseApi?.name || 'helmreleases';

    // Watch HelmRelease itself (Flux CRD)
    {
      const controller = new AbortController();
      const path = `${baseApiPath}/namespaces/${ns}/${pluralName}?watch=true`;
      const callback = (event: HelmReleaseEvent) => {
        if ((event.type === 'ADDED' || event.type === 'MODIFIED') && event.object.metadata.name === name) {
          setHelmRelease((prev) => {
            const currentEvents = prev?.events || [];
            const merged: HelmRelease & { events?: Event[] } = { ...event.object, events: currentEvents };
            return merged;
          });
        }
      };
      const noopSetWatchStatus = (_: string) => {};
      watchResource(path, callback, controller, noopSetWatchStatus);
      controllers.push(controller);
    }

    // Watch Events in namespace and keep last few relevant to this HelmRelease
    {
      const controller = new AbortController();
      const path = `/k8s/api/v1/namespaces/${ns}/events?watch=true`;
      const callback = (event: EventWatch) => {
        const obj = event.object;
        setHelmRelease((prev) => {
          if (!prev) return prev;
          const relevant = obj.involvedObject.kind === 'HelmRelease' && obj.involvedObject.name === name && obj.involvedObject.namespace === ns;
          if (!relevant) return prev;
          const list = (prev.events || []).filter((e) => e.metadata.name !== obj.metadata.name);
          const merged: HelmRelease & { events?: Event[] } = { ...prev, events: [obj, ...list].slice(0, 50) };
          return merged;
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
      <Show when={helmRelease()} fallback={<div class="loading">Loading...</div>}>
        {(hr) => {
          return (
            <>
              <header class="kustomization-header">
                <div class="header-top">
                  <div class="header-left">
                    <button class="back-button" onClick={handleBackClick}>
                      <span class="icon">←</span> Back
                    </button>
                    <h1>{hr().metadata.namespace}/{hr().metadata.name}</h1>
                    <div class="kustomization-status">
                      {StatusBadges(hr() as unknown as ExtendedKustomization)}
                    </div>
                  </div>
                  <div class="header-actions">
                    <button class="sync-button" onClick={async () => {
                      setDiffLoading(true);
                      setDiffDrawerOpen(true);
                      try {
                        const result = await handleFluxDiff(hr());
                        setDiffData(result);
                      } catch (error) {
                        console.error("Failed to generate diff:", error);
                        setDiffData(null);
                      } finally {
                        setDiffLoading(false);
                      }
                    }}>Diff</button>
                    <button
                      class="sync-button reconcile-button"
                      disabled={canReconcile() === false}
                      title={canReconcile() === false ? "Not permitted" : undefined}
                      onClick={() => handleFluxReconcile(hr())}
                    >
                      Reconcile
                    </button>
                    <button
                      class="sync-button"
                      disabled={canReconcileWithSources() === false}
                      title={canReconcileWithSources() === false ? "Not permitted" : undefined}
                      onClick={() => handleFluxReconcileWithSources(hr())}
                    >
                      Reconcile with sources
                    </button>
                    {hr().spec.suspend ? (
                      <button
                        class="sync-button resume"
                        style={{ "background-color": "#188038", "color": "white" }}
                        disabled={canPatch() === false}
                        title={canPatch() === false ? "Not permitted" : undefined}
                        onClick={() => {
                          handleFluxSuspend(hr(), false).catch((e) => console.error("Failed to resume HelmRelease:", e));
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
                          handleFluxSuspend(hr(), true).catch((e) => console.error("Failed to suspend HelmRelease:", e));
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
                      <span class="label">Chart:</span>
                      <span class="value">{hr().spec.chart.spec.chart}</span>
                    </div>
                    <div class="info-item">
                      <span class="label">Source:</span>
                      <span class="value">{hr().spec.chart.spec.sourceRef.kind}/{hr().spec.chart.spec.sourceRef.namespace ? `${hr().spec.chart.spec.sourceRef.namespace}/` : ''}{hr().spec.chart.spec.sourceRef.name}</span>
                    </div>
                    {hr().spec.chart.spec.version && (
                      <div class="info-item">
                        <span class="label">Version:</span>
                        <span class="value">{hr().spec.chart.spec.version}</span>
                      </div>
                    )}
                    {hr().spec.releaseName && (
                      <div class="info-item">
                        <span class="label">Release Name:</span>
                        <span class="value">{hr().spec.releaseName}</span>
                      </div>
                    )}
                    {hr().spec.targetNamespace && (
                      <div class="info-item">
                        <span class="label">Target Namespace:</span>
                        <span class="value">{hr().spec.targetNamespace}</span>
                      </div>
                    )}
                    <div class="info-item">
                      <span class="label">Interval:</span>
                      <span class="value">{hr().spec.interval}</span>
                    </div>
                    <div class="info-item" style="grid-column: 4 / 10; grid-row: 1 / 4;">
                      <span class="label">Events:</span>
                      <ul style="font-family: monospace; font-size: 12px;">
                        {(hr().events || []).sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()).slice(0, 5).map((event) => (
                          <li><span title={event.lastTimestamp}>{useCalculateAge(event.lastTimestamp)()}</span> {event.involvedObject.kind}/{event.involvedObject.namespace}/{event.involvedObject.name}: {event.message}</li>
                        ))}
                      </ul>
                    </div>
                    {hr().status && (
                      <div class="info-item full-width">
                        <div class="info-grid">
                          <div class="info-item" style={{ "grid-column": "1 / 3" }}>
                            <span class="label">Last Attempted Revision:</span>
                            <span class="value">{hr().status?.lastAttemptedRevision || 'None'}</span>
                          </div>
                          <div class="info-item">
                            <span class="label">Last Applied Revision:</span>
                            <span class="value">{hr().status?.lastAppliedRevision || 'None'}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    <div class="info-item full-width">
                      <details>
                        <summary class="label">Conditions</summary>
                        <pre class="conditions-yaml">
                          {hr().status?.conditions ? stringifyYAML(hr().status!.conditions) : 'No conditions available'}
                        </pre>
                      </details>
                    </div>
                  </div>
                </div>
              </header>
            </>
          );
        }}
      </Show>

      <Show when={diffDrawerOpen()}>
        <DiffDrawer
          resource={(helmRelease() as unknown as Kustomization) as Kustomization}
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
    </div>
  );
}


