import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { Show, For } from "solid-js";
import type { Secret } from "../types/k8s.ts";
import { watchResource } from "../watches.tsx";
import { useCalculateAge } from "../components/resourceList/timeUtils.ts";

export function SecretDetails() {
  const params = useParams();
  const navigate = useNavigate();
  
  // Initialize state for the specific secret
  const [secret, setSecret] = createSignal<Secret | null>(null);
  const [_watchStatus, setWatchStatus] = createSignal("●");
  const [watchControllers, setWatchControllers] = createSignal<AbortController[]>([]);
  
  // State for decrypted values
  const [decryptedData, setDecryptedData] = createSignal<Record<string, string>>({});

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
          }
        } else if (event.type === "DELETED") {
          if (event.object.metadata.name === name) {
            // Navigate back if the secret is deleted
            navigate("/");
          }
        }
      },
      controller,
      setWatchStatus
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

  return (
    <div class="secret-details">
      <Show when={secret()} fallback={<div class="loading">Loading...</div>}>
        {(s) => {
          const secretData = s().data || {};
          const secretStringData = s().stringData || {};
          const allData = { ...secretData, ...secretStringData };
          
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
                        <th style="width: 70%;">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      <Show when={Object.keys(allData).length > 0} fallback={
                        <tr>
                          <td colspan="2" class="no-data">No data found in this secret</td>
                        </tr>
                      }>
                        <For each={Object.entries(allData)}>
                          {([key, value]) => {
                            const isFromStringData = key in secretStringData;
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