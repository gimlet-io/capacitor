import type { ApiResource, ObjectMeta } from "../types/k8s.ts";

export type MinimalK8sResource = {
  apiVersion?: string;
  kind: string;
  metadata: ObjectMeta;
};

export type PermissionOptions = {
  verb: string;
  subresource?: string;
  resourceOverride?: string;
  groupOverride?: string;
  nameOverride?: string | null;
};

export const resolvePluralName = (
  resource: MinimalK8sResource,
  apiResources?: ApiResource[]
): string => {
  try {
    const apiVersion: string = resource.apiVersion || "v1";
    const group = apiVersion.includes('/') ? apiVersion.split('/')[0] : '';
    const version = apiVersion.includes('/') ? apiVersion.split('/')[1] : apiVersion;
    const kind = resource.kind;
    if (apiResources && apiResources.length > 0) {
      const match = apiResources.find(r => r.kind === kind && r.group === group && r.version === version);
      if (match?.name) return match.name;
    }
  } catch (_) {
    // ignore and fall back to naive plural
  }
  return `${String(resource.kind || '').toLowerCase()}s`;
};

type SelfSubjectAccessReview = {
  apiVersion: "authorization.k8s.io/v1";
  kind: "SelfSubjectAccessReview";
  spec: {
    resourceAttributes: {
      group?: string;
      resource: string;
      namespace?: string;
      verb: string;
      name?: string;
      subresource?: string;
    };
  };
};

export const checkPermissionSSAR = async (
  resource: MinimalK8sResource,
  opts: PermissionOptions,
  apiResources?: ApiResource[]
): Promise<boolean> => {
  if (!resource || !resource.metadata) return false;
  try {
    const apiVersion: string = resource.apiVersion || "v1";
    const group = opts.groupOverride !== undefined ? opts.groupOverride : (apiVersion.includes('/') ? apiVersion.split('/')[0] : '');
    const plural = opts.resourceOverride || resolvePluralName(resource, apiResources);
    const body: SelfSubjectAccessReview = {
      apiVersion: "authorization.k8s.io/v1",
      kind: "SelfSubjectAccessReview",
      spec: {
        resourceAttributes: {
          group,
          resource: plural,
          namespace: resource.metadata.namespace,
          verb: opts.verb,
        },
      },
    };
    const name = opts.nameOverride === undefined ? resource.metadata.name : opts.nameOverride;
    if (name) body.spec.resourceAttributes.name = name;
    if (opts.subresource) body.spec.resourceAttributes.subresource = opts.subresource;

    const resp = await fetch('/k8s/apis/authorization.k8s.io/v1/selfsubjectaccessreviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!resp.ok) return true; // be permissive on SSAR failure
    const data = await resp.json();
    return !!data?.status?.allowed;
  } catch (_) {
    return true; // permissive on error
  }
};


