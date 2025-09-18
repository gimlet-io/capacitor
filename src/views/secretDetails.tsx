import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Show, For } from "solid-js";
import type { Secret } from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { checkPermissionSSAR, type MinimalK8sResource } from "../utils/permissions.ts";

export function SecretDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const apiResourceStore = useApiResourceStore();
  
  // Initialize state for the specific secret
  const [secret, setSecret] = createSignal<Secret | null>(null);
  const [_watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);
  
  // State for decrypted values
  const [decryptedData, setDecryptedData] = createSignal<Record<string, string>>({});
  // Track per-key deletion state
  const [deletingKeys, setDeletingKeys] = createSignal<Set<string>>(new Set());
  // Toggle to show/hide delete buttons
  const [deletionUnlocked, setDeletionUnlocked] = createSignal(false);

  // New key add form state
  const [newKeyName, setNewKeyName] = createSignal("");
  const [newKeyValue, setNewKeyValue] = createSignal("");
  const [savingNewKey, setSavingNewKey] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [addingRow, setAddingRow] = createSignal(false);
  const [canPatchSecret, setCanPatchSecret] = createSignal<boolean | undefined>(undefined);

  // Set up watches when component mounts or params change
  createEffect(() => {
    if (params.namespace && params.name) {
      setupWatches(params.namespace, params.name);
    }
  });

  onCleanup(() => {
    untrack(() => {
      watchControllers().forEach((controller) => controller.abort());
    });
  });

  const setupWatches = (ns: string, name: string) => {
    // Cancel existing watches
    untrack(() => {
      watchControllers().forEach(controller => controller.abort());
    });

    const controller = new AbortController();
    
    // Watch for the secret
    watchResource(
      `/k8s/api/v1/namespaces/${ns}/secrets?watch=true`,
      (event: { type: string; object: Secret }) => {
        if (event.type === "ADDED" || event.type === "MODIFIED") {
          if (event.object.metadata.name === name) {
            setSecret(event.object);
            const res: MinimalK8sResource = { apiVersion: (event.object as any).apiVersion, kind: (event.object as any).kind, metadata: { name: event.object.metadata.name, namespace: event.object.metadata.namespace } };
            (async () => {
              const ok = await checkPermissionSSAR(res, { verb: 'patch' });
              setCanPatchSecret(ok);
            })();
          }
        } else if (event.type === "DELETED") {
          if (event.object.metadata.name === name) {
            // Navigate back if the secret is deleted
            navigate("/");
          }
        }
      },
      controller,
      setWatchStatus,
      undefined,
      apiResourceStore.contextInfo?.current
    );

    setWatchControllers([controller]);
  };

  const handleBackClick = () => {
    navigate("/");
  };

  const decryptValue = (key: string, value: string) => {
    try {
      const decoded = atob(value);
      setDecryptedData(prev => ({ ...prev, [key]: decoded }));
    } catch (error) {
      console.error("Failed to decode base64 value:", error);
      setDecryptedData(prev => ({ ...prev, [key]: "Invalid base64 data" }));
    }
  };

  const copyToClipboard = async (key: string, buttonElement: HTMLButtonElement) => {
    try {
      // Get the current display value reactively
      const currentDecrypted = decryptedData();
      let displayValue: string;
      
      if (key in currentDecrypted) {
        displayValue = currentDecrypted[key];
      } else {
        const currentSecret = secret();
        const secretData = currentSecret?.data || {};
        const secretStringData = currentSecret?.stringData || {};
        displayValue = secretData[key] || secretStringData[key] || "";
      }
      
      await navigator.clipboard.writeText(displayValue);

      // Imperative per-button feedback without reactive state
      const originalText = buttonElement.textContent;
      const originalDisabled = buttonElement.disabled;
      buttonElement.textContent = "Copied!";
      buttonElement.classList.add("copied");
      buttonElement.disabled = true;

      // Clear any previous timer stored on the element
      const existingTimerId = (buttonElement as unknown as { __copyTimerId?: number }).__copyTimerId;
      if (existingTimerId) {
        clearTimeout(existingTimerId);
      }

      const timerId = setTimeout(() => {
        buttonElement.textContent = originalText || "Copy";
        buttonElement.classList.remove("copied");
        buttonElement.disabled = originalDisabled;
      }, 2000);
      (buttonElement as unknown as { __copyTimerId?: number }).__copyTimerId = timerId;
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const isDecrypted = (key: string): boolean => {
    return key in decryptedData();
  };

  const toggleDecryption = (key: string, value: string) => {
    if (isDecrypted(key)) {
      setDecryptedData(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      decryptValue(key, value);
    }
  };

  const addNewSecretKey = async () => {
    const currentSecret = secret();
    if (!currentSecret) return;

    const key = newKeyName().trim();
    if (!key) {
      setSaveError("Key name is required");
      return;
    }

    // Prevent duplicate keys
    const existingData = { ...(currentSecret.data || {}), ...(currentSecret.stringData || {}) } as Record<string, string>;
    if (Object.prototype.hasOwnProperty.call(existingData, key)) {
      setSaveError("Key already exists");
      return;
    }

    setSavingNewKey(true);
    setSaveError(null);
    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const k8sPrefix = ctxName ? `/k8s/${ctxName}` : '/k8s';
      const url = `${k8sPrefix}/api/v1/namespaces/${currentSecret.metadata.namespace}/secrets/${currentSecret.metadata.name}`;
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/merge-patch+json",
        },
        body: JSON.stringify({
          stringData: { [key]: newKeyValue() },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Failed to add key (HTTP ${response.status})`);
      }

      // Clear inputs and set UI state
      const value = newKeyValue();
      setNewKeyName("");
      setNewKeyValue("");
      setAddingRow(false);
      // Optimistically update using a new object to ensure Solid reactivity
      setSecret(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          stringData: { ...(prev.stringData || {}), [key]: value },
          // Also reflect in data for immediate display, encoding as base64
          data: { ...(prev.data || {}), [key]: btoa(value) }
        };
      });

      // Explicitly refresh the secret from the cluster to ensure UI reflects the latest state immediately
      try {
        const refreshResp = await fetch(url);
        if (refreshResp.ok) {
          const fresh = await refreshResp.json();
          setSecret(fresh);
        }
      } catch (_) {
        // Ignore refresh errors; the watch should eventually update the UI
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingNewKey(false);
    }
  };

  const deleteSecretKey = async (key: string) => {
    const currentSecret = secret();
    if (!currentSecret) return;

    // Browser confirmation modal
    const confirmed = globalThis.confirm?.(`Are you sure you want to delete key "${key}"?`)
      ?? false;
    if (!confirmed) return;

    // Mark this key as deleting
    setDeletingKeys(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    try {
      const ctxName = apiResourceStore.contextInfo?.current ? encodeURIComponent(apiResourceStore.contextInfo.current) : '';
      const k8sPrefix = ctxName ? `/k8s/${ctxName}` : '/k8s';
      const url = `${k8sPrefix}/api/v1/namespaces/${currentSecret.metadata.namespace}/secrets/${currentSecret.metadata.name}`;
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/merge-patch+json",
        },
        // Use JSON Merge Patch semantics: setting a map key to null deletes it
        body: JSON.stringify({
          data: { [key]: null },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Failed to delete key (HTTP ${response.status})`);
      }

      // Optimistically update local secret state
      setSecret(prev => {
        if (!prev) return prev;
        const nextData = { ...(prev.data || {}) } as Record<string, string>;
        const nextStringData = { ...(prev.stringData || {}) } as Record<string, string>;
        delete nextData[key];
        delete nextStringData[key];
        return { ...prev, data: nextData, stringData: nextStringData } as Secret;
      });

      // Remove decrypted cache if present
      setDecryptedData(prev => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });

      // Try to refresh from cluster
      try {
        const refreshResp = await fetch(url);
        if (refreshResp.ok) {
          const fresh = await refreshResp.json();
          setSecret(fresh);
        }
      } catch (_) {
        // Ignore refresh errors; watch should reconcile
      }
    } catch (e) {
      console.error(e);
    } finally {
      // Clear deleting state
      setDeletingKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <div class="secret-details">
      <Show when={secret()} fallback={<div class="loading">Loading...</div>}>
        {(s) => {
          const secretData = createMemo(() => s().data || {});
          const secretStringData = createMemo(() => s().stringData || {});
          const allData = createMemo<Record<string, string>>(() => ({ ...secretData(), ...secretStringData() }));
          
          return (
            <>
              <header class="secret-header">
                <div class="header-top">
                  <div class="header-left">
                    <button type="button" class="back-button" onClick={handleBackClick}>
                      <span class="icon">←</span> Back
                    </button>
                    <h1>{s().metadata.namespace}/{s().metadata.name}</h1>
                    <div class="secret-type">
                      <span class="status-badge">{s().type || "Opaque"}</span>
                    </div>
                  </div>
                </div>

                <div class="header-info">
                  <div class="info-grid">
                    <div class="info-item">
                      <span class="label">Type:</span>
                      <span class="value">{s().type || "Opaque"}</span>
                    </div>
                    <div class="info-item">
                      <span class="label">Data keys:</span>
                      <span class="value">{Object.keys(allData).length}</span>
                    </div>
                    <div class="info-item">
                      <span class="label">Age:</span>
                      <span class="value">{useCalculateAge(s().metadata.creationTimestamp || "")()}</span>
                    </div>
                  </div>
                </div>
              </header>

              <div class="secret-data-wrapper">
                <div class="secret-data-table-container">
                  <table class="secret-data-table">
                    <thead>
                      <tr>
                        <th style="width: 30%;">Key</th>
                        <th style="width: 70%;">
                          <div style="display:flex; align-items:center; justify-content:space-between; gap: 12px;">
                            <span>Value</span>
                            <div style="display:flex; align-items:center; gap: 8px;">
                              <button
                                type="button"
                                class="action-button"
                                onClick={() => setDeletionUnlocked(v => !v)}
                              >
                                {deletionUnlocked() ? "Lock deletion" : "Unlock deletion"}
                              </button>
                              <button
                                type="button"
                                class="action-button"
                                disabled={addingRow() || savingNewKey() || canPatchSecret() === false}
                                onClick={() => { if (canPatchSecret() === false) return; setAddingRow(true); setSaveError(null); }}
                                title={canPatchSecret() === false ? "Not permitted" : undefined}
                              >
                                Add key
                              </button>
                            </div>
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <Show when={addingRow()}>
                        <tr class="new-key-row">
                          <td class="key-cell">
                            <input
                              id="new-key-name-inline"
                              class="form-input"
                              type="text"
                              placeholder="Key name"
                              value={newKeyName()}
                              onInput={(e) => setNewKeyName((e.currentTarget as HTMLInputElement).value)}
                              autofocus
                            />
                            <div class="key-type">(string)</div>
                          </td>
                          <td class="value-cell">
                            <div class="value-content" style="display:flex; flex-direction:column; gap:8px;">
                              <textarea
                                id="new-key-value-inline"
                                class="form-textarea secret-value"
                                rows={4}
                                placeholder="Value"
                                value={newKeyValue()}
                                onInput={(e) => setNewKeyValue((e.currentTarget as HTMLTextAreaElement).value)}
                                style="width: 100%; box-sizing: border-box; background-color: white;"
                              />
                              <div class="value-actions">
                                <button
                                  type="button"
                                  class="action-button"
                                  disabled={savingNewKey() || !newKeyName().trim()}
                                  onClick={addNewSecretKey}
                                >
                                  {savingNewKey() ? "Saving..." : "Save"}
                                </button>
                                <button
                                  type="button"
                                  class="action-button"
                                  onClick={() => { setAddingRow(false); setNewKeyName(""); setNewKeyValue(""); setSaveError(null); }}
                                >
                                  Cancel
                                </button>
                              </div>
                              <Show when={saveError()}>
                                {(err) => (
                                  <div class="form-error">{err()}</div>
                                )}
                              </Show>
                            </div>
                          </td>
                        </tr>
                      </Show>
                      <Show when={Object.keys(allData()).length > 0 || addingRow()} fallback={
                        <tr>
                          <td colspan="2" class="no-data">No data found in this secret</td>
                        </tr>
                      }>
                        <For each={Object.entries(allData())}>
                          {([key, value]) => {
                            const isFromStringData = key in secretStringData();
                            const isBase64Encoded = !isFromStringData;
                            
                            return (
                              <tr>
                                <td class="key-cell">
                                  <div class="key-name">{key}</div>
                                  <div class="key-type">
                                    {isBase64Encoded ? (isDecrypted(key) ? "(string)" : "(base64)") : "(string)"}
                                  </div>
                                </td>
                                <td class="value-cell">
                                  <div class="value-content">
                                    <pre class="secret-value">
                                      {isDecrypted(key) ? decryptedData()[key] : value}
                                    </pre>
                                    <div class="value-actions">
                                      <Show when={isBase64Encoded}>
                                        <button
                                          type="button"
                                          class="action-button"
                                          onClick={() => toggleDecryption(key, value)}
                                        >
                                          {isDecrypted(key) ? "Encrypt" : "Decrypt"}
                                        </button>
                                      </Show>
                                      <Show when={deletionUnlocked()}>
                                        <button
                                          type="button"
                                          class="action-button"
                                          disabled={deletingKeys().has(key) || canPatchSecret() === false}
                                          onClick={() => { if (canPatchSecret() === false) return; deleteSecretKey(key); }}
                                          title={canPatchSecret() === false ? "Not permitted" : undefined}
                                        >
                                          {deletingKeys().has(key) ? "Deleting..." : "Delete"}
                                        </button>
                                      </Show>
                                      <button
                                        type="button"
                                        class="action-button copy-button"
                                        onClick={(e) => copyToClipboard(key, e.currentTarget as HTMLButtonElement)}
                                      >
                                        Copy
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            );
                          }}
                        </For>
                      </Show>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          );
        }}
      </Show>
    </div>
  );
} 