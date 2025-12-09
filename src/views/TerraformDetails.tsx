// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// deno-lint-ignore-file jsx-button-has-type
import { createEffect, createSignal, on, onCleanup, untrack, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import type { Terraform, Event, Kustomization, ExtendedKustomization } from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useCheckPermissionSSAR, type MinimalK8sResource } from "../utils/permissions.ts";
import { handleFluxReconcile, handleFluxReconcileWithSources, handleFluxSuspend, handleFluxDiff, handleFluxApprove } from "../utils/fluxUtils.tsx";
import { DiffDrawer } from "../components/resourceDetail/DiffDrawer.tsx";
import { stringify as stringifyYAML } from "@std/yaml";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { StatusBadges } from "../components/resourceList/KustomizationList.tsx";
import { Tabs } from "../components/Tabs.tsx";
import { LogsViewer } from "../components/resourceDetail/LogsViewer.tsx";
import { EventList } from "../components/resourceList/EventList.tsx";

export function TerraformDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const apiResourceStore = useApiResourceStore();
  const checkPermission = useCheckPermissionSSAR();

  const [terraform, setTerraform] = createSignal<Terraform & { events?: Event[] } | null>(null);

  const [canReconcile, setCanReconcile] = createSignal<boolean | undefined>(undefined);
  const [canReconcileWithSources, setCanReconcileWithSources] = createSignal<boolean | undefined>(undefined);
  const [canPatch, setCanPatch] = createSignal<boolean | undefined>(undefined);

  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  // Debug: log the whole Terraform object on all changes
  createEffect(() => {
    const tf = terraform();
    if (tf) {
      console.log('[TerraformDetails] terraform changed:', tf);
    } else {
      console.log('[TerraformDetails] terraform cleared');
    }
  });

  // Diff drawer state
  const [diffDrawerOpen, setDiffDrawerOpen] = createSignal(false);
  type FluxDiffResult = { fileName: string; clusterYaml: string; appliedYaml: string; created: boolean; hasChanges: boolean; deleted: boolean };
  const [diffData, setDiffData] = createSignal<FluxDiffResult[] | null>(null);
  const [diffLoading, setDiffLoading] = createSignal(false);

  // Dropdown state for reconcile split button
  const [dropdownOpen, setDropdownOpen] = createSignal(false);

  // Tabs state
  const [activeTab, setActiveTab] = createSignal<"plan" | "output" | "events" | "runner">("plan");

  // Runner logs state
  type K8sPod = { apiVersion: string; kind: string; metadata: { name: string; namespace: string }; spec?: Record<string, unknown>; status?: Record<string, unknown> };
  const [runnerPod, setRunnerPod] = createSignal<K8sPod | null>(null);
  const [runnerLoading, setRunnerLoading] = createSignal<boolean>(false);
  const [runnerMessage, setRunnerMessage] = createSignal<string>("");
  let runnerRetryHandle: number | null = null;

  const clearRunnerRetry = () => {
    if (runnerRetryHandle !== null) {
      clearTimeout(runnerRetryHandle);
      runnerRetryHandle = null;
    }
  };

  const fetchRunnerPodOnce = async () => {
    const tf = terraform();
    if (!tf) return;
    setRunnerLoading(true);
    try {
      const controllerNamespace = "flux-system"; // tfctl default
      const podName = `${tf.metadata.name}-tf-runner`;
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const k8sPrefix = ctxName ? `/k8s/${ctxName}` : '/k8s';
      const resp = await fetch(`${k8sPrefix}/api/v1/namespaces/${controllerNamespace}/pods/${podName}`);
      if (resp.ok) {
        const pod = await resp.json();
        setRunnerPod(pod);
        setRunnerMessage("");
        clearRunnerRetry();
      } else if (resp.status === 404) {
        setRunnerPod(null);
        setRunnerMessage(`${controllerNamespace}/${podName} runner pod is not running, waiting...`);
        clearRunnerRetry();
        runnerRetryHandle = setTimeout(() => { fetchRunnerPodOnce(); }, 30000) as unknown as number;
      } else {
        setRunnerPod(null);
        setRunnerMessage(`Failed to fetch runner pod: ${resp.status} ${resp.statusText}`);
        clearRunnerRetry();
        runnerRetryHandle = setTimeout(() => { fetchRunnerPodOnce(); }, 30000) as unknown as number;
      }
    } catch (_e) {
      setRunnerPod(null);
      setRunnerMessage(`Error fetching runner pod`);
      clearRunnerRetry();
      runnerRetryHandle = setTimeout(() => { fetchRunnerPodOnce(); }, 30000) as unknown as number;
    } finally {
      setRunnerLoading(false);
    }
  };

  // Plan / Output state
  const [planConfigMap, setPlanConfigMap] = createSignal<{
    data?: Record<string, string>;
    binaryData?: Record<string, string>;
  } | null>(null);
  const [planSecret, setPlanSecret] = createSignal<{
    data?: Record<string, string>;
    stringData?: Record<string, string>;
  } | null>(null);
  const [outputsSecret, setOutputsSecret] = createSignal<{
    data?: Record<string, string>;
    stringData?: Record<string, string>;
  } | null>(null);

  // Decoded JSON plan text (when storeReadablePlan == 'json')
  const [jsonPlanText, setJsonPlanText] = createSignal<string | null>(null);

  // Compute expected plan object name like tfctl: tfplan-<workspace>-<resource>[.json]
  function expectedPlanObjectName(tf: Terraform | null | undefined): { name: string | null; isJson: boolean } {
    if (!tf) return { name: null, isJson: false };
    const mode = tf.spec?.storeReadablePlan;
    if (!mode || mode === 'none') return { name: null, isJson: false };
    // Use the workspace from spec when provided; controller defaults to "default"
    // deno-lint-ignore no-explicit-any
    const workspace = (tf as any)?.spec?.workspace || 'default';
    const base = `tfplan-${workspace}-${tf.metadata.name}`;
    if (mode === 'json') return { name: `${base}.json`, isJson: true };
    return { name: base, isJson: false };
  }

  // Attempt to gunzip base64-encoded data in the browser if available
  async function tryGunzipBase64ToString(b64: string): Promise<string | null> {
    try {
      const binaryString = atob(b64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
      // Prefer Web DecompressionStream when available
      // deno-lint-ignore no-explicit-any
      const DecompressionStreamAny = (globalThis as any).DecompressionStream;
      if (DecompressionStreamAny) {
        const ds = new DecompressionStreamAny('gzip');
        const stream = new Response(bytes).body as ReadableStream<Uint8Array>;
        const decompressed = stream.pipeThrough(ds);
        const buf = await new Response(decompressed).arrayBuffer();
        return new TextDecoder().decode(buf);
      }
      // Fallback: cannot decompress
      return null;
    } catch (_e) {
      return null;
    }
  }

  // Keep jsonPlanText in sync when secret or mode changes
  createEffect(
    on(
      [
        () => terraform()?.spec?.storeReadablePlan,
        () => planSecret(),
        () => terraform()?.status?.plan?.lastApplied,
      ],
      async ([_mode, sec, _lastApplied]) => {
        const mode = _mode;
        if (mode !== 'json' || !sec) {
          setJsonPlanText(null);
          return;
        }
        // Expect gzipped JSON in data['tfplan'] when using json mode
        const rawString = sec.stringData?.['tfplan'];
        const rawB64 = sec.data?.['tfplan'];
        if (rawString) {
          setJsonPlanText(rawString);
          return;
        }
        if (rawB64) {
          const gunzipped = await tryGunzipBase64ToString(rawB64);
          if (gunzipped !== null) {
            setJsonPlanText(gunzipped);
            return;
          }
          try {
            setJsonPlanText(atob(rawB64));
            return;
          } catch (_e) {
            setJsonPlanText(null);
            return;
          }
        }
        setJsonPlanText(null);
      },
      { defer: true }
    )
  );

  // Initial fetch of plan object to avoid relying solely on watch events
  createEffect(
    on(
      [
        () => params.namespace,
        () => terraform()?.spec?.storeReadablePlan,
        () => terraform()?.status?.plan?.lastApplied,
        () => terraform()?.metadata?.name,
        () => apiResourceStore.contextInfo?.current,
      ],
      async ([_ns, _mode, _lastApplied, _name, _ctx]) => {
        const ns = _ns;
        const mode = _mode;
        const tf = untrack(() => terraform());
        if (!tf || !ns) return;
        if (!mode || mode === 'none') return;
        const expected = expectedPlanObjectName(tf).name;
        const preferred = expected;
        if (!preferred) return;

        if (mode === 'human') {
          try {
            const ctxName = _ctx ? encodeURIComponent(_ctx) : '';
            const k8sPrefix = ctxName ? `/k8s/${ctxName}` : '/k8s';
            const resp = await fetch(`${k8sPrefix}/api/v1/namespaces/${ns}/configmaps/${preferred}`);
            if (resp.ok) {
              const cm = await resp.json();
              setPlanConfigMap({ data: cm.data, binaryData: cm.binaryData });
            }
          } catch (_e) { /* ignore */ }
        } else if (mode === 'json') {
          try {
            const ctxName = _ctx ? encodeURIComponent(_ctx) : '';
            const k8sPrefix = ctxName ? `/k8s/${ctxName}` : '/k8s';
            const resp = await fetch(`${k8sPrefix}/api/v1/namespaces/${ns}/secrets/${preferred}`);
            if (resp.ok) {
              const sec = await resp.json();
              setPlanSecret({ data: sec.data, stringData: sec.stringData });
            }
          } catch (_e) { /* ignore */ }
        }
      },
      { defer: true }
    )
  );

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
      const canPatchMain = await checkPermission(mainRes, { verb: 'patch' });
      setCanReconcile(canPatchMain);
      setCanPatch(canPatchMain);

      const src = tf.spec?.sourceRef;
      if (src?.kind && src?.name) {
        const srcRes: MinimalK8sResource = {
          apiVersion: ((tf as unknown) as { spec?: { sourceRef?: { apiVersion?: string } } }).spec?.sourceRef?.apiVersion || '',
          kind: src.kind,
          metadata: { name: src.name, namespace: src.namespace || tf.metadata.namespace }
        };
        const canPatchSrc = await checkPermission(srcRes, { verb: 'patch' });
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
    clearRunnerRetry();
  });

  const setupWatches = (ns: string, name: string) => {
    untrack(() => {
      watchControllers().forEach((c) => c.abort());
    });

    setTerraform(null);

    const controllers: AbortController[] = [];

    // Resolve API path and plural for Terraform dynamically
    const tfApi = (apiResourceStore.apiResources || []).find(r => r.group === 'infra.contrib.fluxcd.io' && r.kind === 'Terraform');
    const baseApiPath = tfApi?.apiPath || '/k8s/apis/infra.contrib.fluxcd.io/v1alpha2';
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
      watchResource(path, callback, controller, noopSetWatchStatus, undefined, apiResourceStore.contextInfo?.current);
      controllers.push(controller);
    }

    // Watch Events in namespace and keep relevant ones for this Terraform
    {
      const controller = new AbortController();
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const path = (ctxName ? `/k8s/${ctxName}` : '/k8s') + `/api/v1/namespaces/${ns}/events?watch=true`;
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
      watchResource(path, callback, controller, noopSetWatchStatus, undefined, apiResourceStore.contextInfo?.current);
      controllers.push(controller);
    }

    // Watch ConfigMaps in namespace to capture plan ConfigMap per naming convention
    {
      const controller = new AbortController();
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const path = (ctxName ? `/k8s/${ctxName}` : '/k8s') + `/api/v1/namespaces/${ns}/configmaps?watch=true`;
      const callback = (event: { type: string; object: { metadata: { name: string; namespace: string }; data?: Record<string, string>; binaryData?: Record<string, string> } }) => {
        const obj = event.object;
        if (!obj || obj.metadata.namespace !== ns) return;
        const tfCurrent = terraform();
        const planRef = tfCurrent?.status?.plan?.lastApplied;
        const expected = expectedPlanObjectName(tfCurrent);
        const shouldMatch = (tfCurrent?.spec?.storeReadablePlan === 'human');
        if (!shouldMatch) return;
        const matchName = planRef || expected.name;
        if (!matchName || obj.metadata.name !== matchName) return;
        if (event.type === 'DELETED') {
          setPlanConfigMap(null);
        } else {
          setPlanConfigMap({ data: obj.data, binaryData: obj.binaryData });
        }
      };
      const noopSetWatchStatus = (_: string) => {};
      watchResource(path, callback, controller, noopSetWatchStatus, undefined, apiResourceStore.contextInfo?.current);
      controllers.push(controller);
    }

    // Watch Secrets in namespace to capture plan Secret (json mode) and outputs Secret
    {
      const controller = new AbortController();
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const path = (ctxName ? `/k8s/${ctxName}` : '/k8s') + `/api/v1/namespaces/${ns}/secrets?watch=true`;
      const callback = (event: { type: string; object: { metadata: { name: string; namespace: string }; data?: Record<string, string>; stringData?: Record<string, string> } }) => {
        const obj = event.object;
        if (!obj || obj.metadata.namespace !== ns) return;
        const tfCurrent = terraform();
        const outputsField = tfCurrent?.status?.availableOutputs;
        const outputsName = Array.isArray(outputsField) ? outputsField[0] : outputsField;
        const outputsSecretName = tfCurrent?.spec?.writeOutputsToSecret?.name || outputsName;
        const planSecretName = (expectedPlanObjectName(tfCurrent).isJson ? expectedPlanObjectName(tfCurrent).name || undefined : undefined);

        if (planSecretName && obj.metadata.name === planSecretName) {
          if (event.type === 'DELETED') {
            setPlanSecret(null);
          } else {
            setPlanSecret({ data: obj.data, stringData: obj.stringData });
          }
        }

        if (outputsSecretName && obj.metadata.name === outputsSecretName) {
          if (event.type === 'DELETED') {
            setOutputsSecret(null);
          } else {
            setOutputsSecret({ data: obj.data, stringData: obj.stringData });
          }
        }
      };
      const noopSetWatchStatus = (_: string) => {};
      watchResource(path, callback, controller, noopSetWatchStatus, undefined, apiResourceStore.contextInfo?.current);
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
                        const result = await handleFluxDiff(tf(), apiResourceStore.contextInfo?.current);
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
                            handleFluxReconcile(tf(), apiResourceStore.contextInfo?.current);
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
                              handleFluxReconcileWithSources(tf(), apiResourceStore.contextInfo?.current);
                              setDropdownOpen(false);
                            }}
                            title={canReconcileWithSources() === false ? "Not permitted" : undefined}
                          >
                            <span>Reconcile with sources</span>
                          </div>
                        </div>
                      </Show>
                    </div>
                    <Show when={tf().status?.plan?.pending}>
                      <button
                        class="sync-button"
                        disabled={canPatch() === false}
                        title={canPatch() === false ? "Not permitted" : undefined}
                        onClick={() => {
                          handleFluxApprove(tf(), apiResourceStore.contextInfo?.current).catch((e) => console.error("Failed to approve plan:", e));
                        }}
                      >
                        <span style={{ "margin-right": "5px", "font-weight": "bold" }}>✔</span> Approve
                      </button>
                    </Show>

                    {tf().spec.suspend ? (
                      <button
                        class="sync-button resume"
                        style={{ "background-color": "#188038", "color": "white" }}
                        disabled={canPatch() === false}
                        title={canPatch() === false ? "Not permitted" : undefined}
                        onClick={() => {
                          handleFluxSuspend(tf(), false, apiResourceStore.contextInfo?.current).catch((e) => console.error("Failed to resume Terraform:", e));
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
                          handleFluxSuspend(tf(), true, apiResourceStore.contextInfo?.current).catch((e) => console.error("Failed to suspend Terraform:", e));
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
                    {tf().spec.storeReadablePlan && (
                      <div class="info-item">
                        <span class="label">Store Readable Plan:</span>
                        <span class="value">{tf().spec.storeReadablePlan}</span>
                      </div>
                    )}
                    {tf().status?.plan?.pending && (
                      <div class="info-item">
                        <span class="label">Plan:</span>
                        <span class="value">Pending</span>
                      </div>
                    )}
                    {(() => {
                      const outputsField = tf().status?.availableOutputs;
                      const outputsName = Array.isArray(outputsField) ? outputsField[0] : outputsField;
                      return (tf().spec?.writeOutputsToSecret?.name || outputsName);
                    })() && (
                      <div class="info-item">
                        <span class="label">Outputs Secret:</span>
                        <span class="value">{tf().spec?.writeOutputsToSecret?.name || (Array.isArray(tf().status?.availableOutputs) ? tf().status?.availableOutputs?.[0] : tf().status?.availableOutputs)}</span>
                      </div>
                    )}
                    {(() => {
                      const ready = tf().status?.conditions?.find((c) => c.type === 'Ready');
                      const message = ready?.message || '';
                      if (!message) return null;
                      return (
                        <div class="info-item" style={{ "grid-column": "4 / 10", "grid-row": "1 / 2" }} title={message}>
                          <span class="label">Status:</span>
                          <span class="value message-cell" style={{ "white-space": "pre-wrap" }}>{message}</span>
                        </div>
                      );
                    })()}
                    <div class="info-item" style="grid-column: 4 / 10; grid-row: 2 / 5;">
                      <span class="label">Events:</span>
                      <ul style="font-family: monospace; font-size: 12px;">
                        {(tf().events || []).sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()).slice(0, 5).map((event) => (
                          <li>
                            <span title={event.lastTimestamp}>{useCalculateAge(event.lastTimestamp)()}</span> {event.involvedObject.kind}/{event.involvedObject.namespace}/{event.involvedObject.name}: 
                            <span>
                              {(() => {
                                const msg = (event.message || '').replace(/[\r\n]+/g, ' ');
                                const truncated = msg.length > 300;
                                const shown = truncated ? msg.slice(0, 300) + '…' : msg;
                                return (
                                  <>
                                    {shown}
                                    {truncated && (
                                      <button
                                        class="inline-open-events"
                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveTab('events'); }}
                                        style={{ "margin-left": "6px", "font-size": "12px", "padding": "0", "border": "none", "background": "transparent", "text-decoration": "underline", "cursor": "pointer" }}
                                        title="Open events"
                                      >
                                        open events..
                                      </button>
                                    )}
                                  </>
                                );
                              })()}
                            </span>
                          </li>
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

              {/* Tabs for Terraform plan and output */}
              <div style="padding: 0rem 1rem 1rem 1rem">
                <Tabs
                  tabs={[
                    { key: 'plan', label: (
                      <span>
                        Plan{(() => {
                          const tf = terraform();
                          const expected = expectedPlanObjectName(tf).name;
                          const name = tf?.status?.plan?.lastApplied || expected;
                          if (!name) return '';
                          const mode = tf?.spec?.storeReadablePlan;
                          if (mode === 'human') return ` (ConfigMap: ${name})`;
                          if (mode === 'json') return ` (Secret: ${name})`;
                          const kind = planSecret() ? 'Secret' : (planConfigMap() ? 'ConfigMap' : '');
                          return kind ? ` (${kind}: ${name})` : ` (${name})`;
                        })()}
                      </span>
                    ) },
                    { key: 'output', label: (
                      <span>
                        Output{(() => {
                          const t = terraform();
                          const outputsField = t?.status?.availableOutputs;
                          const outputsName = Array.isArray(outputsField) ? outputsField[0] : outputsField;
                          const name = t?.spec?.writeOutputsToSecret?.name || outputsName;
                          return name ? ` (Secret: ${name})` : '';
                        })()}
                      </span>
                    ) },
                    { key: 'events', label: (
                      <span>
                        Events{(() => {
                          const t = terraform();
                          const count = (t?.events || []).length;
                          return count ? ` (${count})` : '';
                        })()}
                      </span>
                    ) },
                    { key: 'runner', label: (
                      <span>
                        Runner logs
                      </span>
                    ) }
                  ]}
                  activeKey={activeTab()}
                  onChange={(k) => {
                    setActiveTab(k as 'plan' | 'output' | 'events' | 'runner');
                    if (k === 'runner') {
                      fetchRunnerPodOnce();
                    } else {
                      clearRunnerRetry();
                    }
                  }}
                  style={{ "margin-top": "12px" }}
                />

                <Show when={activeTab() === 'plan'}>
                  <div class="resource-tree-wrapper">
                    <div class="info-grid">
                      <div class="info-item full-width">
                        <pre class="conditions-yaml plan-text">
{(() => {
  const tf = terraform();
  const conds = tf?.status?.conditions;
  const readyMsg = (() => {
    const c = (conds || []).find(c => c.type === 'Ready');
    return c?.message || '';
  })();

  // If user has not enabled readable plan, still surface pending info/ready message (e.g. S3 backend)
  if (!tf?.spec?.storeReadablePlan || tf.spec.storeReadablePlan === 'none') {
    const pendingId = tf?.status?.plan?.pending;
    if (pendingId) {
      return `A plan is pending approval (ID: ${pendingId}).\nNo readable plan is stored because spec.storeReadablePlan is 'none'.\nUse the Approve button above to approve the plan.`;
    }
    if (readyMsg) return readyMsg || 'No plan information available';
    return 'There is no readable plan stored (spec.storeReadablePlan is none).';
  }

  // Render based on mode
  const mode = tf.spec.storeReadablePlan;
  if (mode === 'json') {
    const text = jsonPlanText();
    if (text) return text;
    const name = tf.status?.plan?.lastApplied || '<unknown>';
    // If nothing loaded yet, fall through to messaging below
    return `Plan Secret ${name} not found or failed to decode`;
  }

  // human mode -> prefer ConfigMap, but also accept Secret if present
  const sec = planSecret();
  const cm = planConfigMap();
  if (sec || cm) {
    if (sec) {
      const decoded: Record<string, string> = {};
      if (sec.stringData) {
        Object.entries(sec.stringData).forEach(([k, v]) => { decoded[k] = v; });
      }
      if (sec.data) {
        Object.entries(sec.data).forEach(([k, v]) => {
          try { decoded[k] = atob(v); } catch (_e) { decoded[k] = '<binary data>'; }
        });
      }
      const parts: string[] = [];
      Object.entries(decoded).forEach(([k, v]) => { parts.push(`--- ${k} ---\n${v}`); });
      const base = parts.length ? parts.join('\n\n') : 'No plan available';
      if (readyMsg) {
        if (readyMsg === 'Plan generated: This object is in the plan only mode.') {
          return `${base}\n${readyMsg}`;
        }
        const resName = `${tf.metadata.name}`;
        return `${base}\n${readyMsg}\nTo set the field, you can also run:\n\n tfctl approve ${resName} -f filename.yaml \n`;
      }
      return base;
    }
    if (cm) {
      const sections: string[] = [];
      const addSection = (key: string, value: string) => {
        sections.push(`--- ${key} ---\n${value}`);
      };
      if (cm.data) {
        Object.entries(cm.data).forEach(([k, v]) => addSection(k, v));
      }
      if (cm.binaryData) {
        Object.entries(cm.binaryData).forEach(([k, v]) => {
          try { addSection(k, atob(v)); } catch (_e) { addSection(k, '<binary data>'); }
        });
      }
      const base = sections.length ? sections.join('\n\n') : 'No plan available';
      if (readyMsg) {
        if (readyMsg === 'Plan generated: This object is in the plan only mode.') {
          return `${base}\n${readyMsg}`;
        }
        const resName = `${tf.metadata.name}`;
        return `${base}\n${readyMsg}\nTo set the field, you can also run:\n\n tfctl approve ${resName} -f filename.yaml \n`;
      }
      return base;
    }
  }

  // Nothing loaded
  if (!tf?.status?.plan?.pending) return 'There is no plan pending.';
  return 'No plan available';
})()}
                        </pre>
                      </div>
                    </div>
                  </div>
                </Show>

                <Show when={activeTab() === 'output'}>
                  <div class="resource-tree-wrapper">
                    <div class="info-grid">
                      <div class="info-item full-width">
                        <pre class="conditions-yaml">
{(() => {
  const sec = outputsSecret();
  const outputsField = tf().status?.availableOutputs;
  const outputsName = Array.isArray(outputsField) ? outputsField[0] : outputsField;
  const secretName = tf().spec?.writeOutputsToSecret?.name || outputsName;
  if (!secretName) return 'No outputs secret configured';
  if (!sec || (!sec.data && !sec.stringData)) return `Secret ${secretName} not found`;
  const decoded: Record<string, string> = {};
  if (sec.stringData) {
    Object.entries(sec.stringData).forEach(([k, v]) => { decoded[k] = v; });
  }
  if (sec.data) {
    Object.entries(sec.data).forEach(([k, v]) => {
      try { decoded[k] = atob(v); } catch (_e) { decoded[k] = '<binary data>'; }
    });
  }
  try {
    // Try to pretty print JSON values if single key contains JSON
    if (Object.keys(decoded).length === 1) {
      const only = decoded[Object.keys(decoded)[0]];
      try { return JSON.stringify(JSON.parse(only), null, 2); } catch (_e) { /* fallthrough */ }
    }
  } catch (_e) { /* ignore */ }
  return stringifyYAML(decoded);
})()}
                        </pre>
                      </div>
                    </div>
                  </div>
                </Show>

                <Show when={activeTab() === 'events'}>
                  <div class="resource-tree-wrapper">
                    <div class="info-grid">
                      <div class="info-item full-width">
                        <div class="terraform-events-wrapper">
                          <EventList events={(terraform()?.events || []) as Event[]} />
                        </div>
                      </div>
                    </div>
                  </div>
                </Show>

                <Show when={activeTab() === 'runner'}>
                  <div class="resource-tree-wrapper">
                    <div class="info-grid">
                      <div class="info-item full-width">
                        <Show when={!runnerLoading()} fallback={<div class="drawer-loading">Loading...</div>}>
                          <Show when={runnerPod()} fallback={<pre class="conditions-yaml">{runnerMessage() || 'Runner pod not found'}</pre>}>
                            <LogsViewer resource={runnerPod()} isOpen={activeTab() === 'runner'} />
                          </Show>
                        </Show>
                      </div>
                    </div>
                  </div>
                </Show>
              </div>

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


