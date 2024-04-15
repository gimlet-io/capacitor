import { OCIRepository, GitRepository, Bucket, HelmRepository, HelmChart } from "@kubernetes-models/flux-cd/source.toolkit.fluxcd.io/v1beta2";


export type Source = OCIRepository | GitRepository | Bucket | HelmRepository | HelmChart;

