import React, { useState, useEffect, useRef } from 'react';
import Timeline from './Timeline';
import { RevisionWidget, ReadyWidget } from './FluxState';
import jp from 'jsonpath';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { ACTION_CLEAR_PODLOGS } from './redux';

const documentIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
  </svg>
);

const lockIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-6 h-6">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
  </svg>
);

function Service(props) {
  const { service, alerts, kustomization, gitRepository, capacitorClient, store } = props;
  let reduxState = store.getState();
  const [showDescribe, setShowDescribe] = useState(false)
  const [showLogs, setShowLogs] = useState(false)
  const deployment = service.deployment;
  const svc = service.svc.metadata.namespace + "/" + service.svc.metadata.name
  const [logs, setLogs] = useState(reduxState.podLogs[svc]);
  store.subscribe(() =>  setLogs([...reduxState.podLogs[svc] ?? []]));

  const configMapWidgets = configMaps(service.pods, service.svc.metadata.namespace, capacitorClient)
  const secretWidgets = secrets(service.pods, service.svc.metadata.namespace, capacitorClient)

  const describeDeployment = () => {
    return capacitorClient.describeDeployment(deployment.metadata.namespace, deployment.metadata.name)
  }

  const streamPodLogs = () => {
    capacitorClient.podLogsRequest(service.svc.metadata.namespace, service.svc.metadata.name)
  }

  const stopLogsHandler = () => {
    setShowLogs(false);
    capacitorClient.stopPodLogsRequest(service.svc.metadata.namespace, service.svc.metadata.name);
    store.dispatch({
      type: ACTION_CLEAR_PODLOGS, payload: {
        pod: service.svc.metadata.namespace + "/" + service.svc.metadata.name
      }
    });
  }

  return (
    <>
      {showDescribe &&
        <Modal setShowModal={setShowDescribe} fetchData={describeDeployment} />
      }
      {showLogs &&
        <PodLogsModal stopHandler={stopLogsHandler} logs={logs} />
      }
      <div className="w-full flex items-center justify-between space-x-6 bg-white pb-6 rounded-lg border border-neutral-300 shadow-lg">
        <div className="flex-1">
          <h3 className="flex text-lg font-bold rounded p-4">
            <span className="cursor-pointer">{service.svc.metadata.name}</span>
            <>
            <div className="flex items-center ml-auto space-x-2">
              { deployment &&
              <>
              <button onClick={() => {setShowLogs(true); streamPodLogs()}}
                className="bg-transparent hover:bg-neutral-100 font-medium text-sm text-neutral-700 py-1 px-4 border border-neutral-300 rounded"
                >
                Logs
              </button>
              <button onClick={() => setShowDescribe(true)}
                className="bg-transparent hover:bg-neutral-100 font-medium text-sm text-neutral-700 py-1 px-4 border border-neutral-300 rounded">
                Describe
              </button>
              </>
              }
            </div>
            </>
          </h3>
          <div>
            <div className="grid grid-cols-12 mt-4 px-4">
              <div className="col-span-5 border-r space-y-4">
                <div>
                  <p className="text-base text-neutral-600">Pods</p>
                  {
                    service.pods.map((pod) => (
                      <Pod key={pod.metadata.name} pod={pod} />
                    ))
                  }
                </div>
                {(configMapWidgets || secretWidgets) &&
                <div>
                  <p className="text-base text-neutral-600">Dependencies</p>
                  <div className='grid grid-cols-4 gap-2'>
                    {configMapWidgets}
                    {secretWidgets}
                  </div>
                </div>
                }
                {/* <div>
                  <p className="text-base text-neutral-600">Links</p>
                  <div className="text-neutral-700 text-sm mt-2">
                  <a
                    className="text-neutral-600 hover:text-black"
                    href="">
                    Docs
                    <svg xmlns="http://www.w3.org/2000/svg"
                      className="inline fill-current h-4 w-4"
                      viewBox="0 0 24 24">
                      <path d="M0 0h24v24H0z" fill="none" />
                      <path
                        d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                    </svg>
                  </a>
                  <span className="px-2">|</span>
                  <a
                    className="text-neutral-600 hover:text-black" 
                    href="">
                    Logs
                    <svg xmlns="http://www.w3.org/2000/svg"
                      className="inline fill-current h-4 w-4"
                      viewBox="0 0 24 24">
                      <path d="M0 0h24v24H0z" fill="none" />
                      <path
                        d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                    </svg>
                  </a>
                  <span className="px-2">|</span>
                  <a
                    className="text-neutral-600 hover:text-black"
                    href="">
                    Metrics
                    <svg xmlns="http://www.w3.org/2000/svg"
                      className="inline fill-current h-4 w-4"
                      viewBox="0 0 24 24">
                      <path d="M0 0h24v24H0z" fill="none" />
                      <path
                        d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                    </svg>
                  </a>
                  <span className="px-2">|</span>
                  <a
                    className="text-neutral-600 hover:text-black"
                    href="">
                    Traces
                    <svg xmlns="http://www.w3.org/2000/svg"
                      className="inline fill-current h-4 w-4"
                      viewBox="0 0 24 24">
                      <path d="M0 0h24v24H0z" fill="none" />
                      <path
                        d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                    </svg>
                  </a>
                  <span className="px-2">|</span>
                  <a
                    className="text-neutral-600 hover:text-black"
                    href="">
                    Issues
                    <svg xmlns="http://www.w3.org/2000/svg"
                      className="inline fill-current h-4 w-4"
                      viewBox="0 0 24 24">
                      <path d="M0 0h24v24H0z" fill="none" />
                      <path
                        d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                    </svg>
                  </a>
                </div>
                </div> */}
              </div>
              <div className="col-span-7 space-y-4 pl-2">
                { deployment &&
                <div>
                  <p className="text-base text-neutral-600">Address</p>
                  <div className="text-neutral-900 text-sm">
                    <div className="relative">
                    {service.svc.metadata.name}.{service.svc.metadata.namespace}.svc.cluster.local
                    <button
                      className="absolute right-0 bg-transparent hover:bg-neutral-100 font-medium text-sm text-neutral-700 py-1 px-4 border border-neutral-300 rounded">
                      Port-forward command
                    </button>
                    </div>
                    {service.ingresses ? service.ingresses.map((ingress) =>
                      <p key={`${ingress.namespace}/${ingress.name}`}>
                        <a href={'https://' + ingress.url} target="_blank" rel="noopener noreferrer">{ingress.url}
                        <svg xmlns="http://www.w3.org/2000/svg"
                          className="inline fill-current ml-1 h-4 w-4"
                          viewBox="0 0 24 24">
                          <path d="M0 0h24v24H0z" fill="none" />
                          <path
                            d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                        </svg>
                        </a>
                      </p>
                      ) : null
                    }
                  </div>
                </div>
                }
                {/* { deployment &&
                <div>
                  <p className="text-base text-neutral-600">Health</p>
                  <div className="text-neutral-900 text-sm">
                    <Timeline alerts={alerts} />
                  </div>
                </div>
                } */}
                <div>
                  <p className="text-base text-neutral-600">Sync</p>
                  <div className="flex text-sm text-neutral-600">
                    <div className="ml-4"><ReadyWidget gitRepository={kustomization}/></div>
                    <div className="ml-2"><RevisionWidget kustomization={kustomization} gitRepository={gitRepository} /></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default Service;

function Pod(props) {
  const {pod} = props;

  let color;
  let pulsar;
  switch (pod.status.phase) {
    case 'Running':
      color = 'bg-green-200';
      pulsar = '';
      break;
    case 'PodInitializing':
    case 'ContainerCreating':
    case 'Pending':
      color = 'bg-blue-300';
      pulsar = 'animate-pulse';
      break;
    case 'Terminating':
      color = 'bg-neutral-500';
      pulsar = 'animate-pulse';
      break;
    default:
      color = 'bg-red-600';
      pulsar = '';
      break;
  }

  return (
    <span className={`inline-block mr-1 mt-2 shadow-lg ${color} ${pulsar} font-bold px-2 cursor-default`} title={`${pod.metadata.name} - ${pod.status}`}>
      {pod.status.phase}
    </span>
  );
}

function configMaps(pods, namespace, capacitorClient) {
  let configMaps = []
  pods.forEach((pod) => {
    const configMapNames = jp.query(pod, '$.spec.volumes[*].configMap.name');
    configMaps.push(...configMapNames);
  })
  pods.forEach((pod) => {
    const configMapNames = jp.query(pod, '$.spec.containers[*].envFrom[*].configMapRef.name');
    configMaps.push(...configMapNames);
  })

  if (configMaps.length === 0) {
    return null
  }

  return (
    <div className='block text-base text-neutral-600'>
      {configMaps.map(configMap => {
        return <ConfigMap key={configMap} name={configMap} namespace={namespace} capacitorClient={capacitorClient} />
      })}
    </div>
  )
}

function secrets(pods, namespace, capacitorClient) {
  let secrets = []
  pods.forEach((pod) => {
    const secretNames = jp.query(pod, '$.spec.volumes[*].secret.secretName');
    secrets.push(...secretNames)
  })
  pods.forEach((pod) => {
    const configMapNames = jp.query(pod, '$.spec.containers[*].envFrom[*].secretRef.name');
    secrets.push(...configMapNames);
  })

  if (secrets.length === 0) {
    return null
  }

  return (
    <div className='text-base text-neutral-600'>
      {secrets.map(secret => {
        return <Secret key={secret} name={secret} namespace={namespace} capacitorClient={capacitorClient} />
      })}
    </div>
  )
}

function ConfigMap({ name, namespace, capacitorClient }) {
  const [showModal, setShowModal] = useState(false);

  const describeConfigmap = () => {
    return capacitorClient.describeConfigmap(namespace, name)
  }

  return (
    <>
      <button
        className="block text-neutral-500 hover:text-black mt-2 text-xs font-mono px-1"
        onClick={() => setShowModal(true)}
      >
        <div className='text-center mx-auto w-6'>{documentIcon}</div>
        {name}
      </button>
      {showModal &&
        <Modal setShowModal={setShowModal} fetchData={describeConfigmap} />
      }
    </>
  );
}

function Secret({ name, namespace, capacitorClient }) {
  const [showModal, setShowModal] = useState(false);

  const describeSecret = () => {
    return capacitorClient.describeSecret(namespace, name)
  }

  return (
    <>
      <button
        className="block text-neutral-500 hover:text-black mt-2 text-xs font-mono px-1"
        onClick={() => setShowModal(true)}
      >
        <div className='text-center mx-auto w-6'>{lockIcon}</div>
        {name}
      </button>
      {showModal &&
        <Modal setShowModal={setShowModal} fetchData={describeSecret} />
      }
    </>
  );
}

function Modal(props) {
  const { setShowModal, fetchData } = props;
  const [data, setData] = useState(null)

  useEffect(() => {
    fetchData().then(data => setData(data));

    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = '15px';
    return () => { document.body.style.overflow = 'unset'; document.body.style.paddingRight = '0px' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed flex inset-0 z-10 bg-gray-500 bg-opacity-75"
      onClick={() => setShowModal(false)}
    >
      <div className="flex self-center items-center justify-center w-full p-8 h-4/5">
        <div className="transform flex flex-col overflow-hidden bg-slate-600 rounded-xl h-4/5 max-h-full w-4/5 pt-8"
          onClick={e => e.stopPropagation()}
        >
          <div className="absolute top-0 right-0 p-1.5">
            <button
              className="rounded-md inline-flex text-gray-200 hover:text-gray-500 focus:outline-none"
              onClick={() => setShowModal(false)}
            >
              <span className="sr-only">Close</span>
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="h-full relative overflow-y-auto p-4 bg-slate-800 rounded-b-lg">
            <code className='flex whitespace-pre items-center font-mono text-xs p-2 text-yellow-100 rounded'>
              {data ?? <SkeletonLoader />}
            </code>
          </div>
        </div>
      </div>
    </div>
  )
}

function PodLogsModal(props) {
  const { stopHandler, logs } = props;
  const logsEndRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = '15px';
    return () => { document.body.style.overflow = 'unset'; document.body.style.paddingRight = '0px' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    logsEndRef.current.scrollIntoView();
  }, [logs]);

  return (
    <div
      className="fixed flex inset-0 z-10 bg-gray-500 bg-opacity-75"
      onClick={stopHandler}
    >
      <div className="flex self-center items-center justify-center w-full p-8 h-4/5">
        <div className="transform flex flex-col overflow-hidden bg-slate-600 rounded-xl h-4/5 max-h-full w-4/5 pt-8"
          onClick={e => e.stopPropagation()}
        >
          <div className="absolute top-0 right-0 p-1.5">
            <button
              className="rounded-md inline-flex text-gray-200 hover:text-gray-500 focus:outline-none"
              onClick={stopHandler}
            >
              <span className="sr-only">Close</span>
              <XMarkIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="h-full relative overflow-y-auto p-4 bg-slate-800 rounded-b-lg">
            {logs ?
              logs.map((line, idx) => <p key={idx} className={`font-mono text-xs ${line.color}`}>{line.content}</p>)
              :
              <SkeletonLoader />
            }
            <p ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

const SkeletonLoader = () => {
  return (
    <div className="w-full max-w-4xl animate-pulse space-y-3">
      <div className="h-2 bg-slate-700 rounded w-1/5"></div>
      <div className="h-2 bg-slate-700 rounded w-2/5"></div>
      <div className="h-2 bg-slate-700 rounded w-3/5"></div>
      <div className="h-2 bg-slate-700 rounded w-4/5"></div>
      <div className="h-2 bg-slate-700 rounded w-4/5"></div>
      <div className="h-2 bg-slate-700 rounded w-3/5"></div>
      <div className="h-2 bg-slate-700 rounded w-2/5"></div>
      <div className="h-2 bg-slate-700 rounded w-1/5"></div>
      <div className="h-2 bg-slate-700 rounded w-2/5"></div>
      <div className="h-2 bg-slate-700 rounded w-2/5"></div>
      <div className="h-2 bg-slate-700 rounded w-1/5"></div>
      <div className="h-2 bg-slate-700 rounded w-1/5"></div>
      <div className="h-2 bg-slate-700 rounded w-1/5"></div>
      <div className="h-2 bg-slate-700 rounded w-1/6"></div>
      <div className="h-2 bg-slate-700 rounded w-2/5"></div>
      <div className="h-2 bg-slate-700 rounded w-3/5"></div>
    </div>
  )
}
