/**
 * FluxCD Controller Configuration
 * 
 * Supports custom FluxCD installations via environment variables.
 * All values have sensible defaults for standard FluxCD installations.
 * 
 * Environment variables:
 * - FLUXCD_NAMESPACE: FluxCD namespace (default: "fluxcd-system")
 * - FLUXCD_HELM_CONTROLLER_NAME: Helm controller deployment name
 * - FLUXCD_HELM_CONTROLLER_LABEL_KEY: Helm controller label selector key
 * - FLUXCD_HELM_CONTROLLER_LABEL_VALUE: Helm controller label selector value
 * - FLUXCD_KUSTOMIZE_CONTROLLER_NAME: Kustomize controller deployment name
 * - FLUXCD_KUSTOMIZE_CONTROLLER_LABEL_KEY: Kustomize controller label selector key
 * - FLUXCD_KUSTOMIZE_CONTROLLER_LABEL_VALUE: Kustomize controller label selector value
 */

export const fluxcdConfig = {
  namespace: Deno.env.get("FLUXCD_NAMESPACE") || "fluxcd-system",
  
  helmController: {
    deploymentName: Deno.env.get("FLUXCD_HELM_CONTROLLER_NAME") || "fluxcd-helm-controller",
    labelKey: Deno.env.get("FLUXCD_HELM_CONTROLLER_LABEL_KEY") || "app.kubernetes.io/component",
    labelValue: Deno.env.get("FLUXCD_HELM_CONTROLLER_LABEL_VALUE") || "helm-controller",
  },
  
  kustomizeController: {
    deploymentName: Deno.env.get("FLUXCD_KUSTOMIZE_CONTROLLER_NAME") || "fluxcd-kustomize-controller",
    labelKey: Deno.env.get("FLUXCD_KUSTOMIZE_CONTROLLER_LABEL_KEY") || "app.kubernetes.io/component",
    labelValue: Deno.env.get("FLUXCD_KUSTOMIZE_CONTROLLER_LABEL_VALUE") || "kustomize-controller",
  },
} as const;
