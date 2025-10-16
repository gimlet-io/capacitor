// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { JSX } from "solid-js";

export function DetailRowCard(props: {
  columnCount: number;
  children: JSX.Element;
  style?: string;
  class?: string;
}) {
  const baseStyle = "padding: 16px 18px; margin: 6px 16px 12px 32px; background: var(--linear-bg-secondary); border: 1px solid var(--linear-border); border-radius: 8px;";
  const mergedStyle = props.style ? `${baseStyle} ${props.style}` : baseStyle;
  const mergedClass = props.class ? `second-row ${props.class}` : "second-row";

  return (
    <td colSpan={props.columnCount}>
      <div class={mergedClass} style={mergedStyle}>
        {props.children}
      </div>
    </td>
  );
}


