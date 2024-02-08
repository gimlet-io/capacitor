export function findSource(sources, reconciler) {
  let namespace = reconciler.metadata.namespace
  if (reconciler.spec.sourceRef.namespace) { // namespace is not mandatory
    namespace = reconciler.spec.sourceRef.namespace
  }

  return sources.find((source) => source.kind === reconciler.spec.sourceRef.kind &&
    source.metadata.name === reconciler.spec.sourceRef.name &&
    source.metadata.namespace === namespace)
}
