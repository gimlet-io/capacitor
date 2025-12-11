// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

import type { ApiResource, ObjectMeta } from "../types/k8s.ts";
import { useApiResourceStore } from "../store/apiResourceStore.tsx";

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

// Cache SSAR results across the app to avoid excessive duplicate calls
// Keyed by: group|resourcePlural|namespace|name|verb|subresource
const ssarResultCache = new Map<string, boolean>();
const ssarInFlight = new Map<string, Promise<boolean>>();

const makeSsarCacheKey = (
  group: string | undefined,
  resourcePlural: string,
  namespace: string | undefined,
  name: string | undefined | null,
  verb: string,
  subresource?: string
): string => {
  return `${group || ''}|${resourcePlural}|${namespace || ''}|${name || ''}|${verb}|${subresource || ''}`;
};

const checkPermissionSSAR = async (
  resource: MinimalK8sResource,
  opts: PermissionOptions,
  ctxNameFromCaller: string,
  apiResources?: ApiResource[]
): Promise<boolean> => {
  if (!resource || !resource.metadata) return false;
  try {
    const apiVersion: string = resource.apiVersion || "v1";
    const group = opts.groupOverride !== undefined ? opts.groupOverride : (apiVersion.includes('/') ? apiVersion.split('/')[0] : '');
    const plural = opts.resourceOverride || resolvePluralName(resource, apiResources);
    const resolvedName = opts.nameOverride === undefined ? resource.metadata.name : opts.nameOverride;
    const key = makeSsarCacheKey(group, plural, resource.metadata.namespace, resolvedName ?? undefined, opts.verb, opts.subresource);

    if (ssarResultCache.has(key)) {
      return ssarResultCache.get(key)!;
    }
    if (ssarInFlight.has(key)) {
      return await ssarInFlight.get(key)!;
    }

    const requestPromise = (async () => {
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
      if (resolvedName) body.spec.resourceAttributes.name = resolvedName;
      if (opts.subresource) body.spec.resourceAttributes.subresource = opts.subresource;

      // Context must be supplied by the caller (typically via useCheckPermissionSSAR);
      // when absent, fall back to cluster-agnostic '/k8s'.
      const effectiveCtxName = ctxNameFromCaller;
      const k8sPrefix = effectiveCtxName ? `/k8s/${encodeURIComponent(effectiveCtxName)}` : '/k8s';
      const resp = await fetch(`${k8sPrefix}/apis/authorization.k8s.io/v1/selfsubjectaccessreviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!resp.ok) {
        console.log('checkPermissionSSAR', 'SSAR request failed', resp.status, resp.statusText);
        return false;
      }
      const data = await resp.json();
      const allowed = !!data?.status?.allowed;
      ssarResultCache.set(key, allowed);
      return allowed;
    })();

    ssarInFlight.set(key, requestPromise);
    try {
      const result = await requestPromise;
      return result;
    } finally {
      ssarInFlight.delete(key);
    }
  } catch (_) {
    console.log('checkPermissionSSAR', 'error', _);
    return false
  }
};
 
export function useCheckPermissionSSAR() {
  const apiResourceStore = useApiResourceStore();
  return async (
    resource: MinimalK8sResource,
    opts: PermissionOptions
  ): Promise<boolean> => {
    const ctxName = apiResourceStore.contextInfo?.current;
    if (!ctxName) {
      console.log("checkPermissionSSAR", "missing context name from ApiResourceStore");
      return false;
    }
    return checkPermissionSSAR(resource, opts, ctxName, apiResourceStore.apiResources);
  };
}

