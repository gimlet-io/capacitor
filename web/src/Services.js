import React, { memo, useState } from 'react';
import Service from "./Service";

const Services = memo(function Services(props) {
  const { store } = props

  const [services, setServices] = useState(store.getState().services);
  store.subscribe(() => setServices(store.getState().services))

  return (
    <>
      {services.map((service) => {
        return (
          <Service key={`${service.svc.metadata.namespace}/${service.svc.metadata.name}`} service={service} alerts={[]} />
        )
      })}
    </>
  )
})

export default Services;
