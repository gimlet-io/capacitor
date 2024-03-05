import React from 'react';
import { Logs } from './Logs'
import { Describe } from './Describe'
import { Pod, podContainers } from './Service'

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
                  pods={service.pods}
                />
              </>
            }
          </div>
        </h3>
        <div>
          <div className="grid grid-cols-12 px-4">
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
