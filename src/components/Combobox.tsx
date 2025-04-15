import { For, Show, onMount, onCleanup, createSignal, createEffect } from "solid-js";

interface ComboboxOption {
  value: string;
  label: string;
  hotkey?: string;
}

interface ComboboxProps {
  value: string;
  options: ComboboxOption[];
  onSelect: (value: string) => void;
  onFocus?: () => void;
  hotkey?: string;
  placeholder?: string;
  disableKeyboardNavigation?: boolean;
}

export function Combobox(props: ComboboxProps) {
  let inputRef: HTMLInputElement | undefined;
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [filter, setFilter] = createSignal(props.value);
  const [filteredOptions, setFilteredOptions] = createSignal(props.options);
  const [isOpen, setIsOpen] = createSignal(false);

  // Update filtered options when input value changes
  createEffect(() => {
    setFilteredOptions(
      props.options.filter(option => 
        option.label.toLowerCase().includes(filter().toLowerCase())
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
      props.onFocus?.();
      setFilter("");
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
        const selected = filteredOptions()[selectedIndex()];
        if (selected) {
          props.onSelect(selected.value);
          setFilter(selected.label);
          setIsOpen(false);
          inputRef?.blur();
        }
      } else if (e.key === 'Escape') {
        console.log("Escape");
        e.preventDefault();
        setIsOpen(false);
        setFilter(props.value);
        inputRef?.blur();
      }
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
        value={isOpen() ? filter() : props.options.find(option => option.value === props.value)?.label || props.value}
        onfocus={() => {
          setIsOpen(true);
          setFilter("");
        }}
        onInput={(e) => {
          setFilter(e.currentTarget.value);
        }}
        onBlur={() => {
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
                class="combobox-option relative"
                classList={{ 
                  'selected': !props.disableKeyboardNavigation && option.value === props.value,
                  'highlighted': !props.disableKeyboardNavigation && index() === selectedIndex()
                }}
                onClick={() => {
                  props.onSelect(option.value);
                  setFilter(option.label);
                  setIsOpen(false);
                  inputRef?.blur();
                }}
              >
                {option.label}
                {option.hotkey && <span class="combobox-option-hotkey">{option.hotkey}</span>}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
} 