(() => {
  // src/app.ts
  async function fetchResource(path) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  }
  function renderPods(pods) {
    return pods.map((pod) => `
        <div class="resource-item pod-item">
            <h3>${pod.metadata.namespace}/${pod.metadata.name}</h3>
            <p class="status-${pod.status.phase}">Status: ${pod.status.phase}</p>
            <p>Node: ${pod.spec.nodeName || "Not assigned"}</p>
            <p>Pod IP: ${pod.status.podIP || "No IP"}</p>
            <details>
                <summary>Containers (${pod.spec.containers.length})</summary>
                ${pod.spec.containers.map((container) => `
                    <div>
                        <strong>${container.name}</strong>: ${container.image}
                    </div>
                `).join("")}
            </details>
        </div>
    `).join("");
  }
  function renderDeployments(deployments) {
    return deployments.map((deployment) => `
        <div class="resource-item deployment-item">
            <h3>${deployment.metadata.namespace}/${deployment.metadata.name}</h3>
            <p>Replicas: ${deployment.status.readyReplicas || 0}/${deployment.spec.replicas || 0}</p>
            <details>
                <summary>Labels</summary>
                <pre>${JSON.stringify(deployment.spec.selector.matchLabels, null, 2)}</pre>
            </details>
        </div>
    `).join("");
  }
  function renderServices(services) {
    return services.map((service) => `
        <div class="resource-item service-item">
            <h3>${service.metadata.namespace}/${service.metadata.name}</h3>
            <p>Type: ${service.spec.type || "ClusterIP"}</p>
            <p>Cluster IP: ${service.spec.clusterIP || "None"}</p>
            <details>
                <summary>Ports</summary>
                ${service.spec.ports?.map((port) => `
                    <div>
                        ${port.name ? `<strong>${port.name}</strong>: ` : ""}
                        ${port.port}${port.targetPort ? ` \u2192 ${port.targetPort}` : ""}
                        ${port.nodePort ? ` (NodePort: ${port.nodePort})` : ""}
                    </div>
                `).join("") || "No ports defined"}
            </details>
        </div>
    `).join("");
  }
  async function fetchAll() {
    try {
      const [pods, deployments, services] = await Promise.all([
        fetchResource("/api/api/v1/pods"),
        fetchResource("/api/apis/apps/v1/deployments"),
        fetchResource("/api/api/v1/services")
      ]);
      const content = `
            <div class="resources-grid">
                <section class="resource-section">
                    <h2>Pods</h2>
                    <div class="resource-list">${renderPods(pods.items)}</div>
                </section>
                <section class="resource-section">
                    <h2>Deployments</h2>
                    <div class="resource-list">${renderDeployments(deployments.items)}</div>
                </section>
                <section class="resource-section">
                    <h2>Services</h2>
                    <div class="resource-list">${renderServices(services.items)}</div>
                </section>
            </div>
        `;
      const mainElement = document.getElementById("resources");
      if (mainElement) {
        mainElement.innerHTML = content;
      }
    } catch (error) {
      console.error("Error fetching resources:", error);
      const mainElement = document.getElementById("resources");
      if (mainElement) {
        mainElement.innerHTML = `<div class="error">Error fetching resources: ${error instanceof Error ? error.message : String(error)}</div>`;
      }
    }
  }
  fetchAll();
  window.fetchAll = fetchAll;
})();
