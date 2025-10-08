import type { Service, ServiceWithResources, Ingress, Kustomization } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { sortByName, sortByAge } from '../../utils/sortUtils.ts';
import { useCalculateAge } from './timeUtils.ts';
import { createMemo, For, Show } from "solid-js";

export const serviceColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (service: Service) => <>{service.metadata.name}</>,
    title: (service: Service) => service.metadata.name,
    sortable: true,
    sortFunction: sortByName,
  },
  {
    header: "TYPE",
    width: "15%",
    accessor: (service: Service) => <>{service.spec?.type}</>,
  },
  {
    header: "CLUSTER-IP",
    width: "15%",
    accessor: (service: Service) => <>{service.spec?.clusterIP}</>,
  },
  {
    header: "EXTERNAL-IP",
    width: "15%",
    accessor: (service: Service) => {
      const ingress = service.status?.loadBalancer?.ingress;
      if (service.spec?.type === "LoadBalancer" && ingress && ingress.length > 0) {
        return <>{ingress.map(ingress => ingress.ip || ingress.hostname).filter(Boolean).join(", ") || "Pending"}</>;
      }
      return <>None</>;
    },
  },
  {
    header: "PORT(S)",
    width: "15%",
    accessor: (service: Service) => (
      <>
        {service.spec?.ports?.map((port) =>
          `${port.port}:${port.targetPort}/${port.protocol}`
        ).join(", ") || "None"}
      </>
    ),
  },
  {
    header: "AGE",
    width: "10%",
    accessor: (service: Service) => useCalculateAge(service.metadata.creationTimestamp || '')(),
    sortable: true,
    sortFunction: sortByAge,
  },
];

// Detail row renderer for Service
export const renderServiceDetails = (service: Service | ServiceWithResources, columnCount = 6) => {
  const fqdn = createMemo(() => {
    const ns = service.metadata.namespace;
    const name = service.metadata.name;
    return `${name}.${ns}.svc.cluster.local`;
  });

  const ingressAddresses = createMemo(() => {
    const ingresses: Ingress[] = (service as ServiceWithResources).ingresses || [];
    const out: string[] = [];
    for (const ing of ingresses) {
      const addrs = ing.status?.loadBalancer?.ingress || [];
      for (const a of addrs) {
        const v = a.ip || a.hostname;
        if (v) out.push(v);
      }
      // fallback to hosts from rules if LB empty
      if (addrs.length === 0) {
        const hosts = ing.spec?.rules?.map(r => r.host).filter(Boolean) as string[];
        out.push(...hosts);
      }
    }
    // dedupe
    return Array.from(new Set(out));
  });

  const matchedPods = () => (service as ServiceWithResources).matchingPods || [];
  const _matchedDeployments = () => (service as ServiceWithResources).matchingDeployments || [];
  const kustomizations = () => (service as ServiceWithResources).kustomizations || [] as Kustomization[];

  const getPodColor = (status: string) => {
    switch (status) {
      case "Running":
        return "var(--linear-green)";
      case "Pending":
        return "var(--linear-yellow)";
      case "Failed":
        return "var(--linear-red)";
      default:
        return "var(--linear-gray)";
    }
  };

  // No inline port-forward logic here; use global commands/shortcuts

  return (
    <td colSpan={columnCount}>
      <div class="second-row" style="display: flex; gap: 50px; padding: 16px 18px; margin: 6px 16px 12px 32px; background: var(--linear-bg-secondary); border: 1px solid var(--linear-border); border-radius: 8px;">
        {/* Left column: Pods and Deployments */}
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: bold; margin-bottom: 8px;">Pods</div>
          <Show when={matchedPods().length > 0} fallback={<span>None</span>}>
            <div>
              {matchedPods().map((pod) => (
                <span
                  title={pod.metadata.name}
                  style={`display: inline-block; width: 10px; height: 10px; border-radius: 5%; background-color: ${getPodColor(pod.status.phase)}; margin: 0 2px;`}
                >
                </span>
              ))}
            </div>
          </Show>
        </div>

        {/* Right column: Address and Sync */}
        <div style="flex: 2; min-width: 0; display: flex; gap: 24px;">
          {/* Address */}
          <div style="flex: 1; min-width: 0;">
            <div style="font-weight: bold; margin-bottom: 8px;">Address</div>
            <div style="margin-bottom: 6px;">{fqdn()}</div>
            {/* Port-forward handled by commands/shortcuts */}
            <Show when={ingressAddresses().length > 0}>
              <div style="margin-top: 8px;">
                <div style="font-weight: bold; margin-bottom: 4px;">Ingress</div>
                <div>
                  <For each={ingressAddresses()}>{(addr) => (
                    <a href={`http://${addr}`} target="_blank" rel="noopener noreferrer" style={{ "margin-right": "8px", "text-decoration": "underline", "color": "var(--linear-blue)" }}>{addr}</a>
                  )}</For>
                </div>
              </div>
            </Show>
          </div>

          {/* Sync */}
          <Show when={kustomizations().length > 0}>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: bold; margin-bottom: 8px;">Flux</div>
              <ul>
                <For each={kustomizations()}>{(k) => {
                  const readyCond = k.status?.conditions?.find(c => c.type === ConditionType.Ready);
                  const reconcilingCond = k.status?.conditions?.find(c => c.type === ConditionType.Reconciling);
                  const appliedAt = k.status?.lastHandledReconcileAt;
                  const revision = k.status?.lastAppliedRevision || k.status?.lastAttemptedRevision || '';
                  return (
                    <li style="margin-bottom: 6px;">
                      <div class="status-badges" style="display:inline-flex; gap: 8px; margin-right: 8px; align-items: center;">
                        {readyCond?.status === ConditionStatus.True && (
                          <span class="status-badge ready">Ready</span>
                        )}
                        {readyCond?.status === ConditionStatus.False && (
                          <span class="status-badge not-ready">NotReady</span>
                        )}
                        {reconcilingCond?.status === ConditionStatus.True && (
                          <span class="status-badge reconciling">Reconciling</span>
                        )}
                        {k.spec?.suspend && (
                          <span class="status-badge suspended">Suspended</span>
                        )}
                      </div>
                      {appliedAt ? (
                        <>
                          Reconciled <span title={appliedAt}>{useCalculateAge(appliedAt)()}</span>
                        </>
                      ) : (
                        <span>Reconciled: n/a</span>
                      )}
                      {revision && <span> {revision}</span>}
                      <div>
                        (
                          <a
                            href={`#/kustomization/${k.metadata.namespace}/${k.metadata.name}`}
                            style={{ "text-decoration": "underline", "color": "var(--linear-blue)" }}
                          >
                            {k.metadata.namespace}/{k.metadata.name}
                          </a>
                        )
                      </div>
                    </li>
                  );
                }}</For>
              </ul>
            </div>
          </Show>
        </div>
      </div>
    </td>
  );
};
