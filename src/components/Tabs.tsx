// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { For, JSX } from "solid-js";

export type TabItem = {
  key: string;
  label: string | JSX.Element;
  disabled?: boolean;
};

type TabsProps = {
  tabs: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  class?: string;
  style?: JSX.CSSProperties;
  buttonClass?: string;
  activeClass?: string;
};

export function Tabs(props: TabsProps) {
  const buttonCls = props.buttonClass || "tab-button";
  const activeCls = props.activeClass || "active";
  return (
    <div class={`main-tabs ${props.class || ""}`.trim()} style={props.style}>
      <For each={props.tabs}>
        {(tab, index) => (
          <button
            type="button"
            class={`${buttonCls} ${props.activeKey === tab.key ? activeCls : ""} ${tab.disabled ? "disabled" : ""}`.trim()}
            disabled={tab.disabled}
            onClick={() => {
              if (!tab.disabled) {
                props.onChange(tab.key);
              }
            }}
            style={{ "margin-right": index() < (props.tabs.length - 1) ? "8px" : undefined }}
          >
            {tab.label}
          </button>
        )}
      </For>
    </div>
  );
}


