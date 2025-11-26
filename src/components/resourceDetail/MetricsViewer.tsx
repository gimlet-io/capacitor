import { createSignal, createEffect, onCleanup, Show } from "solid-js";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";
import { TimeSeriesChart } from "./TimeSeriesChart.tsx";
import { parseCpuToMilli, parseMemToMi } from "../../utils/metricsUtils.ts";

const MAX_SAMPLES = 60;
const SAMPLE_INTERVAL_SEC = 5;

type NodeStatsTotals = {
  netRx: number;
  netTx: number;
  diskUsedBytes: number;
};

export function MetricsViewer(props: { resource: any; isOpen: boolean }) {
  const apiResourceStore = useApiResourceStore();

  const [loading, setLoading] = createSignal<boolean>(false);
  const [errorMsg, setErrorMsg] = createSignal<string>("");
  const [cpuTotalSeries, setCpuTotalSeries] = createSignal<number[]>([]);
  const [memTotalSeries, setMemTotalSeries] = createSignal<number[]>([]);
  const [netInSeries, setNetInSeries] = createSignal<number[]>([]);
  const [netOutSeries, setNetOutSeries] = createSignal<number[]>([]);
  const [diskSeries, setDiskSeries] = createSignal<number[]>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = createSignal<boolean>(false);

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

  let lastNetTotals: { rx: number; tx: number } | undefined;

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

  const fetchPodSpecsForResources = async (kind: string, ns: string, name: string, selector?: string): Promise<any[]> => {
    const k8sPrefix = buildK8sPrefix();
    try {
      if (kind === "Pod") {
        const podResp = await fetch(`${k8sPrefix}/api/v1/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}`);
        if (podResp.ok) {
          const pod = await podResp.json();
          sumResourcesFromPods([pod]);
          return [pod];
        }
        return [];
      }
      if (selector) {
        const podsResp = await fetch(
          `${k8sPrefix}/api/v1/namespaces/${encodeURIComponent(ns)}/pods?labelSelector=${encodeURIComponent(selector)}`,
        );
        if (podsResp.ok) {
          const list = await podsResp.json();
          const pods = Array.isArray(list?.items) ? list.items : [];
          sumResourcesFromPods(pods);
          return pods;
        }
      }
      return [];
    } catch {
      // leave reference lines undefined on failure
      return [];
    }
  };

  const fetchNodeStatsForPods = async (pods: any[]): Promise<NodeStatsTotals | undefined> => {
    if (!pods || pods.length === 0) return undefined;
    const k8sPrefix = buildK8sPrefix();
    const byNode: Record<string, Array<{ namespace: string; name: string }>> = {};

    for (const pod of pods) {
      const nodeName = pod?.spec?.nodeName;
      const namespace = pod?.metadata?.namespace;
      const name = pod?.metadata?.name;
      if (!nodeName || !namespace || !name) continue;
      if (!byNode[nodeName]) {
        byNode[nodeName] = [];
      }
      byNode[nodeName].push({ namespace, name });
    }

    let totalRx = 0;
    let totalTx = 0;
    let totalDiskUsedBytes = 0;

    const nodeNames = Object.keys(byNode);
    for (const nodeName of nodeNames) {
      try {
        const summaryUrl = `${k8sPrefix}/api/v1/nodes/${encodeURIComponent(nodeName)}/proxy/stats/summary`;
        const resp = await fetch(summaryUrl);
        if (!resp.ok) continue;
        const summary = await resp.json();
        const summaryPods: any[] = Array.isArray(summary?.pods) ? summary.pods : [];
        const wanted = byNode[nodeName];

        for (const sp of summaryPods) {
          const ref = sp?.podRef;
          if (!ref) continue;
          if (!wanted.find((w) => w.name === ref.name && w.namespace === ref.namespace)) continue;
          const net = sp?.network;
          if (net) {
            // Prefer aggregate rxBytes/txBytes on the pod network, fall back to summing interfaces if needed.
            let rxBytes = 0;
            let txBytes = 0;
            if (typeof net.rxBytes === "number" || typeof net.txBytes === "number") {
              if (typeof net.rxBytes === "number") rxBytes = net.rxBytes;
              if (typeof net.txBytes === "number") txBytes = net.txBytes;
            } else if (Array.isArray(net.interfaces)) {
              for (const iface of net.interfaces) {
                if (typeof iface?.rxBytes === "number") rxBytes += iface.rxBytes;
                if (typeof iface?.txBytes === "number") txBytes += iface.txBytes;
              }
            }
            totalRx += rxBytes;
            totalTx += txBytes;
          }

          // Aggregate disk usage from volumeStats.usedBytes where available.
          const vols: any[] = Array.isArray(sp?.volumeStats) ? sp.volumeStats : [];
          for (const vs of vols) {
            let used = 0;
            if (typeof vs?.usedBytes === "number") {
              used = vs.usedBytes;
            } else if (typeof vs?.fsStats?.usedBytes === "number") {
              used = vs.fsStats.usedBytes;
            }
            if (used > 0) {
              totalDiskUsedBytes += used;
            }
          }
        }
      } catch {
        // Ignore node stats errors; CPU/memory metrics should still work.
      }
    }

    return { netRx: totalRx, netTx: totalTx, diskUsedBytes: totalDiskUsedBytes };
  };

  const updateNetworkSeriesFromTotals = (totals: { rx: number; tx: number } | undefined) => {
    if (!totals) return;
    if (!lastNetTotals) {
      // First sample: we cannot compute a rate yet, so start from zero.
      lastNetTotals = { rx: totals.rx, tx: totals.tx };
      setNetInSeries((s) => clampPush(s, 0));
      setNetOutSeries((s) => clampPush(s, 0));
      return;
    }

    const deltaRx = Math.max(0, totals.rx - lastNetTotals.rx);
    const deltaTx = Math.max(0, totals.tx - lastNetTotals.tx);
    lastNetTotals = { rx: totals.rx, tx: totals.tx };

    const rxPerSec = deltaRx / SAMPLE_INTERVAL_SEC;
    const txPerSec = deltaTx / SAMPLE_INTERVAL_SEC;
    const rxKiBPerSec = rxPerSec / 1024;
    const txKiBPerSec = txPerSec / 1024;

    setNetInSeries((s) => clampPush(s, rxKiBPerSec));
    setNetOutSeries((s) => clampPush(s, txKiBPerSec));
  };

  const updateDiskSeriesFromBytes = (diskBytes: number | undefined) => {
    if (typeof diskBytes !== "number" || !isFinite(diskBytes) || diskBytes < 0) return;
    const diskMiB = diskBytes / (1024 * 1024);
    setDiskSeries((s) => clampPush(s, diskMiB));
  };

  const fetchMetrics = async () => {
    if (!props.resource) return;
    const kind = props.resource.kind;
    const ns = props.resource?.metadata?.namespace || "";
    const name = props.resource?.metadata?.name;
    const k8sPrefix = buildK8sPrefix();
    if (!hasLoadedOnce()) {
      setLoading(true);
    }
    setErrorMsg("");
    try {
      let url = "";
      let selector: string | undefined;
      let podsPromise: Promise<any[]> | undefined;
      if (kind === "Pod") {
        // Try single pod first; if 404, fallback to list and filter
        url = `${k8sPrefix}/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(ns)}/pods/${encodeURIComponent(name)}`;
        // Also fetch pod spec resources for reference lines and network metrics
        podsPromise = fetchPodSpecsForResources(kind, ns, name);
      } else {
        selector = buildLabelSelector(props.resource);
        if (!selector) {
          setErrorMsg("No label selector found on workload");
          setLoading(false);
          return;
        }
        url = `${k8sPrefix}/apis/metrics.k8s.io/v1beta1/namespaces/${encodeURIComponent(ns)}/pods?labelSelector=${encodeURIComponent(
          selector,
        )}`;
        // Kick off pod spec fetch for requests/limits and network metrics
        podsPromise = fetchPodSpecsForResources(kind, ns, name, selector);
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
          // Network metrics for single pod based on pod specs
          if (!podsPromise) {
            podsPromise = fetchPodSpecsForResources(kind, ns, name);
          }
          try {
            const pods = await podsPromise;
            const statsTotals = await fetchNodeStatsForPods(pods);
            if (statsTotals) {
              updateNetworkSeriesFromTotals({ rx: statsTotals.netRx, tx: statsTotals.netTx });
              updateDiskSeriesFromBytes(statsTotals.diskUsedBytes);
            }
          } catch {
            // Ignore node stats errors.
          }
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

      // Update network in/out using pod specs and kubelet stats/summary.
      if (!podsPromise && selector) {
        podsPromise = fetchPodSpecsForResources(kind, ns, name, selector);
      }
      if (podsPromise) {
        try {
          const pods = await podsPromise;
          const statsTotals = await fetchNodeStatsForPods(pods);
          if (statsTotals) {
            updateNetworkSeriesFromTotals({ rx: statsTotals.netRx, tx: statsTotals.netTx });
            updateDiskSeriesFromBytes(statsTotals.diskUsedBytes);
          }
        } catch {
          // Ignore node stats errors.
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
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
      // Reset loading state and network/disk deltas when the viewer is closed
      setHasLoadedOnce(false);
      lastNetTotals = undefined;
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
          <div
            class="metrics-summary"
            style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; margin-bottom: 8px;"
          >
            <div class="metric-tile">
              <div class="metric-block" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                <div class="metric-label" style="font-weight:600;">CPU</div>
              </div>
              <TimeSeriesChart
                data={cpuTotalSeries()}
                width={520}
                height={120}
                yUnit="mCPU"
                sampleIntervalSec={SAMPLE_INTERVAL_SEC}
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
            </div>
            <div class="metric-tile">
              <div class="metric-block" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                <div class="metric-label" style="font-weight:600;">Memory</div>
              </div>
              <TimeSeriesChart
                data={memTotalSeries()}
                width={520}
                height={120}
                yUnit="MiB"
                sampleIntervalSec={SAMPLE_INTERVAL_SEC}
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
            <div class="metric-tile">
              <div class="metric-block" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                <div class="metric-label" style="font-weight:600;">Network in</div>
              </div>
              <TimeSeriesChart
                data={netInSeries()}
                width={520}
                height={120}
                yUnit="KiB/s"
                sampleIntervalSec={SAMPLE_INTERVAL_SEC}
                title="Network in"
                stroke="#0ea5e9"
                areaFill="rgba(14,165,233,0.12)"
              />
            </div>
            <div class="metric-tile">
              <div class="metric-block" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                <div class="metric-label" style="font-weight:600;">Network out</div>
              </div>
              <TimeSeriesChart
                data={netOutSeries()}
                width={520}
                height={120}
                yUnit="KiB/s"
                sampleIntervalSec={SAMPLE_INTERVAL_SEC}
                title="Network out"
                stroke="#6366f1"
                areaFill="rgba(99,102,241,0.12)"
              />
            </div>
            <div class="metric-tile">
              <div class="metric-block" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
                <div class="metric-label" style="font-weight:600;">Disk</div>
              </div>
              <TimeSeriesChart
                data={diskSeries()}
                width={520}
                height={120}
                yUnit="MiB"
                sampleIntervalSec={SAMPLE_INTERVAL_SEC}
                title="Disk usage"
                stroke="#f97316"
                areaFill="rgba(249,115,22,0.12)"
              />
            </div>
          </div>
        </Show>
      </Show>
    </div>
  );
}


