import { HelmRelease } from "@kubernetes-models/flux-cd/helm.toolkit.fluxcd.io/v2beta1"
import { Kustomization } from "@kubernetes-models/flux-cd/kustomize.toolkit.fluxcd.io/v1beta1"
import { Bucket, GitRepository, HelmChart, HelmRepository, OCIRepository } from "@kubernetes-models/flux-cd/source.toolkit.fluxcd.io/v1beta2"
import { FluxService } from "./service"

export type FluxState = {
    buckets: Bucket[]
    fluxServices: FluxService[]
    gitRepositories: GitRepository[]
    helmCharts:HelmChart[]
    helmReleases:HelmRelease[]
    helmRepositories: HelmRepository[]
    kustomizations: Kustomization[]
    ociRepositories: OCIRepository[]
}