import React, { useState } from 'react';
import { SkeletonLoader } from './SkeletonLoader'
import { Modal } from './Modal'

export function Describe(props) {
  const { capacitorClient, deployment, pods } = props;
  const [details, setDetails] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [selected, setSelected] = useState(deployment.metadata.name)

  const describeDeployment = () => {
    capacitorClient.describeDeployment(deployment.metadata.namespace, deployment.metadata.name)
      .then(data => setDetails(data))
  }

  const describePod = (podNamespace, podName) => {
    capacitorClient.describePod(podNamespace, podName)
      .then(data => setDetails(data))
  }

  

  return (
    <>
      {showModal &&
        <Modal
          stopHandler={() => { setShowModal(false); setSelected(deployment.metadata.name) }}
          deployment={deployment.metadata.name}
        >
          <div aria-labelledby="slide-over-title" role="dialog" aria-modal="true" className="fixed flex overflow-x-auto whitespace-nowrap inset-x-0 top-8 bg-slate-600 text-yellow-100 font-medium text-sm">
            <button
              className={`${deployment.metadata.name === selected ? 'bg-slate-500 text-yellow-50' : 'hover:bg-slate-500'} group flex gap-x-3 px-2 py-1 text-sm leading-6 rounded-t-md`}
              onClick={() => {
                describeDeployment();
                setSelected(deployment.metadata.name)
              }}
            >
              Describe from {deployment.metadata.name}
            </button>
            {
              pods?.map((pod) => (
                <button key={pod.metadata.name}
                  className={`${pod.metadata.name === selected ? 'bg-slate-500 text-yellow-50' : 'hover:bg-slate-500'} group flex gap-x-3 px-2 py-1 text-sm leading-6 rounded-t-md`}
                  onClick={() => {
                    describePod(pod.metadata.namespace, pod.metadata.name);
                    setSelected(pod.metadata.name)
                  }}
                >
                  Describe from {pod.metadata.name}
                </button>
              ))
            }
          </div>
          <code className='flex whitespace-pre items-center font-mono text-xs p-2 pt-10 text-yellow-100 rounded'>
            {details ?? <SkeletonLoader />}
          </code>
        </Modal>
      }
      <button onClick={() => {
        setShowModal(true);
        describeDeployment()
      }}
        className="bg-transparent hover:bg-neutral-100 font-medium text-sm text-neutral-700 py-1 px-4 border border-neutral-300 rounded">
        Describe
      </button>
    </>
  )
}
