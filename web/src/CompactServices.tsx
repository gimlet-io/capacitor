import React, { memo } from 'react';
import { CompactService } from "./CompactService.tsx"
import { FluxService } from './types/service.ts';
import { Store } from 'redux';

export type CompactServicesProps = {
  store: Store;
  services: FluxService[];
}

export const CompactServices = memo(function CompactServices(props: CompactServicesProps) {
  const {  store, services } = props

  return (
    <div className="space-y-4">
      {
        services?.map((service) => {
          return (
            <CompactService
              key={`${service.deployment.metadata?.namespace}/${service.deployment.metadata?.name}`}
              service={service}
              store={store}
            />
          )
        })
      }
    </div>
  )
})
