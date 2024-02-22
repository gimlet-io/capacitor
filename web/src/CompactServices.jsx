import React, { memo } from 'react';
import { CompactService } from "./Service"

export const CompactServices = memo(function CompactServices(props) {
  const { capacitorClient, store, services } = props

  return (
    <div className="space-y-4">
      {
        services?.map((service) => {
          return (
            <CompactService
              key={`${service.deployment.metadata.namespace}/${service.deployment.metadata.name}`}
              service={service}
              capacitorClient={capacitorClient}
              store={store}
            />
          )
        })
      }
    </div>
  )
})
