// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

// deno-lint-ignore-file jsx-button-has-type
import {
  createEffect,
  createSignal,
  onCleanup,
  Show,
  For,
  type JSX,
} from "solid-js";
import type { Kustomization } from "../../types/k8s.ts";
import { parse as parseYAML, stringify as stringifyYAML } from "@std/yaml";
import {
  type DiffItem,
  type DiffHunk,
  type FileDiffSection,
  generateDiffHunks,
} from "../../utils/diffUtils.ts";

// Interface for the new API response structure
interface FluxDiffResult {
  fileName: string;
  clusterYaml: string;
  appliedYaml: string;
  created: boolean;
  hasChanges: boolean;
  deleted: boolean;
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
        
        const hunks = generateDiffHunks(fromLines, toLines);
        
        // Calculate stats
        const addedLines = hunks.reduce((sum, hunk) => 
          sum + hunk.changes.filter(change => change.type === 'add').length, 0);
        const removedLines = hunks.reduce((sum, hunk) => 
          sum + hunk.changes.filter(change => change.type === 'remove').length, 0);
        
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
          hunks,
          isExpanded,
          addedLines,
          removedLines,
          originalLines: fromLines,
          newLines: toLines
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

  // Expand context for a specific hunk with merge detection
  const expandContext = (sectionIndex: number, hunkIndex: number, direction: 'before' | 'after') => {
    setDiffSections(prev => {
      const updated = [...prev];
      const section = {...updated[sectionIndex]};
      const hunks = [...section.hunks];
      
      if (direction === 'before' && hunks[hunkIndex].canExpandBefore) {
        const hunk = {...hunks[hunkIndex]};
        const newStart = Math.max(0, hunk.visibleStartOld - 10);
        const newStartNew = Math.max(0, hunk.visibleStartNew - 10);
        
        // Check if expansion would overlap with previous hunk
        if (hunkIndex > 0) {
          const prevHunk = hunks[hunkIndex - 1];
          if (newStart <= prevHunk.visibleEndOld) {
            // Merge with previous hunk
            const mergedHunk = {
              startOldLine: prevHunk.startOldLine,
              startNewLine: prevHunk.startNewLine,
              changes: [...prevHunk.changes],
              visibleStartOld: prevHunk.visibleStartOld,
              visibleStartNew: prevHunk.visibleStartNew,
              visibleEndOld: hunk.visibleEndOld,
              visibleEndNew: hunk.visibleEndNew,
              canExpandBefore: prevHunk.canExpandBefore,
              canExpandAfter: hunk.canExpandAfter
            };
            
            // Add gap lines between previous hunk and current hunk
            for (let i = prevHunk.visibleEndOld; i < hunk.visibleStartOld; i++) {
              if (i >= 0 && i < section.originalLines.length) {
                const newLineNum = prevHunk.visibleEndNew + (i - prevHunk.visibleEndOld);
                mergedHunk.changes.push({
                  type: 'match',
                  value: section.originalLines[i],
                  oldLineNumber: i + 1,
                  newLineNumber: newLineNum + 1
                });
              }
            }
            
            // Add current hunk's changes
            mergedHunk.changes.push(...hunk.changes);
            
            // Remove both hunks and add merged one
            hunks.splice(hunkIndex - 1, 2, mergedHunk);
          } else {
            // Normal expansion
            hunk.visibleStartOld = newStart;
            hunk.visibleStartNew = newStartNew;
            hunk.canExpandBefore = newStart > 0;
            hunks[hunkIndex] = hunk;
          }
        } else {
          // Normal expansion for first hunk
          hunk.visibleStartOld = newStart;
          hunk.visibleStartNew = newStartNew;
          hunk.canExpandBefore = newStart > 0;
          hunks[hunkIndex] = hunk;
        }
      } else if (direction === 'after' && hunks[hunkIndex].canExpandAfter) {
        const hunk = {...hunks[hunkIndex]};
        const newEnd = Math.min(section.originalLines.length, hunk.visibleEndOld + 10);
        const newEndNew = Math.min(section.newLines.length, hunk.visibleEndNew + 10);
        
        // Check if expansion would overlap with next hunk
        if (hunkIndex < hunks.length - 1) {
          const nextHunk = hunks[hunkIndex + 1];
          if (newEnd >= nextHunk.visibleStartOld) {
            // Merge with next hunk
            const mergedHunk = {
              startOldLine: hunk.startOldLine,
              startNewLine: hunk.startNewLine,
              changes: [...hunk.changes],
              visibleStartOld: hunk.visibleStartOld,
              visibleStartNew: hunk.visibleStartNew,
              visibleEndOld: nextHunk.visibleEndOld,
              visibleEndNew: nextHunk.visibleEndNew,
              canExpandBefore: hunk.canExpandBefore,
              canExpandAfter: nextHunk.canExpandAfter
            };
            
            // Add gap lines between current hunk and next hunk
            for (let i = hunk.visibleEndOld; i < nextHunk.visibleStartOld; i++) {
              if (i >= 0 && i < section.originalLines.length) {
                const newLineNum = hunk.visibleEndNew + (i - hunk.visibleEndOld);
                mergedHunk.changes.push({
                  type: 'match',
                  value: section.originalLines[i],
                  oldLineNumber: i + 1,
                  newLineNumber: newLineNum + 1
                });
              }
            }
            
            // Add next hunk's changes
            mergedHunk.changes.push(...nextHunk.changes);
            
            // Remove both hunks and add merged one
            hunks.splice(hunkIndex, 2, mergedHunk);
          } else {
            // Normal expansion
            hunk.visibleEndOld = newEnd;
            hunk.visibleEndNew = newEndNew;
            hunk.canExpandAfter = newEnd < section.originalLines.length;
            hunks[hunkIndex] = hunk;
          }
        } else {
          // Normal expansion for last hunk
          hunk.visibleEndOld = newEnd;
          hunk.visibleEndNew = newEndNew;
          hunk.canExpandAfter = newEnd < section.originalLines.length;
          hunks[hunkIndex] = hunk;
        }
      }
      
      section.hunks = hunks;
      updated[sectionIndex] = section;
      return updated;
    });
  };
  
  // Toggle normalization
  const toggleNormalization = () => {
    setNormalizeResources(!normalizeResources());
  };

  // Render a hunk with context
  const renderHunk = (hunk: DiffHunk, sectionIndex: number, hunkIndex: number, section: FileDiffSection) => {
    const lines: JSX.Element[] = [];
    
    // Add expand before button if we can expand more
    if (hunk.canExpandBefore) {
      lines.push(
        <div class="diff-expand-line">
          <button 
            class="diff-expand-button"
            onClick={() => expandContext(sectionIndex, hunkIndex, 'before')}
          >
            ⋯ 10 more lines
          </button>
        </div>
      );
    }
    
    // Add extra context lines before the hunk if expanded
    for (let i = hunk.visibleStartOld; i < hunk.startOldLine; i++) {
      if (i >= 0 && i < section.originalLines.length) {
        const newLineNum = hunk.visibleStartNew + (i - hunk.visibleStartOld);
        lines.push(
          <div class="diff-line-context">
            <span class="line-number old">{i + 1}</span>
            <span class="line-number new">{newLineNum + 1}</span>
            <span class="line-content"> {section.originalLines[i]}</span>
          </div>
        );
      }
    }
    
    // Add the original hunk changes
    let oldLineNum = hunk.startOldLine + 1;
    let newLineNum = hunk.startNewLine + 1;
    
    hunk.changes.forEach((change) => {
      let className = '';
      let lineContent = '';
      let oldNum = '';
      let newNum = '';
      
      if (change.type === 'add') {
        className = 'diff-line-added';
        lineContent = `+${change.value}`;
        newNum = String(newLineNum++);
      } else if (change.type === 'remove') {
        className = 'diff-line-removed';
        lineContent = `-${change.value}`;
        oldNum = String(oldLineNum++);
      } else {
        className = 'diff-line-context';
        lineContent = ` ${change.value}`;
        oldNum = String(oldLineNum++);
        newNum = String(newLineNum++);
      }
      
      lines.push(
        <div class={className}>
          <span class="line-number old">{oldNum}</span>
          <span class="line-number new">{newNum}</span>
          <span class="line-content">{lineContent}</span>
        </div>
      );
    });
    
    // Add extra context lines after the hunk if expanded
    const originalHunkEnd = hunk.startOldLine + hunk.changes.filter(c => c.type !== 'add').length;
    const originalHunkEndNew = hunk.startNewLine + hunk.changes.filter(c => c.type !== 'remove').length;
    
    for (let i = originalHunkEnd; i < hunk.visibleEndOld; i++) {
      if (i >= 0 && i < section.originalLines.length) {
        const newLineNum = originalHunkEndNew + (i - originalHunkEnd);
        lines.push(
          <div class="diff-line-context">
            <span class="line-number old">{i + 1}</span>
            <span class="line-number new">{newLineNum + 1}</span>
            <span class="line-content"> {section.originalLines[i]}</span>
          </div>
        );
      }
    }
    
    // Add expand after button if we can expand more
    if (hunk.canExpandAfter) {
      lines.push(
        <div class="diff-expand-line">
          <button 
            class="diff-expand-button"
            onClick={() => expandContext(sectionIndex, hunkIndex, 'after')}
          >
            ⋯ 10 more lines
          </button>
        </div>
      );
    }
    
    return lines;
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
                    {(section, sectionIndex) => (
                      <div class="diff-file-section">
                        <div 
                          class="diff-file-header" 
                          onClick={() => toggleSection(sectionIndex())}
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
                            <div class="diff-hunks">
                              <For each={section.hunks}>
                                {(hunk, hunkIndex) => (
                                  <div class="diff-hunk">
                                    {renderHunk(hunk, sectionIndex(), hunkIndex(), section)}
                                  </div>
                                )}
                              </For>
                            </div>
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