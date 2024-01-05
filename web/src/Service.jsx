import React, { useState } from 'react';
import Timeline from './Timeline';
import { RevisionWidget, ReadyWidget } from './FluxState';
import jp from 'jsonpath';
import { XMarkIcon } from '@heroicons/react/24/outline';

function Service(props) {
  const { service, alerts, kustomization, gitRepository } = props;
  const deployment = service.deployment;

  return (
    <>
      <div className="w-full flex items-center justify-between space-x-6 bg-white pb-6 rounded-lg border border-neutral-300 shadow-lg">
        <div className="flex-1">
          <h3 className="flex text-lg font-bold rounded p-4">
            <span className="cursor-pointer">{service.svc.metadata.name}</span>
            <>
            <div className="flex items-center ml-auto space-x-2">
              { deployment &&
              <>
              <button
                className="bg-transparent hover:bg-neutral-100 font-medium text-sm text-neutral-700 py-1 px-4 border border-neutral-300 rounded"
                >
                Logs
              </button>
              <button
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
                <div>
                  <p className="text-base text-neutral-600">Dependencies</p>
                  {configMaps(service.pods)}
                  {secrets(service.pods)}
                </div>
                <div>
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
                </div>
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
                { deployment &&
                <div>
                  <p className="text-base text-neutral-600">Health</p>
                  <div className="text-neutral-900 text-sm">
                    <Timeline alerts={alerts} />
                  </div>
                </div>
                }
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

function configMaps(pods) {
  let configMaps = []
  pods.forEach((pod) => {
    const configMapNames = jp.query(pod, '$.spec.volumes[*].configMap.name');
    configMaps.push(...configMapNames);
  })

  if (configMaps.length === 0) {
    return null
  }

  return (
    <div className='block text-base text-neutral-600'>
      ConfigMaps
      {configMaps.map(configMap => {
        return <Modal title={configMap} textToCopy={`kubectl describe configmap ${configMap}`} />
      })}
    </div>
  )
}

function secrets(pods) {
  let secrets = []
  pods.forEach((pod) => {
    const secretNames = jp.query(pod, '$.spec.volumes[*].secret.secretName');
    secrets.push(...secretNames)
  })

  if (secrets.length === 0) {
    return null
  }

  return (
    <div className='text-base text-neutral-600'>
      Secrets
      {secrets.map(secret => {
        return <Modal title={secret} textToCopy={`kubectl describe secret ${secret}`} />
      })}
    </div>
  )
}

function Modal({ title, textToCopy }) {
  const [showModal, setShowModal] = React.useState(false);
  return (
    <>
      <button
        className="block text-sm text-neutral-600 hover:text-black"
        onClick={() => setShowModal(true)}
      >
        {title}
      </button>
      {showModal ? (
        <div className="relative z-10">
          <div onClick={() => setShowModal(false)} className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity">
            <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
              <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
                <div onClick={e => e.stopPropagation()} className="relative transform overflow-hidden rounded-lg bg-white p-4 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg">
                  <div className="absolute right-0 top-0 pr-3 pt-2 sm:block">
                    <button
                      type="button"
                      className="rounded-md bg-white text-gray-400 hover:text-gray-500 focus:outline-none"
                      onClick={() => setShowModal(false)}
                    >
                      <span className="sr-only">Close</span>
                      <XMarkIcon className="h-6 w-6" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="flex items-start w-full">
                    <div className="text-center sm:mt-0 sm:text-left w-full">
                      <code className='flex justify-between whitespace-pre items-center font-mono text-sm mt-6 p-2 bg-gray-800 text-yellow-100 rounded'>
                        {`$ ${textToCopy}`}
                        <CopyBtn textToCopy={textToCopy} />
                      </code>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function CopyBtn({ textToCopy = 'Copy default' }) {
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

  const btnStyle = copied ? "text-white" : "";

  return (
    <div className="text-center relative">
      {copied &&
      <span class="absolute -top-8 z-10 py-1 px-2 bg-gray-900 text-xs font-medium text-white rounded-lg shadow-sm dark:bg-slate-700">
        Copied
      </span>
      }
      <button
        onClick={copyToClipboard}
        className={
          btnStyle +
          " text-sm border border-gray-500 rounded p-2 transition"
        }
      >
        {copied ?
          <svg class="js-clipboard-success w-4 h-4 text-green-600 rotate-6" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
          :
          <svg class="js-clipboard-default w-4 h-4 group-hover:rotate-6 transition" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="8" height="4" x="8" y="2" rx="1" ry="1" /><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /></svg>
        }
      </button>
    </div>
  );
}
