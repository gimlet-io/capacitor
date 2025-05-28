import type { ServiceAccount } from "../../types/k8s.ts";
import { Filter } from "../filterBar/FilterBar.tsx";

// Define the columns for the ServiceAccount resource list
export const serviceAccountColumns = [
  {
    header: "NAME",
    width: "30%",
    accessor: (sa: ServiceAccount) => <>{sa.metadata.name}</>,
    title: (sa: ServiceAccount) => sa.metadata.name,
  },
  {
    header: "SECRETS",
    width: "15%",
    accessor: (sa: ServiceAccount) => {
      const secretCount = sa.secrets?.length || 0;
      return <>{secretCount}</>;
    },
    title: (sa: ServiceAccount) => {
      const secrets = sa.secrets || [];
      if (secrets.length === 0) {
        return "No secrets";
      }
      
      return secrets.map(s => s.name).filter(Boolean).join(", ") || "Unnamed secrets";
    },
  },
  {
    header: "IMAGE PULL SECRETS",
    width: "15%",
    accessor: (sa: ServiceAccount) => {
      const pullSecretCount = sa.imagePullSecrets?.length || 0;
      return <>{pullSecretCount}</>;
    },
    title: (sa: ServiceAccount) => {
      const pullSecrets = sa.imagePullSecrets || [];
      if (pullSecrets.length === 0) {
        return "No image pull secrets";
      }
      
      return pullSecrets.map(s => s.name).filter(Boolean).join(", ") || "Unnamed pull secrets";
    },
  },
  {
    header: "TOKEN AUTO-MOUNT",
    width: "15%",
    accessor: (sa: ServiceAccount) => {
      // If automountServiceAccountToken is undefined, it defaults to true
      const automount = sa.automountServiceAccountToken === undefined ? true : sa.automountServiceAccountToken;
      return <>{automount ? "Yes" : "No"}</>;
    },
  },
  {
    header: "AGE",
    width: "15%",
    accessor: (sa: ServiceAccount) => {
      if (!sa.metadata.creationTimestamp) return <>N/A</>;
      const startTime = new Date(sa.metadata.creationTimestamp);
      const now = new Date();
      const diff = now.getTime() - startTime.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor(
        (diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
      );
      return <>{days > 0 ? `${days}d${hours}h` : `${hours}h`}</>;
    },
  },
];

// Filter for ServiceAccounts by automount token setting
export const serviceAccountAutomountFilter: Filter = {
  name: "serviceAccountAutomount",
  label: "Token Auto-Mount",
  options: [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ],
  filterFunction: (sa: ServiceAccount, value: string) => {
    // If automountServiceAccountToken is undefined, it defaults to true
    const automount = sa.automountServiceAccountToken === undefined ? true : sa.automountServiceAccountToken;
    return (value === "yes" && automount) || (value === "no" && !automount);
  },
}; 