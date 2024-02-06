import React, { useState } from 'react';
import { HelmRevisionWidget } from './FluxState';
import { ReadyWidget } from './ReadyWidget';
import { RevisionWidget } from './Kustomization'
import jp from 'jsonpath';
import { Logs } from './Logs'
import { Describe } from './Describe'
import { SkeletonLoader } from './SkeletonLoader'
import { Modal } from './Modal'

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
  const { service, kustomization, source, helmRelease, capacitorClient, store, handleNavigationSelect } = props;
  const deployment = service.deployment;

  const configMapWidgets = configMaps(service.pods, service.svc.metadata.namespace, capacitorClient)
  const secretWidgets = secrets(service.pods, service.svc.metadata.namespace, capacitorClient)

  const svcPort = service.svc.spec.ports[0].port
  let hostPort = "<host-port>"
  if (svcPort) {
    if (svcPort <= 99) {
      hostPort = "100" + svcPort
    } else if (svcPort <= 999) {
      hostPort = "10" + svcPort
    } else {
      hostPort = svcPort
    }

    if (hostPort === "10080") { // Connections to HTTP, HTTPS or FTP servers on port 10080 will fail. This is a mitigation for the NAT Slipstream 2.0 attack.
      hostPort = "10081"
    }
  }

  return (
    <>
      <div className="w-full flex items-center justify-between space-x-6 bg-white pb-6 rounded-lg border border-neutral-300 shadow-lg">
        <div className="flex-1">
          <h3 className="flex text-lg font-bold rounded p-4">
            <span className="cursor-pointer">{service.svc.metadata.name}</span>
            <div className="flex items-center ml-auto">
              {deployment &&
                <>
                  <Logs
                    capacitorClient={capacitorClient}
                    store={store}
                    deployment={deployment}
                    containers={podContainers(service.pods)}
                  />
                  <Describe
                    capacitorClient={capacitorClient}
                    deployment={deployment}
                    pods={service.pods}
                  />
                </>
              }
            </div>
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
                <div className='text-base text-neutral-600'>
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
                    <div className='absolute right-0 top-0'>
                      <CopyBtn
                        title='Port-forward command'
                        textToCopy={`kubectl port-forward deploy/${deployment.metadata.name} -n ${deployment.metadata.namespace} ${hostPort}:${svcPort}`}
                      />
                    </div>
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
                    {svcPort &&
                        <>
                          <a href={'http://127.0.0.1:' + hostPort} target="_blank" rel="noopener noreferrer">http://127.0.0.1:{hostPort}
                            <svg xmlns="http://www.w3.org/2000/svg"
                              className="inline fill-current text-gray-500 hover:text-gray-700 mr-1 h-4 w-4"
                              viewBox="0 0 24 24">
                              <path d="M0 0h24v24H0z" fill="none" />
                              <path
                                d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
                            </svg>
                          </a>
                          (port-forward)
                        </>
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
                    <div className="ml-4"><ReadyWidget resource={kustomization} label="Applied" /></div>
                    <div className="ml-2"><RevisionWidget kustomization={kustomization} source={source} handleNavigationSelect={handleNavigationSelect} /></div>
                  </div>
                </div>
                { helmRelease &&
                <div>
                  <p className="text-base text-neutral-600">Helm Status</p>
                  <div className="flex text-sm text-neutral-600">
                    <div className="ml-4"><ReadyWidget resource={helmRelease} label="Installed" /></div>
                    <div
                      onClick={() => handleNavigationSelect("Helm Releases", helmRelease.metadata.name)}
                      className="ml-1 cursor-pointer">
                        ({helmRelease.metadata.namespace}/{helmRelease.metadata.name})
                    </div>
                    <div className="ml-4"><HelmRevisionWidget helmRelease={helmRelease} handleNavigationSelect={handleNavigationSelect} /></div>
                  </div>
                </div>
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default Service;

export function CompactService(props) {
  const { service, capacitorClient, store } = props;
  const deployment = service.deployment;

  return (
    <div className="w-full flex items-center justify-between space-x-6 bg-white pb-6 rounded-lg border border-neutral-300 shadow-lg">
      <div className="flex-1">
        <h3 className="flex text-lg font-bold rounded p-4">
          <span className="cursor-pointer">{deployment.metadata.name}</span>
          <div className="flex items-center ml-auto space-x-2">
            {deployment &&
              <>
                <Logs
                  capacitorClient={capacitorClient}
                  store={store}
                  deployment={deployment}
                  containers={podContainers(service.pods)}
                />
                <Describe
                  capacitorClient={capacitorClient}
                  deployment={deployment}
                />
              </>
            }
          </div>
        </h3>
        <div>
          <div className="grid grid-cols-12 mt-4 px-4">
            <div className="col-span-5 space-y-4">
              <div>
                <p className="text-base text-neutral-600">Pods</p>
                {
                  service.pods.map((pod) => (
                    <Pod key={pod.metadata.name} pod={pod} />
                  ))
                }
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

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
    <span className={`inline-block mr-1 mt-2 shadow-lg ${color} ${pulsar} font-bold px-2 cursor-default`} title={`${pod.metadata.name} - ${pod.status.phase}`}>
      {pod.status.phase}
    </span>
  );
}

function podContainers(pods) {
  const containers = [];

  pods.forEach((pod) => {
    const podName = jp.query(pod, '$.metadata.name')[0];

    const initContainerNames = jp.query(pod, '$.spec.initContainers[*].name');
    initContainerNames.forEach((initContainerName) => {
      containers.push(`${podName}/${initContainerName}`);
    });

    const containerNames = jp.query(pod, '$.spec.containers[*].name');
    containerNames.forEach((containerName) => {
      containers.push(`${podName}/${containerName}`);
    });
  });

  return containers;
}

function configMaps(pods, namespace, capacitorClient) {
  let configMaps = []

  if (pods.length === 0) {
    return null
  }

  const configMapNames = jp.query(pods[0], '$.spec.volumes[*].configMap.name');
  configMaps.push(...configMapNames);
  const configMapNames2 = jp.query(pods[0], '$.spec.containers[*].envFrom[*].configMapRef.name');
  configMaps.push(...configMapNames2);

  if (configMaps.length === 0) {
    return null
  }

  return (
    <>
      {configMaps.map(configMap => {
        return <ConfigMap key={configMap} name={configMap} namespace={namespace} capacitorClient={capacitorClient} />
      })}
    </>
  )
}

function secrets(pods, namespace, capacitorClient) {
  let secrets = []

  if (pods.length === 0) {
    return null
  }

  const secretNames = jp.query(pods[0], '$.spec.volumes[*].secret.secretName');
  secrets.push(...secretNames)
  const secretNames2 = jp.query(pods[0], '$.spec.containers[*].envFrom[*].secretRef.name');
  secrets.push(...secretNames2);

  if (secrets.length === 0) {
    return null
  }

  return (
    <>
      {secrets.map(secret => {
        return <Secret key={secret} name={secret} namespace={namespace} capacitorClient={capacitorClient} />
      })}
    </>
  )
}

function ConfigMap({ name, namespace, capacitorClient }) {
  const [showModal, setShowModal] = useState(false);
  const [details, setDetails] = useState(null);

  const describeConfigmap = () => {
    capacitorClient.describeConfigmap(namespace, name)
      .then(data => setDetails(data))
  }

  return (
    <>
      <button
        className="block text-neutral-500 hover:text-black mt-2 text-xs font-mono px-1"
        onClick={() => {
          setShowModal(true);
          describeConfigmap()
        }}
      >
        <div className='text-center mx-auto w-6'>{documentIcon}</div>
        {name}
      </button>
      {showModal &&
        <Modal stopHandler={() => setShowModal(false)}>
          <code className='flex whitespace-pre items-center font-mono text-xs p-2 text-yellow-100 rounded'>
            {details ?? <SkeletonLoader />}
          </code>
        </Modal>
      }
    </>
  );
}

function Secret({ name, namespace, capacitorClient }) {
  const [showModal, setShowModal] = useState(false);
  const [details, setDetails] = useState(null);

  const describeSecret = () => {
    capacitorClient.describeSecret(namespace, name)
      .then(data => setDetails(data))
  }

  return (
    <>
      <button
        className="block text-neutral-500 hover:text-black mt-2 text-xs font-mono px-1"
        onClick={() => {
          setShowModal(true);
          describeSecret()
        }}
      >
        <div className='text-center mx-auto w-6'>{lockIcon}</div>
        {name}
      </button>
      {showModal &&
        <Modal stopHandler={() => setShowModal(false)}>
          <code className='flex whitespace-pre items-center font-mono text-xs p-2 text-yellow-100 rounded'>
            {details ?? <SkeletonLoader />}
          </code>
        </Modal>
      }
    </>
  );
}

function CopyBtn({ title, textToCopy }) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(textToCopy).then(
      () => {
        setCopied(true);
        // changing back to default state after 2 seconds.
        setTimeout(() => {
          setCopied(false);
        }, 2000);
      },
      (err) => {
        console.log("failed to copy", err.mesage);
      }
    );
  };

  return (
    <div>
      {copied &&
        <span className="absolute select-none -right-1/4 -top-8 z-10 py-1 px-2 bg-gray-900 text-xs font-medium text-white rounded-lg shadow-sm dark:bg-slate-700">
          Copied
        </span>
      }
      <button
        onClick={copyToClipboard}
        className="bg-transparent hover:bg-neutral-100 font-medium text-sm text-neutral-700 py-1 px-4 border border-neutral-300 rounded">
        {title}
      </button>
    </div>
  );
}
