import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";
import { TimeSeriesChart } from "./TimeSeriesChart.tsx";

const MAX_SAMPLES = 60;

function parseCpuToMilli(qty: string | undefined): number {
  if (!qty) return 0;
  const v = qty.trim();
  if (v.endsWith("n")) {
    const n = parseFloat(v.slice(0, -1));
    return isFinite(n) ? n / 1_000_000 : 0; // nano -> mCPU
  }
  if (v.endsWith("u")) {
    const n = parseFloat(v.slice(0, -1));
    return isFinite(n) ? n / 1_000 : 0; // micro -> mCPU
  }
  if (v.endsWith("m")) {
    const n = parseFloat(v.slice(0, -1));
    return isFinite(n) ? n : 0; // already mCPU
  }
  const n = parseFloat(v); // cores
  return isFinite(n) ? n * 1000 : 0;
}

function parseMemToMi(qty: string | undefined): number {
  if (!qty) return 0;
  const v = qty.trim();
  // Binary units
  const biUnits: Record<string, number> = { Ki: 1 / 1024, Mi: 1, Gi: 1024, Ti: 1024 * 1024, Pi: 1024 * 1024 * 1024 };
  for (const u of Object.keys(biUnits)) {
    if (v.endsWith(u)) {
      const n = parseFloat(v.slice(0, -u.length));
      return isFinite(n) ? n * biUnits[u] : 0;
    }
  }
  // Decimal units
  const decUnits: Record<string, number> = { k: 1 / 1048.576, M: 1 / 1.048576, G: 953.674, T: 976_562.5 };
  for (const u of Object.keys(decUnits)) {
    if (v.endsWith(u)) {
      const n = parseFloat(v.slice(0, -u.length));
      return isFinite(n) ? n * decUnits[u] : 0;
    }
  }
  // Assume bytes -> Mi
  const n = parseFloat(v);
  return isFinite(n) ? n / (1024 * 1024) : 0;
}

export function MetricsViewer(props: { resource: any; isOpen: boolean }) {
  const apiResourceStore = useApiResourceStore();

  const [loading, setLoading] = createSignal<boolean>(false);
  const [errorMsg, setErrorMsg] = createSignal<string>("");
  const [cpuTotalSeries, setCpuTotalSeries] = createSignal<number[]>([]);
  const [memTotalSeries, setMemTotalSeries] = createSignal<number[]>([]);

  let timer: number | undefined;
  // Reference lines from requests/limits (aggregated across pods)
  const [cpuRequest, setCpuRequest] = createSignal<number | undefined>(undefined);
  const [cpuLimit, setCpuLimit] = createSignal<number | undefined>(undefined);
  const [memRequest, setMemRequest] = createSignal<number | undefined>(undefined);
  const [memLimit, setMemLimit] = createSignal<number | undefined>(undefined);

  const buildK8sPrefix = () => {
    const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : "";
    return ctxName ? `/k8s/${ctxName}` : "/k8s";
  };

  const buildLabelSelector = (resource: any): string | undefined => {
    // Special handling for CronJob: use jobTemplate labels
    const kind = resource?.kind;
    if (kind === "CronJob") {
      const cjLabels = resource?.spec?.jobTemplate?.spec?.template?.metadata?.labels;
      if (cjLabels && typeof cjLabels === "object") {
        return Object.entries(cjLabels)
          .map(([k, v]) => `${k}=${v}`)
          .join(",");
      }
    }
    // Prefer spec.selector.matchLabels
    const matchLabels = resource?.spec?.selector?.matchLabels;
    if (matchLabels && typeof matchLabels === "object") {
      return Object.entries(matchLabels)
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
    }
    // Some controllers (older or Job) may have selector as object without matchLabels
    const selectorObj = resource?.spec?.selector;
    if (selectorObj && typeof selectorObj === "object" && !selectorObj.matchExpressions) {
      return Object.entries(selectorObj as Record<string, string>)
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
    }
    // Fallback to template labels
    const tmplLabels = resource?.spec?.template?.metadata?.labels;
    if (tmplLabels && typeof tmplLabels === "object") {
      return Object.entries(tmplLabels)
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
    }
    return undefined;
  };

  const clampPush = (arr: number[], v: number) => {
    const next = arr.slice();
    next.push(v);
    if (next.length > MAX_SAMPLES) next.shift();
    return next;
  };

  const sumResourcesFromPods = (pods: any[]) => {
    let cpuReq = 0;
    let cpuLim = 0;
    let memReq = 0;
    let memLim = 0;
    for (const pod of pods) {
      const containers: any[] = pod?.spec?.containers || [];
      for (const c of containers) {
        const req = c?.resources?.requests || {};
        const lim = c?.resources?.limits || {};
        if (req?.cpu) cpuReq += parseCpuToMilli(String(req.cpu));
        if (lim?.cpu) cpuLim += parseCpuToMilli(String(lim.cpu));
        if (req?.memory) memReq += parseMemToMi(String(req.memory));
        if (lim?.memory) memLim += parseMemToMi(String(lim.memory));
      }
    }
    setCpuRequest(isFinite(cpuReq) && cpuReq > 0 ? cpuReq : undefined);
    setCpuLimit(isFinite(cpuLim) && cpuLim > 0 ? cpuLim : undefined);
    setMemRequest(isFinite(memReq) && memReq > 0 ? memReq : undefined);
    setMemLimit(isFinite(memLim) && memLim > 0 ? memLim : undefined);
  };

  const fetchPodSpecsForResources = async (kind: string, ns: string, name: string, selector?: string) => {
    const k8sPrefix = buildK8sPrefix();
    try {
      if (kind === "Pod") {
        const podResp = await fetch(`${k8sPrefix}/api/v1/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}`);
        if (podResp.ok) {
          const pod = await podResp.json();
          sumResourcesFromPods([pod]);
        }
        return;
      }
      if (selector) {
        const podsResp = await fetch(
          `${k8sPrefix}/api/v1/namespaces/${encodeURIComponent(ns)}/pods?labelSelector=${encodeURIComponent(selector)}`,
        );
        if (podsResp.ok) {
          const list = await podsResp.json();
          const pods = Array.isArray(list?.items) ? list.items : [];
          sumResourcesFromPods(pods);
        }
      }
    } catch {
      // leave reference lines undefined on failure
    }
  };

  const fetchMetrics = async () => {
    if (!props.resource) return;
    const kind = props.resource.kind;
    const ns = props.resource?.metadata?.namespace || "";
    const name = props.resource?.metadata?.name;
    const k8sPrefix = buildK8sPrefix();
    setLoading(true);
    setErrorMsg("");
    try {
      let url = "";
      if (kind === "Pod") {
        // Try single pod first; if 404, fallback to list and filter
        url = `${k8sPrefix}/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}`;
        // Also fetch pod spec resources for reference lines (non-blocking)
        fetchPodSpecsForResources(kind, ns, name);
      } else {
        const selector = buildLabelSelector(props.resource);
        if (!selector) {
          setErrorMsg("No label selector found on workload");
          setLoading(false);
          return;
        }
        url = `${k8sPrefix}/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(ns)}/pods?labelSelector=${encodeURIComponent(
          selector,
        )}`;
        // Kick off pod spec fetch for requests/limits (non-blocking)
        fetchPodSpecsForResources(kind, ns, name, selector);
      }
      let resp = await fetch(url);
      if (!resp.ok) {
        if (kind === "Pod" && resp.status === 404) {
          // Fallback: list namespace metrics and filter by pod name
          const listUrl = `${k8sPrefix}/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(ns)}/pods`;
          const listResp = await fetch(listUrl);
          if (!listResp.ok) {
            if (listResp.status === 404) {
              throw new Error("No metrics found for this Pod yet");
            }
            throw new Error(`Failed to fetch metrics list: ${listResp.status} ${listResp.statusText}`);
          }
          const listData = await listResp.json();
          const match = (listData?.items || []).find((it: any) => it?.metadata?.name === name);
          if (!match) {
            throw new Error("No metrics found for this Pod yet");
          }
          // Also fetch pod spec resources for reference lines
          fetchPodSpecsForResources(kind, ns, name);
          // Normalize to list flow below
          const items = [match];
          let totalCpu = 0;
          let totalMem = 0;
          for (const pm of items) {
            const containers: any[] = pm?.containers || [];
            let podCpu = 0;
            let podMem = 0;
            for (const c of containers) {
              podCpu += parseCpuToMilli(c?.usage?.cpu);
              podMem += parseMemToMi(c?.usage?.memory);
            }
            totalCpu += podCpu;
            totalMem += podMem;
          }
          setCpuTotalSeries((s) => clampPush(s, totalCpu));
          setMemTotalSeries((s) => clampPush(s, totalMem));
          return;
        }
        if (resp.status === 404) {
          throw new Error("Metrics API endpoint not found");
        }
        throw new Error(`Failed to fetch metrics: ${resp.status} ${resp.statusText}`);
      }
      const data = await resp.json();

      // Normalize to list of PodMetrics
      const items = Array.isArray(data?.items) ? data.items : [data];

      let totalCpu = 0;
      let totalMem = 0;

      for (const pm of items) {
        const containers: any[] = pm?.containers || [];
        let podCpu = 0;
        let podMem = 0;
        for (const c of containers) {
          podCpu += parseCpuToMilli(c?.usage?.cpu);
          podMem += parseMemToMi(c?.usage?.memory);
        }
        totalCpu += podCpu;
        totalMem += podMem;
      }

      // Update totals
      setCpuTotalSeries((s) => clampPush(s, totalCpu));
      setMemTotalSeries((s) => clampPush(s, totalMem));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    // start/stop polling based on isOpen
    if (props.isOpen) {
      // fetch immediately, then poll
      fetchMetrics();
      timer = window.setInterval(fetchMetrics, 5000) as unknown as number;
    } else {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    }
  });

  onCleanup(() => {
    if (timer) {
      clearInterval(timer);
    }
  });

  return (
    <div class="metrics-viewer">
      <Show when={loading()}>
        <div class="drawer-loading">Loading metrics...</div>
      </Show>
      <Show when={!loading()}>
        <Show when={!errorMsg()} fallback={<div class="no-events">{errorMsg()}</div>}>
          <div class="metrics-summary" style="display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 16px;">
            <div class="metric-block" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
              <div class="metric-label" style="font-weight:600;">CPU</div>
            </div>
            <TimeSeriesChart
              data={cpuTotalSeries()}
              width={560}
              height={150}
              yUnit="mCPU"
              sampleIntervalSec={5}
              title="CPU usage"
              referenceLines={[
                ...(cpuRequest() !== undefined ? [{
                  value: cpuRequest() as number,
                  color: "#10b981",
                  dash: "3,3",
                  label: "request",
                }] : []),
                ...(cpuLimit() !== undefined ? [{
                  value: cpuLimit() as number,
                  color: "#ef4444",
                  dash: "0",
                  label: "limit",
                }] : []),
              ]}
            />
            <div class="metric-block" style="display:flex; align-items:center; justify-content:space-between; margin:12px 0 6px;">
              <div class="metric-label" style="font-weight:600;">Memory</div>
            </div>
            <TimeSeriesChart
              data={memTotalSeries()}
              width={560}
              height={150}
              yUnit="MiB"
              sampleIntervalSec={5}
              title="Memory usage"
              referenceLines={[
                ...(memRequest() !== undefined ? [{
                  value: memRequest() as number,
                  color: "#10b981",
                  dash: "3,3",
                  label: "request",
                }] : []),
                ...(memLimit() !== undefined ? [{
                  value: memLimit() as number,
                  color: "#ef4444",
                  dash: "0",
                  label: "limit",
                }] : []),
              ]}
            />
          </div>
        </Show>
      </Show>
    </div>
  );
}


