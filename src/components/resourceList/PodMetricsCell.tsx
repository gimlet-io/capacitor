// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createSignal, onMount, onCleanup, Show } from "solid-js";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";
import { parseCpuToMilli, parseMemToMi } from "../../utils/metricsUtils.ts";
import type { Pod } from "../../types/k8s.ts";

function buildK8sPrefix(contextName?: string) {
  const ctxName = contextName ? encodeURIComponent(contextName) : "";
  return ctxName ? `/k8s/${ctxName}` : "/k8s";
}

type PodUsage = {
  cpu: number;
  mem: number;
};

type NamespaceKey = string;

const namespaceMetricsCache = new Map<NamespaceKey, Map<string, PodUsage>>();
const namespaceMetricsInFlight = new Map<NamespaceKey, Promise<void>>();

function buildNamespaceKey(contextName: string | undefined, namespace: string): NamespaceKey {
  return `${contextName || ""}::${namespace}`;
}

async function fetchNamespaceMetrics(contextName: string | undefined, namespace: string) {
  const key = buildNamespaceKey(contextName, namespace);
  const inFlight = namespaceMetricsInFlight.get(key);
  if (inFlight) {
    await inFlight;
    return;
  }

  const promise = (async () => {
    try {
      const prefix = buildK8sPrefix(contextName);
      const url =
        `${prefix}/apis/metrics.k8s.io/v1beta1/namespaces/` +
        `${encodeURIComponent(namespace)}/pods`;

      const resp = await fetch(url);
      if (!resp.ok) {
        namespaceMetricsCache.delete(key);
        return;
      }

      const data = await resp.json() as {
        items?: Array<{
          metadata?: { name?: string };
          containers?: Array<{ usage?: { cpu?: string; memory?: string } }>;
        }>;
      };
      const items = data?.items || [];

      const byPod = new Map<string, PodUsage>();

      for (const item of items) {
        const podName = item?.metadata?.name;
        if (!podName) continue;

        let cpuTotal = 0;
        let memTotal = 0;
        const containers = item?.containers || [];
        for (const c of containers) {
          cpuTotal += parseCpuToMilli(c?.usage?.cpu);
          memTotal += parseMemToMi(c?.usage?.memory);
        }

        byPod.set(podName, { cpu: cpuTotal, mem: memTotal });
      }

      namespaceMetricsCache.set(key, byPod);
    } finally {
      namespaceMetricsInFlight.delete(key);
    }
  })();

  namespaceMetricsInFlight.set(key, promise);
  await promise;
}

async function getPodUsage(contextName: string | undefined, namespace: string, name: string): Promise<PodUsage | undefined> {
  const key = buildNamespaceKey(contextName, namespace);
  await fetchNamespaceMetrics(contextName, namespace);
  const byPod = namespaceMetricsCache.get(key);
  return byPod?.get(name);
}

export function PodMetricsCell(props: { pod: Pod; kind: "cpu" | "mem" }) {
  const apiResourceStore = useApiResourceStore();

  const [cpuActual, setCpuActual] = createSignal<number | null>(null);
  const [memActual, setMemActual] = createSignal<number | null>(null);
  const [cpuRequest, setCpuRequest] = createSignal<number | null>(null);
  const [memRequest, setMemRequest] = createSignal<number | null>(null);
  const [cpuLimit, setCpuLimit] = createSignal<number | null>(null);
  const [memLimit, setMemLimit] = createSignal<number | null>(null);
  const [failed, setFailed] = createSignal(false);

  let timer: number | undefined;

  const computeRequestsAndLimitsFromSpec = () => {
    const containers = props.pod?.spec?.containers || [];
    let cpuReqTotal = 0;
    let memReqTotal = 0;
    let cpuLimTotal = 0;
    let memLimTotal = 0;
    let hasCpuRequest = false;
    let hasMemRequest = false;
    let hasCpuLimit = false;
    let hasMemLimit = false;

    for (const c of containers) {
      const req = c?.resources?.requests || {};
      const lim = c?.resources?.limits || {};
      if (req.cpu) {
        cpuReqTotal += parseCpuToMilli(String(req.cpu));
        hasCpuRequest = true;
      }
      if (req.memory) {
        memReqTotal += parseMemToMi(String(req.memory));
        hasMemRequest = true;
      }
      if (lim.cpu) {
        cpuLimTotal += parseCpuToMilli(String(lim.cpu));
        hasCpuLimit = true;
      }
      if (lim.memory) {
        memLimTotal += parseMemToMi(String(lim.memory));
        hasMemLimit = true;
      }
    }

    setCpuRequest(hasCpuRequest ? cpuReqTotal : null);
    setMemRequest(hasMemRequest ? memReqTotal : null);
    setCpuLimit(hasCpuLimit ? cpuLimTotal : null);
    setMemLimit(hasMemLimit ? memLimTotal : null);
  };

  const fetchOnce = async () => {
    try {
      const phase = props.pod.status?.phase;
      if (phase !== "Running") {
        setCpuActual(null);
        setMemActual(null);
        setFailed(true);
        return;
      }

      const ns = props.pod.metadata.namespace;
      const name = props.pod.metadata.name;
      const ctx = apiResourceStore.contextInfo?.current;
      const usage = await getPodUsage(ctx, ns, name);
      if (!usage) {
        setFailed(true);
        return;
      }

      setCpuActual(usage.cpu);
      setMemActual(usage.mem);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  onMount(() => {
    computeRequestsAndLimitsFromSpec();
    fetchOnce();
    // Refresh every 5 seconds to keep metrics feeling live
    timer = globalThis.setInterval(fetchOnce, 5_000) as unknown as number;
  });

  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  const renderValue = () => {
    if (props.kind === "cpu") {
      const actual = cpuActual();
      const limit = cpuLimit();
      const actualStr = actual != null ? `${Math.round(actual)}m` : "-";
      const limitStr = limit != null ? `${Math.round(limit)}m` : "";
      return limit != null ? `${actualStr}/${limitStr}` : actualStr;
    }
    const actual = memActual();
    const limit = memLimit();
    const actualStr = actual != null ? `${Math.round(actual)}Mi` : "-";
    const limitStr = limit != null ? `${Math.round(limit)}Mi` : "";
    return limit != null ? `${actualStr}/${limitStr}` : actualStr;
  };

  const showLimitWarning = () => {
    if (props.kind === "cpu") {
      const actual = cpuActual();
      const limit = cpuLimit();
      if (actual == null || limit == null || limit <= 0) return false;
      return actual >= 0.8 * limit;
    }
    const actual = memActual();
    const limit = memLimit();
    if (actual == null || limit == null || limit <= 0) return false;
    return actual >= 0.8 * limit;
  };

  const limitWarningTitle = () => {
    if (!showLimitWarning()) return undefined;
    if (props.kind === "cpu") {
      const actual = cpuActual();
      const limit = cpuLimit();
      if (actual == null || limit == null) return undefined;
      const actualStr = `${Math.round(actual)}m`;
      const limitStr = `${Math.round(limit)}m`;
      return `Close to CPU limit: ${actualStr}/${limitStr}`;
    }
    const actual = memActual();
    const limit = memLimit();
    if (actual == null || limit == null) return undefined;
    const actualStr = `${Math.round(actual)}Mi`;
    const limitStr = `${Math.round(limit)}Mi`;
    return `Close to memory limit: ${actualStr}/${limitStr}`;
  };

  const showRequestWarning = () => {
    if (props.kind === "cpu") {
      const actual = cpuActual();
      const request = cpuRequest();
      if (actual == null || request == null || request <= 0) return false;
      return actual > request;
    }
    const actual = memActual();
    const request = memRequest();
    if (actual == null || request == null || request <= 0) return false;
    return actual > request;
  };

  const requestWarningTitle = () => {
    if (!showRequestWarning()) return undefined;
    if (props.kind === "cpu") {
      const actual = cpuActual();
      const request = cpuRequest();
      if (actual == null || request == null) return undefined;
      const actualStr = `${Math.round(actual)}m`;
      const requestStr = `${Math.round(request)}m`;
      return `CPU usage (${actualStr}) is higher than requested (${requestStr}). Consider increasing CPU requests or investigating resource requests and autoscaling.`;
    }
    const actual = memActual();
    const request = memRequest();
    if (actual == null || request == null) return undefined;
    const actualStr = `${Math.round(actual)}Mi`;
    const requestStr = `${Math.round(request)}Mi`;
    return `Memory usage (${actualStr}) is higher than requested (${requestStr}). Consider increasing memory requests or investigating resource requests and limits.`;
  };

  return (
    <Show when={!failed()} fallback={<span>-</span>}>
      <span style="display: inline-flex; align-items: center; gap: 4px;">
        <span>{renderValue()}</span>
        {showLimitWarning() && (
          <span
            style="color: var(--linear-red); font-weight: 700; cursor: default;"
            title={limitWarningTitle()}
          >
            !
          </span>
        )}
        {showRequestWarning() && (
          <span
            style="display: inline-block; width: 8px; height: 8px; background-color: #facc15; border-radius: 2px; cursor: default;"
            title={requestWarningTitle()}
          />
        )}
      </span>
    </Show>
  );
}


