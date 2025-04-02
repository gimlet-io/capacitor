(() => {
  // src/app.ts
  var currentNamespace = "test";
  async function fetchResource(path) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  }
  async function fetchNamespaces() {
    try {
      const response = await fetchResource("/k8s/api/v1/namespaces");
      const select = document.getElementById("namespaceSelect");
      if (select) {
        select.innerHTML = response.items.map((ns) => `
                    <option value="${ns.metadata.name}" 
                            ${ns.metadata.name === currentNamespace ? "selected" : ""}>
                        ${ns.metadata.name}
                    </option>
                `).join("");
      }
    } catch (error) {
      console.error("Error fetching namespaces:", error);
    }
  }
  function changeNamespace() {
    const select = document.getElementById("namespaceSelect");
    if (select) {
      currentNamespace = select.value;
      setupWatches();
    }
  }
  function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (sidebar) {
      sidebar.classList.toggle("collapsed");
    }
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
        fetchResource(`/k8s/api/v1/namespaces/${currentNamespace}/pods`),
        fetchResource(`/k8s/apis/apps/v1/namespaces/${currentNamespace}/deployments`),
        fetchResource(`/k8s/api/v1/namespaces/${currentNamespace}/services`)
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
  async function watchResource(path, onUpdate) {
    const watchPath = `${path}?watch=true`;
    try {
      const response = await fetch(watchPath);
      if (!response.body) {
        throw new Error("No response body");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) {
            try {
              const event = JSON.parse(line);
              onUpdate(event);
            } catch (e) {
              console.error("Error parsing watch event:", e);
            }
          }
        }
      }
    } catch (error) {
      console.error("Watch error:", error);
      setTimeout(() => watchResource(path, onUpdate), 5e3);
    }
  }
  async function setupWatches() {
    await fetchAll();
    const watches = [
      {
        path: `/k8s/api/v1/namespaces/${currentNamespace}/pods`,
        type: "Pod",
        callback: (event) => {
          const pod = event.object;
          console.log(`${event.type} Pod:`, {
            name: pod.metadata.name,
            phase: pod.status.phase,
            containers: pod.spec.containers.map((c) => ({
              name: c.name,
              image: c.image
            }))
          });
          clearTimeout(updateTimeout);
          updateTimeout = setTimeout(fetchAll, 100);
        }
      },
      {
        path: `/k8s/apis/apps/v1/namespaces/${currentNamespace}/deployments`,
        type: "Deployment",
        callback: (event) => {
          const deployment = event.object;
          console.log(`${event.type} Deployment:`, {
            name: deployment.metadata.name,
            replicas: deployment.spec.replicas,
            available: deployment.status.availableReplicas
          });
          clearTimeout(updateTimeout);
          updateTimeout = setTimeout(fetchAll, 100);
        }
      },
      {
        path: `/k8s/api/v1/namespaces/${currentNamespace}/services`,
        type: "Service",
        callback: (event) => {
          const service = event.object;
          console.log(`${event.type} Service:`, {
            name: service.metadata.name,
            type: service.spec.type,
            clusterIP: service.spec.clusterIP,
            ports: service.spec.ports
          });
          clearTimeout(updateTimeout);
          updateTimeout = setTimeout(fetchAll, 100);
        }
      }
    ];
    watches.forEach(({ path, callback }) => {
      watchResource(path, (data) => callback(data));
    });
  }
  var updateTimeout;
  document.addEventListener("DOMContentLoaded", () => {
    fetchNamespaces();
    setupWatches();
  });
  window.fetchAll = fetchAll;
  window.changeNamespace = changeNamespace;
  window.toggleSidebar = toggleSidebar;
})();
