import React, { useState, useEffect } from 'react';
import jp from 'jsonpath'
import { formatDistance, format } from "date-fns";

function FluxState(props) {
  const { store } = props

  const [fluxState, setFluxState] = useState(store.getState().fluxState);
  store.subscribe(() => setFluxState(store.getState().fluxState))

  return (
    <div>
      <GitRepositories gitRepositories={fluxState.gitRepositories} />
      <Kustomizations fluxState={fluxState} />
    </div>
  )
}

export function Kustomizations(props){
  const { fluxState } = props
  const kustomizations = fluxState.kustomizations;
  const gitRepositories = fluxState.gitRepositories

  return (
    <div className="grid gap-y-4 grid-cols-1">
      {
        kustomizations?.map(kustomization => {
          const gitRepository = gitRepositories.find((g) => g.metadata.name === kustomization.spec.sourceRef.name)

          return (
            <div
              className="rounded-md border border-neutral-300 p-4 grid grid-cols-12 gap-x-4 bg-white shadow"
              key={`${kustomization.metadata.namespace}/${kustomization.metadata.name}`}
              >
              <div className="col-span-2">
                <span className="block font-medium text-black">
                  {kustomization.metadata.name}
                </span>
                <span className="block text-neutral-600">
                  {kustomization.metadata.namespace}
                </span>
              </div>
              <div className="col-span-5">
                <span className="block"><ReadyWidget resource={kustomization} displayMessage={true} label="Applied" /></span>
              </div>
              <div className="col-span-5">
                <div className="font-medium text-neutral-700"><RevisionWidget kustomization={kustomization} gitRepository={gitRepository} /></div>
                <span className='font-mono rounded text-neutral-600 bg-gray-100 px-1'>{kustomization.spec.path}</span>
              </div>
            </div>
          )
        })
      }
    </div>
  )
}

export function HelmReleases(props) {
  const { helmReleases } = props

  return (
    <div className="grid gap-y-4 grid-cols-1">
      {
        helmReleases?.map(helmRelease => {
          return (
            <div
              className="rounded-md border border-neutral-300 p-4 grid grid-cols-12 gap-x-4 bg-white shadow"
              key={`hr-${helmRelease.metadata.namespace}/${helmRelease.metadata.name}`}
              >
              <div className="col-span-2">
                <span className="block font-medium text-black">
                  {helmRelease.metadata.name}
                </span>
                <span className="block text-neutral-600">
                  {helmRelease.metadata.namespace}
                </span>
              </div>
              <div className="col-span-5">
                <span className="block"><ReadyWidget resource={helmRelease} displayMessage={true} label="Installed" /></span>
              </div>
              <div className="col-span-5">
                <div className="font-medium text-neutral-700"><HelmRevisionWidget helmRelease={helmRelease} withHistory={true} /></div>
              </div>
            </div>
          )
        })
      }
    </div>
  )
}

export function RevisionWidget(props) {
  const { kustomization, gitRepository } = props

  const appliedRevision = kustomization.status.lastAppliedRevision
  const appliedHash = appliedRevision ? appliedRevision.slice(appliedRevision.indexOf(':') + 1) : "";

  const lastAttemptedRevision = kustomization.status.lastAttemptedRevision
  const lastAttemptedHash = lastAttemptedRevision ? lastAttemptedRevision.slice(lastAttemptedRevision.indexOf(':') + 1) : "";

  const readyConditions = jp.query(kustomization.status, '$..conditions[?(@.type=="Ready")]');
  const readyCondition = readyConditions.length === 1 ? readyConditions[0] : undefined
  const ready = readyCondition && readyConditions[0].status === "True"

  const readyTransitionTime = readyCondition ? readyCondition.lastTransitionTime : undefined
  const parsed = Date.parse(readyTransitionTime, "yyyy-MM-dd'T'HH:mm:ss");
  const fiveMinutesAgo = new Date();
  fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);
  const stalled = fiveMinutesAgo > parsed

  // const reconcilingConditions = jp.query(kustomization.status, '$..conditions[?(@.type=="Reconciling")]');
  // const reconcilingCondition = reconcilingConditions.length === 1 ? reconcilingConditions[0] : undefined
  // const reconciling = reconcilingCondition && reconcilingConditions[0].status === "True"

  return (
    <>
    { !ready && stalled &&
      <span className='bg-orange-400'>
        <span>Last Attempted: </span>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" className="h4 w-4 inline fill-current"><path d="M320 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160zm156.8-48C462 361 397.4 416 320 416s-142-55-156.8-128H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H163.2C178 151 242.6 96 320 96s142 55 156.8 128H608c17.7 0 32 14.3 32 32s-14.3 32-32 32H476.8z"/></svg>
        <span className="pl-1"><a href="https://gimlet.io" target="_blank" rel="noopener noreferrer">{lastAttemptedHash.slice(0, 8)}</a></span>
        <span>&nbsp;({`${gitRepository.metadata.namespace}/${gitRepository.metadata.name}`})</span>
      </span>
    }
    <span className={`block ${ready ? '' : 'font-normal text-neutral-600'} field`}>
      { !ready &&
      <span>Currently Applied: </span>
      }
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" className="h4 w-4 inline fill-current"><path d="M320 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160zm156.8-48C462 361 397.4 416 320 416s-142-55-156.8-128H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H163.2C178 151 242.6 96 320 96s142 55 156.8 128H608c17.7 0 32 14.3 32 32s-14.3 32-32 32H476.8z"/></svg>
      <span className="pl-1"><a href="https://gimlet.io" target="_blank" rel="noopener noreferrer">{appliedHash.slice(0, 8)}</a></span>
      <span>&nbsp;({`${gitRepository.metadata.namespace}/${gitRepository.metadata.name}`})</span>
    </span>
    </>
  )
}

export function GitRepositories(props){
  const { gitRepositories } = props

  return (
    <div className="grid gap-y-4 grid-cols-1">
      {
        gitRepositories?.map(gitRepository => {
          return (
            <div 
              className="rounded-md border border-neutral-300 p-4 grid grid-cols-12 gap-x-4 bg-white shadow"
              key={`${gitRepository.metadata.namespace}/${gitRepository.metadata.name}`}
              >
              <div className="col-span-2">
                <span className="block font-medium text-black">
                  {gitRepository.metadata.name}
                </span>
                <span className="block text-neutral-600">
                  {gitRepository.metadata.namespace}
                </span>
              </div>
              <div className="col-span-5">
                <ReadyWidget resource={gitRepository} displayMessage={true}/>
              </div>
              <div className="col-span-5">
                <ArtifactWidget gitRepository={gitRepository} displayMessage={true}/>
              </div>
            </div>
          )
        })
      }
    </div>
  )
}

export function ReadyWidget(props) {
  const { resource, displayMessage, label } = props

  const readyConditions = jp.query(resource.status, '$..conditions[?(@.type=="Ready")]');
  const readyCondition = readyConditions.length === 1 ? readyConditions[0] : undefined
  const ready = readyCondition && readyConditions[0].status === "True"

  const readyTransitionTime = readyCondition ? readyCondition.lastTransitionTime : undefined
  const parsed = Date.parse(readyTransitionTime, "yyyy-MM-dd'T'HH:mm:ss");
  const exactDate = format(parsed, 'MMMM do yyyy, h:mm:ss a O')
  const fiveMinutesAgo = new Date();
  fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);
  const stalled = fiveMinutesAgo > parsed

  const reconcilingConditions = jp.query(resource.status, '$..conditions[?(@.type=="Reconciling")]');
  const reconcilingCondition = reconcilingConditions.length === 1 ? reconcilingConditions[0] : undefined
  const reconciling = reconcilingCondition && reconcilingConditions[0].status === "True"

  const color = ready ? "bg-teal-400" : reconciling && !stalled ? "bg-blue-400 animate-pulse" : "bg-orange-400 animate-pulse"
  const statusLabel = ready ? label ? label : "Ready" : reconciling && !stalled ? "Reconciling" : "Error"
  const messageColor = ready ? "text-neutral-600 field" : reconciling && !stalled ? "text-neutral-600" : "bg-orange-400"

  return (
    <div className="relative">
      <div className='font-medium text-neutral-700'>
        <span className={`absolute -left-4 top-1 rounded-full h-3 w-3 ${color} inline-block`}></span>
        <span>{statusLabel}</span>
        {readyCondition &&
        <TimeLabel title={exactDate} date={parsed} />
        }
      </div>
      { displayMessage && readyCondition &&
      <div className={`block ${messageColor}`}>
        { reconciling &&
        <p>{reconcilingCondition.message}</p>
        }
        <p>{readyCondition.message}</p>
      </div>
      }
    </div>

  )
}

export function ArtifactWidget(props) {
  const { gitRepository } = props
  const artifact = gitRepository.status.artifact

  const revision = artifact.revision
  const hash = revision.slice(revision.indexOf(':') + 1);
  const url = gitRepository.spec.url.slice(gitRepository.spec.url.indexOf('@') + 1)
  const branch = gitRepository.spec.ref.branch

  const parsed = Date.parse(artifact.lastUpdateTime, "yyyy-MM-dd'T'HH:mm:ss");
  const exactDate = format(parsed, 'MMMM do yyyy, h:mm:ss a O')

  return (
    <>
    <div className="field font-medium text-neutral-700">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" className="h4 w-4 inline fill-current"><path d="M320 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160zm156.8-48C462 361 397.4 416 320 416s-142-55-156.8-128H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H163.2C178 151 242.6 96 320 96s142 55 156.8 128H608c17.7 0 32 14.3 32 32s-14.3 32-32 32H476.8z"/></svg>
      <span className="pl-1">
        <a href={`https://${url}/commit/${hash}`} target="_blank" rel="noopener noreferrer">
        {hash.slice(0, 8)} committed <TimeLabel title={exactDate} date={parsed} />
        </a>
      </span>
    </div>
    <span className="block field text-neutral-600">
      <span className='font-mono bg-gray-100 px-1 rounded'>{branch}</span>
      <span className='px-1'>@</span>
      <a href={`https://${url}`} target="_blank" rel="noopener noreferrer">{url}</a>
    </span>
    </>
  )
}

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
    { !ready && reconciling && !stalled &&
      <span>
        <span>Attempting: </span>
        <span>{helmRelease.spec.chart.spec.version}@{helmRelease.spec.chart.spec.chart}</span>
      </span>
    }
    { !ready && stalled &&
      <span className='bg-orange-400'>
        <span>Last Attempted: </span>
        {/* <span>{lastAttemptedRevision}@{version.chartName}</span> */}
        <span>{helmRelease.spec.chart.spec.version}@{helmRelease.spec.chart.spec.chart}</span>
      </span>
    }
    <span className={`block ${ready || reconciling ? '' : 'font-normal text-neutral-600'} field`}>
      <span>Currently Installed: </span>
      <span>{appliedRevision}@{version && version.chartName}</span>
    </span>
    { withHistory &&
    <div className='pt-1 text-sm'>
      {helmRelease.status.history && helmRelease.status.history.map((release) => {
        const current = release.status === "deployed"

        let statusLabel = ""
        if (release.status === "deployed") {
          statusLabel = "was deployed"
        } else if (release.status === "superseded") {
          statusLabel = "was deployed, now superseded"
        } else if (release.status === "failed") {
          statusLabel = "failed to deploy"
        }

        const deployTime = release.lastDeployed
        const parsed = Date.parse(deployTime, "yyyy-MM-dd'T'HH:mm:ss");
        const exactDate = format(parsed, 'MMMM do yyyy, h:mm:ss a O')

        return (
          <p className={`${current ? "text-neutral-700" : "font-normal text-neutral-500"}`}>
            <span>{release.chartVersion}@{release.chartName}</span>
            <TimeLabel title={exactDate} date={parsed} className='pl-1' />
            <span className='pl-1'>{statusLabel}</span>
          </p>
        )
        })
      }
    </div>
    }
    </>

  )
}

function TimeLabel(props) {
  const { title, date, className } = props;
  const [label, setLabel] = useState(formatDistance(date, new Date()));

  useEffect(() => {
    const interval = setInterval(() => {
      setLabel(formatDistance(date, new Date()));
    }, 60 * 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className={className} title={title}> {label} ago</span>
  )
}

export function Summary(props) {
  const { resources, label } = props;

  if (!resources) {
    return null;
  }

  const totalCount = resources.length
  const readyCount = resources.filter(resourece => {
    const readyConditions = jp.query(resourece.status, '$..conditions[?(@.type=="Ready")]');
    const ready = readyConditions.length === 1 && readyConditions[0].status === "True"
    return ready
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
  const reconciling = reconcilingCount > 0
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

export default FluxState;
