# Task

@src/components/resourceDetail/LogsViewer.tsx

Currently we have options to follow logs, auto-scroll, wrap text, looking at different container logs, etc. We need a new feature. It should be a toggle, like follow logs, and with this feature we should be able to get previous logs of a pod. Just like with kubectl, using the `kubectl logs <pod-name> --previous` flag. It is a critical feature to track down CrashLoopBackOff issues.

## Metadata

- Issue: #153
- Branch: agent-153-3044225637
- Amp Thread ID: T-5741ba3b-431a-4293-a4d0-6562eada38be
- Created: 2025-07-07T09:48:04Z
