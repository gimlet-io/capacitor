import React, { memo, useState } from 'react';
import Service from "./Service";

const Services = memo(function Services(props) {
  const { store, filters } = props
  const [services, setServices] = useState(store.getState().services);
  store.subscribe(() => setServices(store.getState().services))
  const filteredServices = filterServices(services, filters)

  return (
    <>
      {filteredServices.map((service) => {
        return (
          <Service key={`${service.svc.metadata.namespace}/${service.svc.metadata.name}`} service={service} alerts={[]} />
        )
      })}
    </>
  )
})

export default Services;

const filterServices = (services, filters) => {
  let filteredServices = services;
  filters.forEach(filter => {
    switch (filter.property) {
      case 'Service':
        filteredServices = filteredServices.filter(service => service.svc.metadata.name.includes(filter.value))
        break;
      case 'Namespace':
        filteredServices = filteredServices.filter(service => service.svc.metadata.namespace.includes(filter.value))
        break;
      case 'Owner':
        filteredServices = filteredServices.filter(service => service.osca && service.osca.owner.includes(filter.value))
        break;
      case 'Domain':
        filteredServices = filteredServices.filter(service => service.ingresses && service.ingresses.some(ingress => ingress.url.includes(filter.value)))
        break;
      default:
    }
  })
  return filteredServices;
}
