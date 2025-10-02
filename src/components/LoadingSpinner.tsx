import { createSignal, onMount, onCleanup } from "solid-js";

interface LoadingSpinnerProps {
  message?: string;
}

export function LoadingSpinner(props: LoadingSpinnerProps) {
  const [frame, setFrame] = createSignal(0);
  const frames = ["|", "/", "-", "\\"];
  const message = props.message || "loading";

  let timerId: number | undefined;

  onMount(() => {
    timerId = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, 80) as unknown as number;
  });

  onCleanup(() => {
    if (timerId !== undefined) {
      clearInterval(timerId);
    }
  });

  return (
    <div class="loading-spinner-text">
      [{frames[frame()]}] {message}
    </div>
  );
}
