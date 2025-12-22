# Multi-Cluster

## Local-first CLI

In the local-first version (as described in [Quickstart](#quickstart)) we use your kubeconfig  to access Kubernetes.

Clusters, named as contexts are described and set in the kubeconfig (`~/.kube.config`) file. If you have multiple clusters defined, you can switch between them in the context selector in the top left corner.

![Cluster selector in Capacitor Next](media/context.png)

If you are not sure how to get a valid kubeconfig file, reach out to your cluster administrator.

If you have multiple kubeconfig files, Capacitor Next respects the `KUBECONFIG` environment variable.

```bash
export KUBECONFIG=~/.kube/config:~/.kube/my-other-config
next
```

## Self-hosted version

You define the list of clusters in the `registry.yaml` environment variable.

In the example bellow
- we deployed Capacitor Next on the infra cluster
- the infra cluster uses an in-cluster ServiceAccount based Kubernetes API access
- and defined two agent based environments: staging and prod
- The agents are deployed on the remote clusters and match the agentSecrets. The agent uses an in-cluster API access on the remote clusters.

```yaml
clusters:
  - id: infra
    name: infra
    apiServerURL: https://kubernetes.default.svc
    certificateAuthorityFile: /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
    serviceAccount:
      tokenFile: /var/run/secrets/kubernetes.io/serviceaccount/token
  - id: staging
    name: staging
    agent: true
    agentSecret: < run `openssl rand -hex 32`> # use the same shared secret in the agent deployment
  - id: prod
    name: prod
    agent: true
    agentSecret: < run `openssl rand -hex 32`> # use the same shared secret in the agent deployment
```

Check the [Capacitor Next Agent deployment instructions](#self-host).
