import { For, createSignal, onMount, onCleanup, createEffect, JSX } from "solid-js";

// Generic Resource type with required metadata properties
type Resource = {
  metadata: {
    name: string;
    namespace?: string;
    creationTimestamp?: string;
    [key: string]: any;
  };
  [key: string]: any;
};

// Column definition
type Column<T> = {
  header: string;
  width: string;
  accessor: (item: T) => JSX.Element;
  title?: (item: T) => string;
};

// Detail row renderer function
type DetailRowRenderer<T> = (item: T) => JSX.Element;

export function ResourceList<T extends Resource>(props: { 
  resources: T[];
  columns: Column<T>[];
  noSelectClass?: boolean;
  onItemClick?: (item: T) => void;
  detailRowRenderer?: DetailRowRenderer<T>;
  rowKeyField?: string; // String key for resource.metadata
}) {
  const [selectedIndex, setSelectedIndex] = createSignal(-1);
  const [listContainer, setListContainer] = createSignal<HTMLDivElement | null>(null);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (props.resources.length === 0) return;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.min(prev + 1, props.resources.length - 1);
        return newIndex;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => {
        const newIndex = prev === -1 ? 0 : Math.max(prev - 1, 0);
        return newIndex;
      });
    } else if (e.key === 'Enter' && props.onItemClick) {
      const index = selectedIndex();
      if (index !== -1 && index < props.resources.length) {
        props.onItemClick(props.resources[index]);
      }
    }
  };

  // Scroll selected item into view whenever selectedIndex changes
  createEffect(() => {
    const index = selectedIndex();
    if (index === -1) return;
    
    // Use requestAnimationFrame to ensure the DOM is updated before scrolling
    requestAnimationFrame(() => {
      const container = listContainer();
      if (!container) return;
      
      // If we have detail rows, we need to select the main row
      let rows: NodeListOf<HTMLTableRowElement>;
      if (props.detailRowRenderer) {
        rows = container.querySelectorAll('tbody tr:nth-child(odd)');
      } else {
        rows = container.querySelectorAll('tbody tr');
      }
      
      if (index >= 0 && index < rows.length) {
        const selectedRow = rows[index];
        
        // Calculate if element is in view
        const containerRect = container.getBoundingClientRect();
        const rowRect = selectedRow.getBoundingClientRect();
        
        // Check if the element is not fully visible
        if (rowRect.top < containerRect.top || rowRect.bottom > containerRect.bottom) {
          // Use scrollIntoView with block: 'center' for better positioning
          selectedRow.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
      }
    });
  });

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div class={`resource-list-container ${props.noSelectClass ? 'no-select' : ''}`} ref={setListContainer}>
      <table class="resource-table">
        <thead>
          <tr>
            {props.columns.map(column => (
              <th style={`width: ${column.width}`}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <For each={props.resources}>
            {(resource, index) => {
              const handleClick = () => {
                if (props.onItemClick) {
                  props.onItemClick(resource);
                }
              };
              
              // Generate a unique key for each row based on index or provided key field
              const keyValue = props.rowKeyField && 
                                props.rowKeyField in resource.metadata ? 
                                resource.metadata[props.rowKeyField] : 
                                index();
              
              return (
                <>
                  <tr 
                    class={selectedIndex() === index() ? 'selected' : ''} 
                    onClick={handleClick}
                  >
                    {props.columns.map(column => (
                      <td title={column.title ? column.title(resource) : undefined}>
                        {column.accessor(resource)}
                      </td>
                    ))}
                  </tr>
                  {props.detailRowRenderer && (
                    <tr class={selectedIndex() === index() ? 'selected' : ''}>
                      {props.detailRowRenderer(resource)}
                    </tr>
                  )}
                </>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
} 