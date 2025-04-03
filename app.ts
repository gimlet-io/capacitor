import type { PodList, Pod, DeploymentList, Deployment, ServiceList, Service } from './types/k8s.ts';

let currentNamespace = 'test'; // Default namespace

async function fetchResource<T>(path: string): Promise<T> {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
}

// Add new function to fetch namespaces
async function fetchNamespaces() {
    try {
        const response = await fetchResource<{
            items: Array<{ metadata: { name: string } }>;
        }>('/k8s/api/v1/namespaces');

        const select = document.getElementById('namespaceSelect') as HTMLSelectElement;
        if (select) {
            select.innerHTML = response.items
                .map(ns => `
                    <option value="${ns.metadata.name}" 
                            ${ns.metadata.name === currentNamespace ? 'selected' : ''}>
                        ${ns.metadata.name}
                    </option>
                `)
                .join('');
        }
    } catch (error) {
        console.error('Error fetching namespaces:', error);
    }
}

// Add function to handle namespace change
function changeNamespace() {
    const select = document.getElementById('namespaceSelect') as HTMLSelectElement;
    if (select) {
        currentNamespace = select.value;
        setupWatches(); // Restart watches with new namespace
    }
}

// Add function to toggle sidebar
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
    }
}

function renderPods(pods: Pod[]): string {
    return pods.map(pod => `
        <div class="resource-item pod-item">
            <h3>${pod.metadata.namespace}/${pod.metadata.name}</h3>
            <p class="status-${pod.status.phase}">Status: ${pod.status.phase}</p>
            <p>Node: ${pod.spec.nodeName || 'Not assigned'}</p>
            <p>Pod IP: ${pod.status.podIP || 'No IP'}</p>
            <details>
                <summary>Containers (${pod.spec.containers.length})</summary>
                ${pod.spec.containers.map(container => `
                    <div>
                        <strong>${container.name}</strong>: ${container.image}
                    </div>
                `).join('')}
            </details>
        </div>
    `).join('');
}

function renderDeployments(deployments: Deployment[]): string {
    return deployments.map(deployment => `
        <div class="resource-item deployment-item">
            <h3>${deployment.metadata.namespace}/${deployment.metadata.name}</h3>
            <p>Replicas: ${deployment.status.readyReplicas || 0}/${deployment.spec.replicas || 0}</p>
            <details>
                <summary>Labels</summary>
                <pre>${JSON.stringify(deployment.spec.selector.matchLabels, null, 2)}</pre>
            </details>
        </div>
    `).join('');
}

function renderServices(services: Service[]): string {
    return services.map(service => `
        <div class="resource-item service-item">
            <h3>${service.metadata.namespace}/${service.metadata.name}</h3>
            <p>Type: ${service.spec.type || 'ClusterIP'}</p>
            <p>Cluster IP: ${service.spec.clusterIP || 'None'}</p>
            <details>
                <summary>Ports</summary>
                ${service.spec.ports?.map(port => `
                    <div>
                        ${port.name ? `<strong>${port.name}</strong>: ` : ''}
                        ${port.port}${port.targetPort ? ` → ${port.targetPort}` : ''}
                        ${port.nodePort ? ` (NodePort: ${port.nodePort})` : ''}
                    </div>
                `).join('') || 'No ports defined'}
            </details>
        </div>
    `).join('');
}

async function fetchAll() {
    try {
        const [pods, deployments, services] = await Promise.all([
            fetchResource<PodList>(`/k8s/api/v1/namespaces/${currentNamespace}/pods`),
            fetchResource<DeploymentList>(`/k8s/apis/apps/v1/namespaces/${currentNamespace}/deployments`),
            fetchResource<ServiceList>(`/k8s/api/v1/namespaces/${currentNamespace}/services`)
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

        const mainElement = document.getElementById('resources');
        if (mainElement) {
            mainElement.innerHTML = content;
        }
    } catch (error) {
        console.error('Error fetching resources:', error);
        const mainElement = document.getElementById('resources');
        if (mainElement) {
            mainElement.innerHTML = 
                `<div class="error">Error fetching resources: ${error instanceof Error ? error.message : String(error)}</div>`;
        }
    }
}

interface WatchConfig<T> {
    path: string;
    type: string;
    callback: (event: { type: string; object: T }) => void;
}

async function watchResource<T>(
    path: string, 
    onUpdate: (data: { type: string; object: T }) => void
): Promise<void> {
    const watchPath = `${path}?watch=true`;
    try {
        const response = await fetch(watchPath);
        if (!response.body) {
            throw new Error('No response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const event = JSON.parse(line);
                        onUpdate(event);
                    } catch (e) {
                        console.error('Error parsing watch event:', e);
                    }
                }
            }
        }
    } catch (error) {
        console.error('Watch error:', error);
        setTimeout(() => watchResource(path, onUpdate), 5000);
    }
}

async function setupWatches() {
    // Initial fetch
    await fetchAll();

    const watches: WatchConfig<Pod | Deployment | Service>[] = [
        {
            path: `/k8s/api/v1/namespaces/${currentNamespace}/pods`,
            type: 'Pod',
            callback: (event) => {
                const pod = event.object as Pod;
                console.log(`${event.type} Pod:`, {
                    name: pod.metadata.name,
                    phase: pod.status.phase,
                    containers: pod.spec.containers.map(c => ({
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
            type: 'Deployment',
            callback: (event) => {
                const deployment = event.object as Deployment;
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
            type: 'Service',
            callback: (event) => {
                const service = event.object as Service;
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

    // Set up watches
    watches.forEach(({ path, callback }) => {
        watchResource(path, (data) => callback(data));
    });
}

let updateTimeout: number;

// Update initialization
document.addEventListener('DOMContentLoaded', () => {
    fetchNamespaces();
    setupWatches();
});

// Export for use in HTML
(window as any).fetchAll = fetchAll;
(window as any).changeNamespace = changeNamespace;
(window as any).toggleSidebar = toggleSidebar;


