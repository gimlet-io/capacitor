import React, { useState } from 'react';
import { ACTION_CLEAR_PODLOGS } from './redux';
import { Modal } from './Modal'
import { SkeletonLoader } from './SkeletonLoader'

export function Logs(props) {
  const { capacitorClient, store, deployment, containers } = props;
  let reduxState = store.getState();
  const [showModal, setShowModal] = useState(false)
  const deploymentName = deployment.metadata.namespace + "/" + deployment.metadata.name
  const [logs, setLogs] = useState(reduxState.podLogs[deploymentName]);
  store.subscribe(() => setLogs([...reduxState.podLogs[deploymentName] ?? []]));
  const [selected, setSelected] = useState("")

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
        <Modal
          stopHandler={stopLogsHandler}
          navBar={
            <LogsNav
              containers={containers}
              selected={selected}
              setSelected={setSelected}
            />
          }
        >
          {logs ?
            logs.filter(line => line.pod.includes(selected)).map((line, idx) => <p key={idx} className={`font-mono text-xs ${line.color}`}>{line.content}</p>)
            :
            <SkeletonLoader />
          }
        </Modal>
      }
      <button onClick={() => {
        setShowModal(true);
        streamPodLogs()
      }}
        className="bg-transparent hover:bg-neutral-100 font-medium text-sm text-neutral-700 py-1 px-4 mr-2 border border-neutral-300 rounded"
      >
        Logs
      </button>
    </>
  )
}

function LogsNav(props) {
  const { containers, selected, setSelected } = props;

  return (
    <div className="flex flex-wrap items-center overflow-auto mx-4 space-x-1">
      <button
        className={`${"" === selected ? 'bg-white' : 'hover:bg-white bg-neutral-300'} my-2 inline-block rounded-full py-1 px-2 font-medium text-xs leading-tight text-neutral-700`}
        onClick={() => {
          setSelected("")
        }}
      >
        All pods
      </button>
      {
        containers?.map((container) => (
          <button
            key={container}
            title={container}
            className={`${container === selected ? 'bg-white' : 'hover:bg-white bg-neutral-300'} my-2 inline-block rounded-full py-1 px-2 font-medium text-xs leading-tight text-neutral-700`}
            onClick={() => {
              setSelected(container)
            }}
          >
            {container}
          </button>
        ))
      }
    </div>
  )
}
