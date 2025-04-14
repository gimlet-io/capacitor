import { For, Show, onMount, onCleanup, createSignal, createEffect } from "solid-js";

interface ComboboxProps {
  value: string;
  options: string[];
  onInput: (value: string) => void;
  onSelect: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  hotkey?: string;
  placeholder?: string;
}

export function Combobox(props: ComboboxProps) {
  let inputRef: HTMLInputElement | undefined;
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [filteredOptions, setFilteredOptions] = createSignal(props.options);
  const [isOpen, setIsOpen] = createSignal(false);

  // Update filtered options when input value changes
  createEffect(() => {
    const value = props.value.toLowerCase();
    setFilteredOptions(
      props.options.filter(option => 
        option.toLowerCase().includes(value)
      )
    );
    // Reset selected index when filtering
    setSelectedIndex(0);
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    // Focus input on hotkey if not already focused
    if (props.hotkey && e.key === props.hotkey && document.activeElement !== inputRef) {
      e.preventDefault();
      inputRef?.focus();
      props.onFocus();
      setIsOpen(true);
    }

    // Handle arrow key navigation when dropdown is open
    if (isOpen()) {
      const filtered = filteredOptions();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => 
          Math.min(prev + 1, filtered.length - 1)
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = filtered[selectedIndex()];
        if (selected) {
          props.onSelect(selected);
          setIsOpen(false);
          inputRef?.blur();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        inputRef?.blur();
      }
    }

    if (document.activeElement === inputRef && e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      inputRef?.blur();
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div class="combobox">
      <input
        ref={inputRef}
        type="text"
        class="combobox-input"
        value={props.value}
        onInput={(e) => {
          props.onInput(e.currentTarget.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          props.onFocus();
          setIsOpen(true);
        }}
        onBlur={() => {
          props.onBlur();
          // Use setTimeout to allow click events to fire before closing
          setTimeout(() => setIsOpen(false), 200);
        }}
        placeholder={props.placeholder}
      />
      {props.hotkey && <span class="combobox-hotkey">{props.hotkey}</span>}
      <Show when={isOpen()}>
        <div class="combobox-dropdown">
          <For each={filteredOptions()}>
            {(option, index) => (
              <div
                class="combobox-option"
                classList={{ 
                  'selected': option === props.value,
                  'highlighted': index() === selectedIndex()
                }}
                onClick={() => {
                  props.onSelect(option);
                  setIsOpen(false);
                }}
              >
                {option}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
} 