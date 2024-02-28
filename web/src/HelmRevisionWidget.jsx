import jp from 'jsonpath'
import { format } from "date-fns";
import { TimeLabel } from './TimeLabel'

export function HelmRevisionWidget(props) {
  const { helmRelease, withHistory } = props

  const version = helmRelease.status.history ? helmRelease.status.history[0] : undefined
  const appliedRevision = helmRelease.status.lastAppliedRevision
  // const lastAttemptedRevision = helmRelease.status.lastAttemptedRevision

  const readyConditions = jp.query(helmRelease.status, '$..conditions[?(@.type=="Ready")]');
  const readyCondition = readyConditions.length === 1 ? readyConditions[0] : undefined
  const ready = readyConditions.length === 1 && readyConditions[0].status === "True"

  const readyTransitionTime = readyCondition ? readyCondition.lastTransitionTime : undefined
  const parsed = Date.parse(readyTransitionTime, "yyyy-MM-dd'T'HH:mm:ss");
  const fiveMinutesAgo = new Date();
  fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);
  const stalled = fiveMinutesAgo > parsed

  const reconcilingConditions = jp.query(helmRelease.status, '$..conditions[?(@.type=="Reconciling")]');
  const reconcilingCondition = reconcilingConditions.length === 1 ? reconcilingConditions[0] : undefined
  const reconciling = reconcilingCondition && reconcilingConditions[0].status === "True"

  return (
    <>
      {!ready && reconciling && !stalled &&
        <span>
          <span>Attempting: </span>
          <span>{helmRelease.spec.chart.spec.version}@{helmRelease.spec.chart.spec.chart}</span>
        </span>
      }
      {!ready && stalled &&
        <span className='bg-orange-400'>
          <span>Last Attempted: </span>
          {/* <span>{lastAttemptedRevision}@{version.chartName}</span> */}
          <span>{helmRelease.spec.chart.spec.version}@{helmRelease.spec.chart.spec.chart}</span>
        </span>
      }
      <span className={`block ${ready || reconciling ? '' : 'font-normal text-neutral-600'} field`}>
        <span>Currently Installed: </span>
        {appliedRevision}@{version && version.chartName}
      </span>
      {withHistory &&
        <div className='pt-1 text-sm'>
          {helmRelease.status.history && helmRelease.status.history.map((release) => {
            const current = release.status === "deployed"

            let statusLabel = ""
            if (release.status === "deployed") {
              statusLabel = "was deployed"
            } else if (release.status === "superseded") {
              statusLabel = "was deployed"
            } else if (release.status === "failed") {
              statusLabel = "failed to deploy"
            }

            const deployTime = release.lastDeployed
            const parsed = Date.parse(deployTime, "yyyy-MM-dd'T'HH:mm:ss");
            const exactDate = format(parsed, 'MMMM do yyyy, h:mm:ss a O')

            return (
              <p key={`${release.chartVersion}@${release.chartName}:${release.digest}`} className={`${current ? "text-neutral-700" : "font-normal text-neutral-500"}`}>
                <span>{release.chartVersion}@{release.chartName}</span>
                <span className='pl-1'>{statusLabel}</span>
                <TimeLabel title={exactDate} date={parsed} /> ago
                {release.status === "superseded" &&
                  <span className='pl-1'>now superseded</span>
                }
              </p>
            )
          })
          }
        </div>
      }
    </>

  )
}