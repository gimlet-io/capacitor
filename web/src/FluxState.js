import React, { useState, useEffect, useRef } from 'react';
import jp from 'jsonpath'
import { format } from "date-fns";
import { Kustomization } from './Kustomization.jsx'
import { ReadyWidget } from './ReadyWidget'
import { TimeLabel } from './TimeLabel'

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
  const { fluxState, targetReference, handleNavigationSelect } = props
  const kustomizations = fluxState.kustomizations;
  const gitRepositories = fluxState.gitRepositories

  return (
    <div className="grid gap-y-4 grid-cols-1">
      {
        kustomizations?.map(kustomization =>
          <Kustomization
            key={kustomization.metadata.namespace + kustomization.metadata.name}
            item={kustomization}
            gitRepositories={gitRepositories}
            handleNavigationSelect={handleNavigationSelect}
            targetReference={targetReference}
          />
        )
      }
    </div>
  )
}

export function HelmReleases(props) {
  const { helmReleases, targetReference, handleNavigationSelect } = props

  return (
    <div className="grid gap-y-4 grid-cols-1">
      {
        helmReleases?.map(helmRelease =>
          <HelmRelease
            key={"hr-"+ helmRelease.metadata.namespace + helmRelease.metadata.name}
            item={helmRelease}
            handleNavigationSelect={handleNavigationSelect}
            targetReference={targetReference}
          />
          )}
    </div>
  )
}

function HelmRelease(props) {
  const { item, targetReference, handleNavigationSelect } = props;
  const ref = useRef(null);
  const [highlight, setHighlight] = useState(false)

  useEffect(() => {
    setHighlight(targetReference === item.metadata.name);
    if (targetReference === item.metadata.name) {
      ref.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [item.metadata.name, targetReference]);

  return (
    <div
      ref={ref}
      className={(highlight ? "ring-2 ring-indigo-600 ring-offset-2" : "") + " rounded-md border border-neutral-300 p-4 grid grid-cols-12 gap-x-4 bg-white shadow"}
      key={`hr-${item.metadata.namespace}/${item.metadata.name}`}
    >
      <div className="col-span-2">
        <span className="block font-medium text-black">
          {item.metadata.name}
        </span>
        <span className="block text-neutral-600">
          {item.metadata.namespace}
        </span>
      </div>
      <div className="col-span-5">
        <span className="block"><ReadyWidget resource={item} displayMessage={true} label="Installed" /></span>
      </div>
      <div className="col-span-5">
        <div className="font-medium text-neutral-700"><HelmRevisionWidget helmRelease={item} withHistory={true} handleNavigationSelect={handleNavigationSelect} /></div>
      </div>
    </div>)
}

export function GitRepositories(props){
  const { gitRepositories, targetReference } = props

  return (
    <div className="grid gap-y-4 grid-cols-1">
      {
        gitRepositories?.map(gitRepository =>
          <GitRepository
            key={"source-"+ gitRepository.metadata.namespace + gitRepository.metadata.name}  
            item={gitRepository}
            targetReference={targetReference}
          />
        )
      }
    </div>
  )
}

function GitRepository(props) {
  const { item, targetReference } = props;
  const ref = useRef(null);
  const [highlight, setHighlight] = useState(false)

  useEffect(() => {
    setHighlight(targetReference === item.metadata.name);
    if (targetReference === item.metadata.name) {
      ref.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [item.metadata.name, targetReference]);

  return (
    <div
      ref={ref}
      className={(highlight ? "ring-2 ring-indigo-600 ring-offset-2" : "") + " rounded-md border border-neutral-300 p-4 grid grid-cols-12 gap-x-4 bg-white shadow"}
      key={`${item.metadata.namespace}/${item.metadata.name}`}
      >
      <div className="col-span-2">
        <span className="block font-medium text-black">
          {item.metadata.name}
        </span>
        <span className="block text-neutral-600">
          {item.metadata.namespace}
        </span>
      </div>
      <div className="col-span-5">
        <ReadyWidget resource={item} displayMessage={true}/>
      </div>
      <div className="col-span-5">
        <ArtifactWidget gitRepository={item} displayMessage={true}/>
      </div>
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
        {appliedRevision}@{version && version.chartName}
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
          <p key={`${release.chartVersion}@${release.chartName}`} className={`${current ? "text-neutral-700" : "font-normal text-neutral-500"}`}>
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

export default FluxState;
