// deno-lint-ignore-file jsx-button-has-type
import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
  For,
} from "solid-js";
import type { Kustomization } from "../../types/k8s.ts";
import { parse as parseYAML, stringify as stringifyYAML } from "@std/yaml";

// Interface for the new API response structure
interface FluxDiffResult {
  fileName: string;
  clusterYaml: string;
  appliedYaml: string;
  created: boolean;
  hasChanges: boolean;
  deleted: boolean;
}

// Interface for file diff sections
interface FileDiffSection {
  fileName: string;
  status: 'created' | 'modified' | 'deleted';
  diffLines: string[];
  isExpanded: boolean;
  addedLines: number;
  removedLines: number;
}

export function DiffDrawer(props: {
  resource: Kustomization;
  diffData: FluxDiffResult[] | null;
  isOpen: boolean;
  onClose: () => void;
  loading: boolean;
}) {
  let contentRef: HTMLDivElement | undefined;

  // Create a state variable for the diff sections
  const [diffSections, setDiffSections] = createSignal<FileDiffSection[]>([]);
  // Create a state for normalization toggle
  const [normalizeResources, setNormalizeResources] = createSignal<boolean>(true);

  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      props.onClose();
    }
  };

  // Focus management
  createEffect(() => {
    if (props.isOpen) {
      setTimeout(() => contentRef?.focus(), 50);
      document.addEventListener("keydown", handleKeyDown);
    } else {
      document.removeEventListener("keydown", handleKeyDown);
    }
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });
  
  // Generate diff when diffData or normalization settings change
  createEffect(() => {
    if (props.diffData) {
      const sections: FileDiffSection[] = [];
      
      // Process each file diff result
      props.diffData.forEach((result) => {
        let fromYAML = result.clusterYaml;
        let toYAML = result.appliedYaml;
        
        if (normalizeResources()) {
          // Normalize the resources before diffing
          fromYAML = normalizeK8sResources(result.clusterYaml);
          toYAML = normalizeK8sResources(result.appliedYaml);
        }
        
        // Generate diff for this file
        const fromLines = fromYAML.split("\n");
        const toLines = toYAML.split("\n");
        
        // Generate full diff for this file
        const diffLines = generateFullDiff(fromLines, toLines);
        
        // Calculate stats
        const addedLines = diffLines.filter(line => line.startsWith('+')).length;
        const removedLines = diffLines.filter(line => line.startsWith('-')).length;
        
        // Determine status
        let status: 'created' | 'modified' | 'deleted';
        if (result.created) {
          status = 'created';
        } else if (result.deleted) {
          status = 'deleted';
        } else {
          status = 'modified';
        }
        
        // Determine if section should be expanded by default
        // Only modified files with changes should be expanded
        const isExpanded = status === 'modified' && (addedLines > 0 || removedLines > 0);
        
        // Add section
        sections.push({
          fileName: result.fileName,
          status,
          diffLines,
          isExpanded,
          addedLines,
          removedLines
        });
      });
      
      setDiffSections(sections);
    }
  });
  
  // Toggle section expansion
  const toggleSection = (index: number) => {
    setDiffSections(prev => {
      const updated = [...prev];
      updated[index] = {...updated[index], isExpanded: !updated[index].isExpanded};
      return updated;
    });
  };
  
  // Toggle normalization
  const toggleNormalization = () => {
    setNormalizeResources(!normalizeResources());
  };
  
  // Function to normalize Kubernetes resources YAML
  const normalizeK8sResources = (yamlString: string): string => {
    if (!yamlString) return yamlString;
    
    try {
      // Parse YAML string to document array
      const documents = parseYAMLDocuments(yamlString);
      if (!documents || documents.length === 0) return yamlString;
      
      // Normalize each document
      const normalizedDocs = documents.map(doc => normalizeResource(doc));
      
      // Serialize back to YAML
      return serializeYAMLDocuments(normalizedDocs);
    } catch (error) {
      console.error("Error normalizing resources:", error);
      return yamlString;
    }
  };
  
  // Parse YAML string into array of documents
  const parseYAMLDocuments = (yamlString: string): any[] => {
    const documents: any[] = [];
    const docStrings = yamlString.split(/^---$/m).filter(doc => doc.trim());
    
    for (const docString of docStrings) {
      try {
        // Use proper YAML parser
        const doc = parseYAML(docString);
        documents.push(doc);
      } catch (e) {
        // If parsing fails, try to keep the original string
        documents.push(docString);
      }
    }
    
    return documents;
  };
  
  // Serialize documents back to YAML
  const serializeYAMLDocuments = (documents: any[]): string => {
    return documents.map(doc => {
      if (typeof doc === 'string') return doc;
      try {
        return stringifyYAML(doc);
      } catch (e) {
        // Fallback to JSON if YAML stringification fails
        return JSON.stringify(doc, null, 2);
      }
    }).join("\n---\n");
  };
  
  // Normalize resource to remove fields that are expected to differ
  const normalizeResource = (resource: any): any => {
    // Skip normalization if resource is not an object or is a string
    if (typeof resource !== 'object' || resource === null || typeof resource === 'string') {
      return resource;
    }
    
    try {
      // Create a deep copy
      const normalized = JSON.parse(JSON.stringify(resource));
      
      // Remove metadata fields that are managed by Kubernetes
      if (normalized.metadata) {
        delete normalized.metadata.resourceVersion;
        delete normalized.metadata.uid;
        delete normalized.metadata.generation;
        delete normalized.metadata.creationTimestamp;
        delete normalized.metadata.managedFields;
        delete normalized.metadata.selfLink;
        delete normalized.metadata.finalizers; // Often managed by controllers
        
        // Remove annotations that are managed by Flux/Kubernetes
        if (normalized.metadata.annotations) {
          delete normalized.metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"];
          delete normalized.metadata.annotations["kustomize.toolkit.fluxcd.io/checksum"];
          delete normalized.metadata.annotations["kustomize.toolkit.fluxcd.io/reconcile"];
          delete normalized.metadata.annotations["deployment.kubernetes.io/revision"];
          delete normalized.metadata.annotations["control-plane.alpha.kubernetes.io/leader"];
          
          // Remove empty annotations map
          if (Object.keys(normalized.metadata.annotations).length === 0) {
            delete normalized.metadata.annotations;
          }
        }
        
        // Remove labels that are often managed by controllers
        if (normalized.metadata.labels) {
          delete normalized.metadata.labels["pod-template-hash"];
          delete normalized.metadata.labels["controller-revision-hash"];
          delete normalized.metadata.labels["kustomize.toolkit.fluxcd.io/name"];
          delete normalized.metadata.labels["kustomize.toolkit.fluxcd.io/namespace"];

          // Remove empty labels map
          if (Object.keys(normalized.metadata.labels).length === 0) {
            delete normalized.metadata.labels;
          }
        }
      }
      
      // Remove status field as it's managed by Kubernetes
      delete normalized.status;
      
      // Remove spec fields that are often managed by controllers
      if (normalized.spec) {
        // For Services, remove clusterIP and other auto-assigned fields
        if (normalized.kind === "Service") {
          delete normalized.spec.clusterIP;
          delete normalized.spec.clusterIPs;
        }
        
        // For PersistentVolumeClaims, remove volumeName if auto-provisioned
        if (normalized.kind === "PersistentVolumeClaim") {
          delete normalized.spec.volumeName;
        }
      }
      
      return normalized;
    } catch (error) {
      console.error("Error normalizing resource:", error);
      return resource; // Return original if normalization fails
    }
  };
    // Generate a full diff showing the entire document with changes
  const generateFullDiff = (oldLines: string[], newLines: string[]): string[] => {
    // First find the differences using LCS
    const diffs = findDifferences(oldLines, newLines);
    const result: string[] = [];
    
    // Generate the diff output
    diffs.forEach(diff => {
      if (diff.type === 'match') {
        result.push(` ${diff.value}`);
      } else if (diff.type === 'add') {
        result.push(`+${diff.value}`);
      } else if (diff.type === 'remove') {
        result.push(`-${diff.value}`);
      }
    });
    
    return result;
  };
  
  // Find differences between two arrays of lines
  interface DiffItem {
    type: 'match' | 'add' | 'remove';
    value: string;
  }
  
  const findDifferences = (oldLines: string[], newLines: string[]): DiffItem[] => {
    const result: DiffItem[] = [];
    const lcs = computeLCS(oldLines, newLines);
    
    let oldIndex = 0;
    let newIndex = 0;
    let lcsIndex = 0;
    
    while (oldIndex < oldLines.length || newIndex < newLines.length) {
      // Check if the current line from both arrays is in the LCS
      if (lcsIndex < lcs.length && 
          oldIndex < oldLines.length && 
          newIndex < newLines.length && 
          oldLines[oldIndex] === lcs[lcsIndex] && 
          newLines[newIndex] === lcs[lcsIndex]) {
        // Both lines match and are in the LCS
        result.push({ type: 'match', value: oldLines[oldIndex] });
        oldIndex++;
        newIndex++;
        lcsIndex++;
      } else if (oldIndex < oldLines.length && 
                (lcsIndex >= lcs.length || 
                 oldLines[oldIndex] !== lcs[lcsIndex])) {
        // Line from oldLines is not in LCS - it was removed
        result.push({ type: 'remove', value: oldLines[oldIndex] });
        oldIndex++;
      } else if (newIndex < newLines.length && 
                (lcsIndex >= lcs.length || 
                 newLines[newIndex] !== lcs[lcsIndex])) {
        // Line from newLines is not in LCS - it was added
        result.push({ type: 'add', value: newLines[newIndex] });
        newIndex++;
      }
    }
    
    return result;
  };
  
  // Compute Longest Common Subsequence
  const computeLCS = (a: string[], b: string[]): string[] => {
    const m = a.length;
    const n = b.length;
    
    // Create length table
    const lengths: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));
    
    // Fill the lengths table
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (a[i] === b[j]) {
          lengths[i + 1][j + 1] = lengths[i][j] + 1;
        } else {
          lengths[i + 1][j + 1] = Math.max(lengths[i + 1][j], lengths[i][j + 1]);
        }
      }
    }
    
    // Build the LCS
    const result: string[] = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (a[i - 1] === b[j - 1]) {
        result.unshift(a[i - 1]);
        i--;
        j--;
      } else if (lengths[i][j - 1] > lengths[i - 1][j]) {
        j--;
      } else {
        i--;
      }
    }
    
    return result;
  };

  return (
    <Show when={props.isOpen}>
      <div class="resource-drawer-backdrop" onClick={props.onClose}>
        <div class="resource-drawer" onClick={(e) => e.stopPropagation()}>
          <div class="resource-drawer-header">
            <div class="drawer-title">
              Diff: {props.resource?.metadata.name}
            </div>
            <button class="drawer-close" onClick={props.onClose}>×</button>
          </div>
          
          <div class="drawer-content" ref={contentRef} tabIndex={0} style={{ outline: "none" }}>
            <Show 
              when={!props.loading} 
              fallback={
                <div class="drawer-loading">
                  <div class="loading-spinner"></div>
                  <p>Generating diff...</p>
                </div>
              }
            >
              <Show 
                when={props.diffData} 
                fallback={
                  <div class="no-data">
                    <p>No diff data available</p>
                  </div>
                }
              >
                <div class="logs-controls">
                  <div class="logs-options-row">
                    <div class="logs-follow-controls">
                      <label title="Normalize Kubernetes resources to hide fields that are expected to differ">
                        <input
                          type="checkbox"
                          checked={normalizeResources()}
                          onChange={toggleNormalization}
                        />
                        Hide auto-generated fields
                      </label>
                    </div>
                  </div>
                </div>
                
                <div class="diff-content">
                  <For each={diffSections()}>
                    {(section, index) => (
                      <div class="diff-file-section">
                        <div 
                          class="diff-file-header" 
                          onClick={() => toggleSection(index())}
                        >
                          <div class="diff-file-info">
                            <div class="diff-file-toggle">
                              {section.isExpanded ? '▼' : '►'}
                            </div>
                            <span class="diff-file-name">{section.fileName}</span>
                            {section.status === 'created' ? (
                              <span class="diff-file-status status-created">Created</span>
                            ) : section.status === 'deleted' ? (
                              <span class="diff-file-status status-deleted">Deleted</span>
                            ) : section.addedLines === 0 && section.removedLines === 0 ? (
                              <span class="diff-file-status status-unchanged">Unchanged</span>
                            ) : (
                              <span class="diff-file-status status-modified">
                                <span class="removed-count">-{section.removedLines}</span>
                                <span class="added-count">+{section.addedLines}</span>
                              </span>
                            )}
                          </div>
                        </div>
                        
                        <Show when={section.isExpanded}>
                          <div class="diff-file-content">
                            <pre class="diff-patch">
                              <For each={section.diffLines}>
                                {(line) => {
                                  let className = '';
                                  if (line.startsWith('+')) {
                                    className = 'diff-line-added';
                                  } else if (line.startsWith('-')) {
                                    className = 'diff-line-removed';
                                  } else if (line.startsWith(' ')) {
                                    className = 'diff-line-info';
                                  }
                                  
                                  return <div class={className}>{line}</div>;
                                }}
                              </For>
                            </pre>
                          </div>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
} 