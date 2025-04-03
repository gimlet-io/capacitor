import { describe, it } from "https://deno.land/std@0.208.0/testing/bdd.ts";
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { ServiceList } from "../src/components/ServiceList.tsx";
import type { Service, Pod, Deployment } from "../src/types/k8s.ts";

describe("ServiceList selector matching", () => {
  it("should match pods with exact label matches", () => {
    const service: Service = {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "test-service", namespace: "default" },
      spec: {
        selector: {
          app: "myapp",
          tier: "frontend"
        }
      }
    };

    const pods: Pod[] = [
      {
        metadata: {
          name: "pod-1",
          namespace: "default",
          labels: {
            app: "myapp",
            tier: "frontend"
          }
        },
        spec: { containers: [] },
        status: { phase: "Running" }
      },
      {
        metadata: {
          name: "pod-2",
          namespace: "default",
          labels: {
            app: "myapp",
            tier: "backend"  // Different tier
          }
        },
        spec: { containers: [] },
        status: { phase: "Running" }
      }
    ];

    const deployments: Deployment[] = [];

    const matchingPods = pods.filter(pod => {
      if (!service.spec.selector) return false;
      return Object.entries(service.spec.selector).every(([key, value]) => 
        pod.metadata.labels?.[key] === value
      );
    });

    assertEquals(matchingPods.length, 1);
    assertEquals(matchingPods[0].metadata.name, "pod-1");
  });

  it("should match deployments with exact label matches", () => {
    const service: Service = {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "test-service", namespace: "default" },
      spec: {
        selector: {
          app: "myapp",
          tier: "frontend"
        }
      }
    };

    const deployments: Deployment[] = [
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: "deploy-1",
          namespace: "default",
          labels: {
            app: "myapp",
            tier: "frontend"
          }
        },
        spec: {
          replicas: 1,
          selector: { matchLabels: {} },
          template: {
            metadata: {
              name: "deploy-1-template",
              labels: {
                app: "myapp",
                tier: "frontend"
              }
            },
            spec: { containers: [] }
          }
        },
        status: { availableReplicas: 1, readyReplicas: 1, replicas: 1, updatedReplicas: 1 }
      },
      {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: {
          name: "deploy-2",
          namespace: "default",
          labels: {
            app: "myapp",
            tier: "backend"  // Different tier
          }
        },
        spec: {
          replicas: 1,
          selector: { matchLabels: {} },
          template: {
            metadata: {
              name: "deploy-2-template",
              labels: {
                app: "myapp",
                tier: "backend"
              }
            },
            spec: { containers: [] }
          }
        },
        status: { availableReplicas: 1, readyReplicas: 1, replicas: 1, updatedReplicas: 1 }
      }
    ];

    const pods: Pod[] = [];

    const matchingDeployments = deployments.filter(deployment => {
      if (!service.spec.selector) return false;
      return Object.entries(service.spec.selector).every(([key, value]) => 
        deployment.spec.template.metadata.labels?.[key] === value
      );
    });

    assertEquals(matchingDeployments.length, 1);
    assertEquals(matchingDeployments[0].metadata.name, "deploy-1");
  });

  it("should handle missing selectors", () => {
    const service: Service = {
      apiVersion: "v1",
      kind: "Service",
      metadata: { name: "test-service", namespace: "default" },
      spec: {}  // No selector
    };

    const pods: Pod[] = [
      {
        metadata: {
          name: "pod-1",
          namespace: "default",
          labels: { app: "myapp" }
        },
        spec: { containers: [] },
        status: { phase: "Running" }
      }
    ];

    const deployments: Deployment[] = [];

    const matchingPods = pods.filter(pod => {
      if (!service.spec.selector) return false;
      return Object.entries(service.spec.selector).every(([key, value]) => 
        pod.metadata.labels?.[key] === value
      );
    });

    assertEquals(matchingPods.length, 0);
  });
}); 