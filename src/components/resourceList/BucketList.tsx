import type { Source } from "../../types/k8s.ts";
import { ConditionStatus, ConditionType } from "../../utils/conditions.ts";
import { fluxReadyFilter, handleFluxReconcile } from "../../utils/fluxUtils.tsx";
import { useCalculateAge } from "./timeUtils.ts";

// Type definition for Bucket since it's not in k8s.ts
type Bucket = Source & {
  spec: Source['spec'] & {
    bucketName: string;
    endpoint: string;
    provider?: string;
    secretRef?: {
      name: string;
    };
    insecure?: boolean;
    region?: string;
    interval: string;
  };
};

export const renderBucketDetails = (bucket: Bucket, columnCount = 4) => (
  <td colSpan={columnCount}>
    <div class="second-row">
      <strong>Bucket Name:</strong> {bucket.spec.bucketName} <br />
      <strong>Endpoint:</strong> {bucket.spec.endpoint} <br />
      {bucket.spec.provider && (
        <>
          <strong>Provider:</strong> {bucket.spec.provider} <br />
        </>
      )}
      {bucket.spec.region && (
        <>
          <strong>Region:</strong> {bucket.spec.region} <br />
        </>
      )}
      {bucket.spec.secretRef && (
        <>
          <strong>Secret:</strong> {bucket.spec.secretRef.name} <br />
        </>
      )}
      <strong>Insecure:</strong> {bucket.spec.insecure ? "True" : "False"} <br />
      <strong>Interval:</strong> {bucket.spec.interval} <br />
      <strong>Suspended:</strong>{" "}
      {bucket.spec.suspend ? "True" : "False"}
    </div>
  </td>
);

// Reuse the generic reconcile function
export const handleReconcile = handleFluxReconcile;

export const bucketColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (bucket: Bucket) => (
      <>{bucket.metadata.name}</>
    ),
    title: (bucket: Bucket) => bucket.metadata.name,
  },
  {
    header: "AGE",
    width: "5%",
    accessor: (bucket: Bucket) =>
      useCalculateAge(bucket.metadata.creationTimestamp || "")(),
  },
  {
    header: "READY",
    width: "20%",
    accessor: (bucket: Bucket) => {
      const readyCondition = bucket.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      const artifactCondition = bucket.status?.conditions?.find((c) =>
        c.type === "ArtifactInStorage"
      );

      return (
        <div class="status-badges">
          {readyCondition?.status === ConditionStatus.True && (
            <span class="status-badge ready">Ready</span>
          )}
          {readyCondition?.status === ConditionStatus.False && (
            <span class="status-badge not-ready">NotReady</span>
          )}
          {artifactCondition?.status === ConditionStatus.True && (
            <span class="status-badge artifact">Artifact</span>
          )}
          {bucket.spec.suspend && (
            <span class="status-badge suspended">Suspended</span>
          )}
        </div>
      );
    },
  },
  {
    header: "STATUS",
    width: "55%",
    accessor: (bucket: Bucket) => {
      const readyCondition = bucket.status?.conditions?.find((c) =>
        c.type === ConditionType.Ready
      );
      return <div class="message-cell">{readyCondition?.message}</div>;
    },
  },
]; 