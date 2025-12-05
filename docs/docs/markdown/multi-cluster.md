# Multi-Cluster

## Local-first CLI

In the local-first version (as described in [Quickstart](#quickstart)) we use your kubeconfig  to access Kubernetes.

Clusters, named as contexts are described and set in the kubeconfig (`~/.kube.config`) file. If you have multiple clusters defined, you can switch between them in the context selector in the top left corner.

![Cluster selector in Capacitor Next](media/context.png)

If you are not sure how to get a valid kubeconfig file, reach out to your cluster administrator.

If you have multiple kubeconfig files, Capacitor Next respects the `KUBECONFIG` environment variable.

```bash
export KUBECONFIG=~/.kube/config:~/.kube/my-other-config
next -p 3333
```

## Self-hosted version
