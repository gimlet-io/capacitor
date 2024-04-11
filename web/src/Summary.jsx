import jp from 'jsonpath'

export function Summary(props) {
  const { resources, label } = props;

  if (!resources) {
    return null;
  }

  const totalCount = resources.length
  const readyCount = resources.filter(resource => {
    if (resource.kind === "HelmRepository" && resource.spec.type === 'oci') {
      return true
    }
    const readyConditions = jp.query(resource.status, '$..conditions[?(@.type=="Ready")]');
    const ready = readyConditions.length === 1 && readyConditions[0].status === "True"
    return ready
  }).length
  const dependencyNotReadyCount = resources.filter(resourece => {
    const readyConditions = jp.query(resourece.status, '$..conditions[?(@.type=="Ready")]');
    const dependencyNotReady = readyConditions.length === 1 && readyConditions[0].reason === "DependencyNotReady"
    return dependencyNotReady
  }).length
  const reconcilingCount = resources.filter(resourece => {
    const readyConditions = jp.query(resourece.status, '$..conditions[?(@.type=="Reconciling")]');
    const ready = readyConditions.length === 1 && readyConditions[0].status === "True"
    return ready
  }).length
  const stalledCount = resources.filter(resourece => {
    const readyConditions = jp.query(resourece.status, '$..conditions[?(@.type=="Ready")]');
    const ready = readyConditions.length === 1 && readyConditions[0].status === "True"
    if (ready) {
      return false
    }

    const readyTransitionTime = readyConditions.length === 1 ? readyConditions[0].lastTransitionTime : undefined
    const parsed = Date.parse(readyTransitionTime, "yyyy-MM-dd'T'HH:mm:ss");

    const fiveMinutesAgo = new Date();
    fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);
    const stalled = fiveMinutesAgo > parsed

    return stalled
  }).length

  const ready = readyCount === totalCount
  const reconciling = reconcilingCount > 0 || dependencyNotReadyCount > 0
  const stalled = stalledCount > 0
  const readyLabel = ready ? "Ready" : reconciling && !stalled ? "Reconciling" : "Error"
  const color = ready ? "bg-teal-400" : reconciling && !stalled ? "bg-blue-400 animate-pulse" : "bg-orange-400 animate-pulse"

  return (
    <>
      <div>
        <span className="font-bold text-neutral-700">{label}:</span>
        <span className='relative text-neutral-700 ml-5'>
          <span className={`absolute -left-4 top-1 rounded-full h-3 w-3 ${color} inline-block`}></span>
          <span>{readyLabel}</span>
        </span>
        <span>({readyCount}/{totalCount})</span>
      </div>
    </>
  )
}
