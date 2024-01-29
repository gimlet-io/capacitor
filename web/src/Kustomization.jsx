import React, { useState, useEffect, useRef } from 'react';
import { ReadyWidget } from './ReadyWidget'
import jp from 'jsonpath'
import { NavigationButton } from './NavigationButton'

export function Kustomization(props) {
  const { capacitorClient, item, gitRepositories, targetReference, handleNavigationSelect } = props;
  const ref = useRef(null);
  const [highlight, setHighlight] = useState(false)

  useEffect(() => {
    setHighlight(targetReference === item.metadata.name);
    if (targetReference === item.metadata.name) {
      ref.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [item.metadata.name, targetReference]);

  const gitRepository = gitRepositories.find((g) => g.metadata.name === item.spec.sourceRef.name)

  return (
    <div
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
      <div className="col-span-4">
        <span className="block"><ReadyWidget resource={item} displayMessage={true} label="Applied" /></span>
      </div>
      <div className="col-span-4">
        <div className="font-medium text-neutral-700">
          <RevisionWidget
            kustomization={item}
            gitRepository={gitRepository}
            handleNavigationSelect={handleNavigationSelect}
            inFooter={true}
          />
        </div>
        <span className='font-mono rounded text-neutral-600 bg-gray-100 px-1'>{item.spec.path}</span>
      </div>
      <div className="grid-cols-2">
        <button className="bg-transparent hover:bg-neutral-100 font-medium text-sm text-neutral-700 py-1 px-4 mr-2 border border-neutral-300 rounded"
          onClick={() => capacitorClient.reconcile("kustomization", item.metadata.namespace, item.metadata.name)}
        >
          Reconcile
        </button>
      </div>
    </div>
  )
}

export function RevisionWidget(props) {
  const { kustomization, gitRepository, handleNavigationSelect, inFooter } = props

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

  const url = gitRepository.spec.url.slice(gitRepository.spec.url.indexOf('@') + 1)

  return (
    <>
    { !ready && stalled &&
      <span className='bg-orange-400'>
        <span>Last Attempted: </span>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" className="h4 w-4 inline fill-current"><path d="M320 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160zm156.8-48C462 361 397.4 416 320 416s-142-55-156.8-128H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H163.2C178 151 242.6 96 320 96s142 55 156.8 128H608c17.7 0 32 14.3 32 32s-14.3 32-32 32H476.8z"/></svg>
        <span className="pl-1">
          <a href={`https://${url}/commit/${lastAttemptedHash}`} target="_blank" rel="noopener noreferrer">
            {lastAttemptedHash.slice(0, 8)}
          </a>
        </span>
        <NavigationButton handleNavigation={() => handleNavigationSelect(inFooter ? "Sources" : "Kustomizations", gitRepository.metadata.name)}>
          &nbsp;({`${gitRepository.metadata.namespace}/${gitRepository.metadata.name}`})
        </NavigationButton>
      </span>
    }
    <span className={`block ${ready ? '' : 'font-normal text-neutral-600'} field`}>
      { !ready &&
      <span>Currently Applied: </span>
      }
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" className="h4 w-4 inline fill-current"><path d="M320 336a80 80 0 1 0 0-160 80 80 0 1 0 0 160zm156.8-48C462 361 397.4 416 320 416s-142-55-156.8-128H32c-17.7 0-32-14.3-32-32s14.3-32 32-32H163.2C178 151 242.6 96 320 96s142 55 156.8 128H608c17.7 0 32 14.3 32 32s-14.3 32-32 32H476.8z"/></svg>
      <span className="pl-1">
        <a href={`https://${url}/commit/${appliedHash}`} target="_blank" rel="noopener noreferrer">
          {appliedHash.slice(0, 8)}
        </a>
      </span>
      <NavigationButton handleNavigation={() => handleNavigationSelect(inFooter ? "Sources" : "Kustomizations", gitRepository.metadata.name)}>
        &nbsp;({`${gitRepository.metadata.namespace}/${gitRepository.metadata.name}`})
      </NavigationButton>
    </span>
    </>
  )
}
