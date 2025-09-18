import { Show, createEffect, createSignal } from "solid-js";
import { useApiResourceStore } from "../../store/apiResourceStore.tsx";
import { stringify } from "@std/yaml";

export function HelmValues(props: { namespace?: string; name: string }) {
  const apiResourceStore = useApiResourceStore();
  const [valuesData, setValuesData] = createSignal<unknown>(null);
  const [loading, setLoading] = createSignal<boolean>(false);
  const [showAllValues, setShowAllValues] = createSignal<boolean>(false);

  const fetchReleaseValues = async () => {
    if (!props.name) return;
    setLoading(true);
    try {
      const namespace = props.namespace || "";
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const apiPrefix = ctxName ? `/api/${ctxName}` : '/api';
      const url = `${apiPrefix}/helm/values/${namespace}/${props.name}?allValues=${showAllValues()}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch Helm release values: ${response.statusText}`);
      }
      const data = await response.json();
      setValuesData(data.values || {});
    } catch (error) {
      console.error("Error fetching Helm release values:", error);
      setValuesData({});
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    // Dependencies: name, namespace, showAllValues
    const _ns = props.namespace || "";
    const _name = props.name;
    showAllValues();
    if (_name) fetchReleaseValues();
  });

  const toggleShowAllValues = () => setShowAllValues(prev => !prev);

  return (
    <div>
      <div class="logs-controls">
        <div class="logs-options-row">
          <div class="logs-follow-controls">
            <label title="Show all values including defaults">
              <input
                type="checkbox"
                checked={showAllValues()}
                onChange={toggleShowAllValues}
              />
              Show all values (including defaults)
            </label>
          </div>
        </div>
      </div>
      <Show when={!loading()} fallback={<div class="drawer-loading">Loading...</div>}>
        <Show when={valuesData()} fallback={<div class="no-values">No values found</div>}>
          <pre class="yaml-content">{valuesData() ? stringify(valuesData()) : ""}</pre>
        </Show>
      </Show>
    </div>
  );
}


