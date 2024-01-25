import React, { useState } from 'react';
import { ACTION_CLEAR_PODLOGS } from './redux';
import { Modal } from './Modal'
import { SkeletonLoader } from './SkeletonLoader'

export function Logs(props) {
  const { capacitorClient, store, deployment } = props;
  let reduxState = store.getState();
  const [showModal, setShowModal] = useState(false)
  const deploymentName = deployment.metadata.namespace + "/" + deployment.metadata.name
  const [logs, setLogs] = useState(reduxState.podLogs[deploymentName]);
  store.subscribe(() => setLogs([...reduxState.podLogs[deploymentName] ?? []]));

  const streamPodLogs = () => {
    capacitorClient.podLogsRequest(deployment.metadata.namespace, deployment.metadata.name)
  }

  const stopLogsHandler = () => {
    setShowModal(false);
    capacitorClient.stopPodLogsRequest(deployment.metadata.namespace, deployment.metadata.name);
    store.dispatch({
      type: ACTION_CLEAR_PODLOGS, payload: {
        pod: deployment.metadata.namespace + "/" + deployment.metadata.name
      }
    });
  }

  return (
    <>
      {showModal &&
        <Modal stopHandler={stopLogsHandler}>
          {logs ?
            logs.map((line, idx) => <p key={idx} className={`font-mono text-xs ${line.color}`}>{line.content}</p>)
            :
            <SkeletonLoader />
          }
        </Modal>
      }
      <button onClick={() => {
        setShowModal(true);
        streamPodLogs()
      }}
        className="bg-transparent hover:bg-neutral-100 font-medium text-sm text-neutral-700 py-1 px-4 border border-neutral-300 rounded"
      >
        Logs
      </button>
    </>
  )
}
