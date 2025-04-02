import type { PodList, Pod, Container } from '../types.ts';

async function fetchPods() {
    try {
        const response = await fetch('/api/v1/pods');
        const data: PodList = await response.json();
        console.log('Raw pod data:', data);
        
        const podListElement = document.getElementById('podList');
        if (!podListElement) return;

        podListElement.innerHTML = data.items.map((pod: Pod) => `
            <div class="pod-item">
                <h3>${pod.metadata.namespace}/${pod.metadata.name}</h3>
                <p class="status-${pod.status.phase}">Status: ${pod.status.phase}</p>
                <p>Node: ${pod.spec.nodeName || 'Not assigned'}</p>
                <p>Pod IP: ${pod.status.podIP || 'No IP'}</p>
                <details>
                    <summary>Containers (${pod.spec.containers.length})</summary>
                    ${pod.spec.containers.map((container: Container) => `
                        <div>
                            <strong>${container.name}</strong>: ${container.image}
                        </div>
                    `).join('')}
                </details>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error fetching pods:', error);
        const podListElement = document.getElementById('podList');
        if (podListElement) {
            podListElement.innerHTML = 
                `<div class="error">Error fetching pods: ${error instanceof Error ? error.message : String(error)}</div>`;
        }
    }
}

// Initial fetch
fetchPods();

// Export for use in HTML
(window as any).fetchPods = fetchPods;
