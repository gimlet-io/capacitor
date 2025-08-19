import { For, JSX } from "solid-js";

export type TabItem = {
  key: string;
  label: string | JSX.Element;
};

type TabsProps = {
  tabs: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  class?: string;
  style?: JSX.CSSProperties;
};

export function Tabs(props: TabsProps) {
  return (
    <div class={`main-tabs ${props.class || ""}`.trim()} style={props.style}>
      <For each={props.tabs}>
        {(tab, index) => (
          <button
            type="button"
            class={`tab-button ${props.activeKey === tab.key ? "active" : ""}`}
            onClick={() => props.onChange(tab.key)}
            style={{ "margin-right": index() < (props.tabs.length - 1) ? "8px" : undefined }}
          >
            {tab.label}
          </button>
        )}
      </For>
    </div>
  );
}


