import { Deployment } from "kubernetes-types/apps/v1";
import { Pod, Service } from "kubernetes-types/core/v1";
import { Ingress } from "kubernetes-types/networking/v1";


export type FluxService = {
    deployment: Deployment;
    pods: Pod[];
    svc: Service;
    ingresses: Ingress[]
}