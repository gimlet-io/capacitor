import type { Terraform } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { useCalculateAge } from "./timeUtils.ts";
import { sortByName, sortByAge } from "../../utils/sortUtils.ts";
import { DetailRowCard } from "./DetailRowCard.tsx";

export const renderTerraformDetails = (terraform: Terraform, columnCount = 4) => (
  <DetailRowCard columnCount={columnCount}>
    <div style="display: contents;">
      <strong>Source Ref:</strong> {terraform.spec.sourceRef.kind}/{terraform.spec.sourceRef.namespace ? terraform.spec.sourceRef.namespace : terraform.metadata.namespace}/{terraform.spec.sourceRef.name} <br />
      {terraform.spec.path && (
        <>
          <strong>Path:</strong> {terraform.spec.path} <br />
        </>
      )}
      <strong>Interval:</strong> {terraform.spec.interval} <br />
      {terraform.spec.approvePlan && (
        <>
          <strong>Approve Plan:</strong> {terraform.spec.approvePlan} <br />
        </>
      )}
      {terraform.spec.writeOutputsToSecret?.name && (
        <>
          <strong>Outputs Secret:</strong> {terraform.spec.writeOutputsToSecret.name}
        </>
      )}
    </div>
  </DetailRowCard>
);

export const terraformColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (terraform: Terraform) => (
      <>{terraform.metadata.name}</>
    ),
    title: (terraform: Terraform) => terraform.metadata.name,
    sortable: true,
    sortFunction: (items: Terraform[], ascending: boolean) => sortByName(items, ascending) as unknown as Terraform[],
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (terraform: Terraform) =>
      useCalculateAge(terraform.metadata.creationTimestamp || "")(),
    sortable: true,
    sortFunction: (items: Terraform[], ascending: boolean) => sortByAge(items, ascending) as unknown as Terraform[],
  },
  {
    header: "READY",
    width: "20%",
    accessor: (terraform: Terraform) => {
      const readyCondition = terraform.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      const reconcilingCondition = terraform.status?.conditions?.find((c) =>
        c.type === ConditionType.Reconciling
      );

      return (
        <div class="status-badges">
          {readyCondition?.status === ConditionStatus.True && (
            <span class="status-badge ready">Ready</span>
          )}
          {readyCondition?.status === ConditionStatus.False && (
            <span class="status-badge not-ready">NotReady</span>
          )}
          {(readyCondition?.status === ConditionStatus.Unknown) && (readyCondition?.reason === "TerraformPlannedWithChanges")  && ( // The Terraform controller uses Unknown for reconciling
            <span class="status-badge approval-required">Approval Required</span>
          )}
          {(readyCondition?.status === ConditionStatus.Unknown) && (readyCondition?.reason !== "TerraformPlannedWithChanges")  && ( // The Terraform controller uses Unknown for reconciling
            <span class="status-badge reconciling">Reconciling</span>
          )}
          {terraform.spec.suspend && (
            <span class="status-badge suspended">Suspended</span>
          )}
        </div>
      );
    },
  },
  {
    header: "STATUS",
    width: "55%",
    accessor: (terraform: Terraform) => {
      const readyCondition = terraform.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      return <div class="message-cell">{readyCondition?.message}</div>;
    },
  },
];


