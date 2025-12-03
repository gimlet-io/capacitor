// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import { createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Show, For } from "solid-js";
import type { ConfigMap } from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";
import { checkPermissionSSAR, type MinimalK8sResource } from "../utils/permissions.ts";

export function ConfigMapDetails() {
  const params = useParams();
  const navigate = useNavigate();
  const apiResourceStore = useApiResourceStore();

  // State for the specific ConfigMap
  const [configMap, setConfigMap] = createSignal<ConfigMap | null>(null);
  const [_watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);

  // Deletion state
  const [deletingKeys, setDeletingKeys] = createSignal<Set<string>>(new Set());
  const [deletionUnlocked, setDeletionUnlocked] = createSignal(false);

  // New key/value form state
  const [newKeyName, setNewKeyName] = createSignal("");
  const [newKeyValue, setNewKeyValue] = createSignal("");
  const [savingNewKey, setSavingNewKey] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [addingRow, setAddingRow] = createSignal(false);
  const [canPatchConfigMap, setCanPatchConfigMap] = createSignal<boolean | undefined>(undefined);

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
      watchControllers().forEach((controller) => controller.abort());
    });

    const controller = new AbortController();

    // Watch for the ConfigMap
    watchResource(
      `/k8s/api/v1/namespaces/${ns}/configmaps?watch=true`,
      (event: { type: string; object: ConfigMap }) => {
        if (event.type === "ADDED" || event.type === "MODIFIED") {
          if (event.object.metadata.name === name) {
            setConfigMap(event.object);
            const res: MinimalK8sResource = {
              apiVersion: (event.object as any).apiVersion,
              kind: (event.object as any).kind,
              metadata: {
                name: event.object.metadata.name,
                namespace: event.object.metadata.namespace,
              },
            };
            (async () => {
              const ok = await checkPermissionSSAR(res, { verb: "patch" });
              setCanPatchConfigMap(ok);
            })();
          }
        } else if (event.type === "DELETED") {
          if (event.object.metadata.name === name) {
            // Navigate back if the ConfigMap is deleted
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

  const copyToClipboard = async (key: string, buttonElement: HTMLButtonElement) => {
    try {
      const current = configMap();
      const cmData = current?.data || {};
      const cmBinaryData = current?.binaryData || {};
      const displayValue = cmData[key] ?? cmBinaryData[key] ?? "";

      await navigator.clipboard.writeText(displayValue);

      const originalText = buttonElement.textContent;
      const originalDisabled = buttonElement.disabled;
      buttonElement.textContent = "Copied!";
      buttonElement.classList.add("copied");
      buttonElement.disabled = true;

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

  const addNewConfigMapKey = async () => {
    const current = configMap();
    if (!current) return;

    const key = newKeyName().trim();
    if (!key) {
      setSaveError("Key name is required");
      return;
    }

    // Prevent duplicate keys across data and binaryData
    const existingData = {
      ...(current.data || {}),
      ...(current.binaryData || {}),
    } as Record<string, string>;
    if (Object.prototype.hasOwnProperty.call(existingData, key)) {
      setSaveError("Key already exists");
      return;
    }

    setSavingNewKey(true);
    setSaveError(null);
    try {
      const ctxName = apiResourceStore.contextInfo?.current
        ? encodeURIComponent(apiResourceStore.contextInfo.current)
        : "";
      const k8sPrefix = ctxName ? `/k8s/${ctxName}` : "/k8s";
      const url = `${k8sPrefix}/api/v1/namespaces/${current.metadata.namespace}/configmaps/${current.metadata.name}`;
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/merge-patch+json",
        },
        body: JSON.stringify({
          data: { [key]: newKeyValue() },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Failed to add key (HTTP ${response.status})`);
      }

      const value = newKeyValue();
      setNewKeyName("");
      setNewKeyValue("");
      setAddingRow(false);

      // Optimistically update local state
      setConfigMap((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          data: { ...(prev.data || {}), [key]: value },
        };
      });

      // Refresh from cluster to ensure consistency
      try {
        const refreshResp = await fetch(url);
        if (refreshResp.ok) {
          const fresh = await refreshResp.json();
          setConfigMap(fresh);
        }
      } catch {
        // Ignore refresh errors; the watch should eventually update the UI
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingNewKey(false);
    }
  };

  const deleteConfigMapKey = async (key: string) => {
    const current = configMap();
    if (!current) return;

    const confirmed =
      globalThis.confirm?.(`Are you sure you want to delete key "${key}"?`) ?? false;
    if (!confirmed) return;

    setDeletingKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    try {
      const ctxName = apiResourceStore.contextInfo?.current
        ? encodeURIComponent(apiResourceStore.contextInfo.current)
        : "";
      const k8sPrefix = ctxName ? `/k8s/${ctxName}` : "/k8s";
      const url = `${k8sPrefix}/api/v1/namespaces/${current.metadata.namespace}/configmaps/${current.metadata.name}`;
      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/merge-patch+json",
        },
        body: JSON.stringify({
          data: { [key]: null },
          binaryData: { [key]: null },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Failed to delete key (HTTP ${response.status})`);
      }

      // Optimistically update local state
      setConfigMap((prev) => {
        if (!prev) return prev;
        const nextData = { ...(prev.data || {}) } as Record<string, string>;
        const nextBinaryData = { ...(prev.binaryData || {}) } as Record<string, string>;
        delete nextData[key];
        delete nextBinaryData[key];
        return { ...prev, data: nextData, binaryData: nextBinaryData } as ConfigMap;
      });

      // Refresh from cluster
      try {
        const refreshResp = await fetch(url);
        if (refreshResp.ok) {
          const fresh = await refreshResp.json();
          setConfigMap(fresh);
        }
      } catch {
        // Ignore refresh errors; watch should reconcile
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDeletingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  return (
    <div class="secret-details">
      <Show when={configMap()} fallback={<div class="loading">Loading...</div>}>
        {(cm) => {
          const cmData = createMemo(() => cm().data || {});
          const cmBinaryData = createMemo(() => cm().binaryData || {});
          const allData = createMemo<Record<string, string>>(() => ({
            ...cmData(),
            ...cmBinaryData(),
          }));

          return (
            <>
              <header class="secret-header">
                <div class="header-top">
                  <div class="header-left">
                    <button
                      type="button"
                      class="back-button"
                      onClick={handleBackClick}
                    >
                      <span class="icon">←</span> Back
                    </button>
                    <h1>
                      {cm().metadata.namespace}/{cm().metadata.name}
                    </h1>
                    <div class="secret-type">
                      <span class="status-badge">ConfigMap</span>
                    </div>
                  </div>
                </div>

                <div class="header-info">
                  <div class="info-grid">
                    <div class="info-item">
                      <span class="label">Kind:</span>
                      <span class="value">ConfigMap</span>
                    </div>
                    <div class="info-item">
                      <span class="label">Data keys:</span>
                      <span class="value">{Object.keys(allData()).length}</span>
                    </div>
                    <div class="info-item">
                      <span class="label">Age:</span>
                      <span class="value">
                        {useCalculateAge(cm().metadata.creationTimestamp || "")()}
                      </span>
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
                          <div
                            style="display:flex; align-items:center; justify-content:space-between; gap: 12px;"
                          >
                            <span>Value</span>
                            <div
                              style="display:flex; align-items:center; gap: 8px;"
                            >
                              <button
                                type="button"
                                class="action-button"
                                onClick={() =>
                                  setDeletionUnlocked((v) => !v)
                                }
                              >
                                {deletionUnlocked()
                                  ? "Lock deletion"
                                  : "Unlock deletion"}
                              </button>
                              <button
                                type="button"
                                class="action-button"
                                disabled={
                                  addingRow() ||
                                  savingNewKey() ||
                                  canPatchConfigMap() === false
                                }
                                onClick={() => {
                                  if (canPatchConfigMap() === false) return;
                                  setAddingRow(true);
                                  setSaveError(null);
                                }}
                                title={
                                  canPatchConfigMap() === false
                                    ? "Not permitted"
                                    : undefined
                                }
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
                              onInput={(e) =>
                                setNewKeyName(
                                  (e.currentTarget as HTMLInputElement).value
                                )
                              }
                              autofocus
                            />
                            <div class="key-type">(string)</div>
                          </td>
                          <td class="value-cell">
                            <div
                              class="value-content"
                              style="display:flex; flex-direction:column; gap:8px;"
                            >
                              <textarea
                                id="new-key-value-inline"
                                class="form-textarea secret-value"
                                rows={4}
                                placeholder="Value"
                                value={newKeyValue()}
                                onInput={(e) =>
                                  setNewKeyValue(
                                    (e.currentTarget as HTMLTextAreaElement)
                                      .value
                                  )
                                }
                                style="width: 100%; box-sizing: border-box; background-color: white;"
                              />
                              <div class="value-actions">
                                <button
                                  type="button"
                                  class="action-button"
                                  disabled={
                                    savingNewKey() || !newKeyName().trim()
                                  }
                                  onClick={addNewConfigMapKey}
                                >
                                  {savingNewKey() ? "Saving..." : "Save"}
                                </button>
                                <button
                                  type="button"
                                  class="action-button"
                                  onClick={() => {
                                    setAddingRow(false);
                                    setNewKeyName("");
                                    setNewKeyValue("");
                                    setSaveError(null);
                                  }}
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
                      <Show
                        when={
                          Object.keys(allData()).length > 0 || addingRow()
                        }
                        fallback={
                          <tr>
                            <td colSpan={2} class="no-data">
                              No data found in this ConfigMap
                            </td>
                          </tr>
                        }
                      >
                        <For each={Object.entries(allData())}>
                          {([key, value]) => {
                            const source =
                              key in cmBinaryData() ? "binaryData" : "data";

                            return (
                              <tr>
                                <td class="key-cell">
                                  <div class="key-name">{key}</div>
                                  <div class="key-type">
                                    {source === "binaryData"
                                      ? "(binary/base64)"
                                      : "(string)"}
                                  </div>
                                </td>
                                <td class="value-cell">
                                  <div class="value-content">
                                    <pre class="secret-value">
                                      {value}
                                    </pre>
                                    <div class="value-actions">
                                      <Show when={deletionUnlocked()}>
                                        <button
                                          type="button"
                                          class="action-button"
                                          disabled={
                                            deletingKeys().has(key) ||
                                            canPatchConfigMap() === false
                                          }
                                          onClick={() => {
                                            if (canPatchConfigMap() === false)
                                              return;
                                            deleteConfigMapKey(key);
                                          }}
                                          title={
                                            canPatchConfigMap() === false
                                              ? "Not permitted"
                                              : undefined
                                          }
                                        >
                                          {deletingKeys().has(key)
                                            ? "Deleting..."
                                            : "Delete"}
                                        </button>
                                      </Show>
                                      <button
                                        type="button"
                                        class="action-button copy-button"
                                        onClick={(e) =>
                                          copyToClipboard(
                                            key,
                                            e.currentTarget as HTMLButtonElement
                                          )
                                        }
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


