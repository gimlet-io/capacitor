import { createMemo } from "solid-js";

export function Sparkline(props: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  class?: string;
  title?: string;
}) {
  const width = () => props.width ?? 120;
  const height = () => props.height ?? 28;
  const stroke = () => props.stroke ?? "#4f7cff";
  const strokeWidth = () => props.strokeWidth ?? 1.5;
  const fill = () => props.fill ?? "none";

  const pathD = createMemo(() => {
    const values = props.data ?? [];
    const n = values.length;
    if (n === 0) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const w = width();
    const h = height();

    const scaleX = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * (w - 2)) + 1;
    const scaleY = (v: number) => {
      if (max === min) return h / 2;
      // invert y (higher values at top), leave 1px padding
      return 1 + (h - 2) * (1 - (v - min) / (max - min));
    };

    let d = `M ${scaleX(0)} ${scaleY(values[0])}`;
    for (let i = 1; i < n; i++) {
      d += ` L ${scaleX(i)} ${scaleY(values[i])}`;
    }
    return d;
  });

  return (
    <svg
      class={props.class}
      width={width()}
      height={height()}
      viewBox={`0 0 ${width()} ${height()}`}
      aria-label={props.title || "sparkline"}
    >
      <path d={pathD()} stroke={stroke()} stroke-width={strokeWidth()} fill={fill()} />
    </svg>
  );
}


