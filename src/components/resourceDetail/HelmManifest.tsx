import { Show, createEffect, createSignal } from "solid-js";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";

export function HelmManifest(props: { namespace?: string; name: string; revision?: number }) {
  const apiResourceStore = useApiResourceStore();
  const [manifestData, setManifestData] = createSignal<string>("");
  const [loading, setLoading] = createSignal<boolean>(false);

  const fetchLatestRevision = async (namespace: string, name: string): Promise<number | null> => {
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
      const hist = await fetch(`${apiPrefix}/helm/history/${namespace}/${name}`);
      if (!hist.ok) return null;
      const data = await hist.json();
      const releases: Array<{ revision: number }> = Array.isArray(data?.releases) ? data.releases : [];
      if (releases.length === 0) return null;
      const latest = releases.sort((a, b) => (b.revision || 0) - (a.revision || 0))[0];
      return latest.revision;
    } catch (_) {
      return null;
    }
  };

  const fetchManifest = async () => {
    if (!props.name) return;
    setLoading(true);
    try {
      const namespace = props.namespace || "";
      let revision = props.revision;
      if (!revision) {
        revision = await fetchLatestRevision(namespace, props.name) || undefined;
      }
      if (!revision) {
        setManifestData("");
        return;
      }
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
      const url = `${apiPrefix}/helm/manifest/${namespace}/${props.name}?revision=${revision}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch Helm release manifest: ${response.statusText}`);
      }
      const data = await response.json();
      setManifestData(data.manifest || "");
    } catch (error) {
      console.error("Error fetching Helm release manifest:", error);
      setManifestData("Error fetching manifest: " + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    // Dependencies: namespace, name, revision
    const _ns = props.namespace || "";
    const _name = props.name;
    const _rev = props.revision;
    if (_name) fetchManifest();
  });

  return (
    <Show when={!loading()} fallback={<div class="drawer-loading">Loading...</div>}>
      <Show when={manifestData()} fallback={<div class="no-manifest">No manifest found</div>}>
        <pre class="yaml-content">{manifestData()}</pre>
      </Show>
    </Show>
  );
}


