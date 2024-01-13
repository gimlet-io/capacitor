import React, { useState } from 'react';
import { SkeletonLoader } from './SkeletonLoader'
import { Modal } from './Modal'

export function Describe(props) {
  const { capacitorClient, deployment } = props;
  const [details, setDetails] = useState(null)
  const [showModal, setShowModal] = useState(false)

  const describeDeployment = () => {
    capacitorClient.describeDeployment(deployment.metadata.namespace, deployment.metadata.name)
      .then(data => setDetails(data))
  }

  return (
    <>
      {showModal &&
        <Modal stopHandler={() => setShowModal(false)}>
          <code className='flex whitespace-pre items-center font-mono text-xs p-2 text-yellow-100 rounded'>
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
