import { For } from "solid-js/web";
import type { ArgoCDApplication } from '../types/k8s.ts';
import { useNavigate } from "@solidjs/router";


export function ArgoCDResourceList(props: { 
  applications: ArgoCDApplication[]
}) {
  const navigate = useNavigate();

  return (
    <div class="resource-list">
      <For each={props.applications}>
        {(application: ArgoCDApplication) => {
          const syncStatus = application.status?.sync?.status || 'Unknown';
          const healthStatus = application.status?.health?.status || 'Unknown';
          
          return (
            <div
              class={`resource-item argocd-app-item ${syncStatus.toLowerCase()} ${healthStatus.toLowerCase()}`}
              onClick={() => navigate(`/application/${application.metadata.namespace}/${application.metadata.name}`)}
              style={{ cursor: 'pointer' }}
            >
              <h2>Application: {application.metadata.namespace}/{application.metadata.name}</h2>
              
              <div class="argocd-status">
                <span class={`status-badge sync-${syncStatus.toLowerCase()}`}>
                  Sync: {syncStatus}
                </span>
                <span class={`status-badge health-${healthStatus.toLowerCase()}`}>
                  Health: {healthStatus}
                </span>
                {application.status?.sync?.revision && (
                  <span class="revision">Rev: {application.status.sync.revision}</span>
                )}
              </div>
              
              <p>Project: {application.spec.project}</p>
              <p>Destination: {application.spec.destination.server || 'in-cluster'}/{application.spec.destination.namespace}</p>
              
              <div class="source-details">
                <p>Source: {application.spec.source.repoURL}</p>
                {application.spec.source.targetRevision && (
                  <p>Target Revision: {application.spec.source.targetRevision}</p>
                )}
                {application.spec.source.path && (
                  <p>Path: {application.spec.source.path}</p>
                )}
                {application.spec.source.chart && (
                  <p>Chart: {application.spec.source.chart}</p>
                )}
              </div>
              
              {application.spec.syncPolicy?.automated && (
                <div class="sync-policy">
                  <p>Auto-sync: Yes</p>
                  <p>Prune: {application.spec.syncPolicy.automated.prune ? 'Yes' : 'No'}</p>
                  <p>Self Heal: {application.spec.syncPolicy.automated.selfHeal ? 'Yes' : 'No'}</p>
                </div>
              )}
              
              {application.status?.conditions && application.status.conditions.length > 0 && (
                <details onClick={(e) => e.stopPropagation()}>
                  <summary>Conditions</summary>
                  <div class="conditions">
                    <For each={application.status.conditions}>
                      {(condition) => (
                        <div class={`condition ${condition.status.toLowerCase()}`}>
                          <p>Type: {condition.type}</p>
                          <p>Status: {condition.status}</p>
                          {condition.message && <p>Message: {condition.message}</p>}
                          <p>Last Transition: {new Date(condition.lastTransitionTime).toLocaleString()}</p>
                        </div>
                      )}
                    </For>
                  </div>
                </details>
              )}
              
              {application.status?.operationState && (
                <details onClick={(e) => e.stopPropagation()}>
                  <summary>Operation State</summary>
                  <div class="operation-state">
                    <p>Phase: {application.status.operationState.phase}</p>
                    <p>Message: {application.status.operationState.message}</p>
                    <p>Started: {new Date(application.status.operationState.startedAt).toLocaleString()}</p>
                    {application.status.operationState.finishedAt && (
                      <p>Finished: {new Date(application.status.operationState.finishedAt).toLocaleString()}</p>
                    )}
                  </div>
                </details>
              )}
              
              {application.status?.resources && application.status.resources.length > 0 && (
                <details onClick={(e) => e.stopPropagation()}>
                  <summary>Resources ({application.status.resources.length})</summary>
                  <div class="resources">
                    <For each={application.status.resources}>
                      {(resource) => (
                        <div class={`resource ${resource.status.toLowerCase()}`}>
                          <p>{resource.kind}: {resource.namespace}/{resource.name}</p>
                          <p>Status: {resource.status}</p>
                          {resource.message && <p>Message: {resource.message}</p>}
                          {resource.health && <p>Health: {resource.health.status}</p>}
                        </div>
                      )}
                    </For>
                  </div>
                </details>
              )}
              
              {application.status?.history && application.status.history.length > 0 && (
                <details onClick={(e) => e.stopPropagation()}>
                  <summary>History</summary>
                  <div class="history">
                    <For each={application.status.history.slice(0, 5)}>
                      {(historyItem) => (
                        <div class="history-item">
                          <p>Revision: {historyItem.revision}</p>
                          <p>Deployed: {new Date(historyItem.deployedAt).toLocaleString()}</p>
                        </div>
                      )}
                    </For>
                  </div>
                </details>
              )}
            </div>
          );
        }}
      </For>
    </div>
  );
} 