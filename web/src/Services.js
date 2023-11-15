import React, { memo, useState } from 'react';
import Service from "./Service";

const Services = memo(function Services(props) {
  const { store } = props

  const [services, setServices] = useState(store.getState().services);
  store.subscribe(() => setServices(store.getState().services))

  console.log(services)

  return (
    <>
      <Service
        stack={{
          deployment: {
            pods: [
              { name: "xxx", status: "Running" },
              { name: "yyy", status: "Running" }
            ]
          },
          service: {
            name: "my-app",
            namespace: "default"
          }
        }}
        alerts={[]}
      />
      <Service
        stack={{
          deployment: {
            pods: [
              { name: "zzz", status: "Running" },
              { name: "uuu", status: "Running" }
            ]
          },
          service: {
            name: "your-app",
            namespace: "default"
          }
        }}
        alerts={[]}
      />
    </>
  )
})

export default Services;
