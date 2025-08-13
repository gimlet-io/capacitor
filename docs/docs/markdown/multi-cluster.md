## Multi-Cluster

- Capacitor Next runs on your laptop and uses your kube config to access your clusters.
- You can use the cluster selector inside the app to switch between clusters.
- By default Capacitor uses your default kubeconfig in `~/.kube.config`, but you can specify a custom location by running `next --kubeconfig ~/.kube/my-other-config`
- If you [self-host](#self-host) Capacitor Next for your team, you can specify the list of available clusters in a config file.

