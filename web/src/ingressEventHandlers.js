export function ingressCreated(state, payload) {
  let services = [...state.services];
  services.forEach(service => {
    payload.spec.rules.forEach(rule => {
      rule.http.paths.forEach(path => {
        if (path.backend.service.name === service.svc.metadata.name) {
          if (service.ingresses === undefined) {
            service.ingresses = [];
          }

          service.ingresses.push(payload);
        }
      })
    })
  });

  state.services = services
  return state
}

export function ingressUpdated(state, payload) {
  let services = [...state.services];
  services.forEach(service => {
    let url = "";
    payload.spec.rules.forEach(rule => {
      rule.http.paths.forEach(path => {
        if (path.backend.service.name === service.svc.metadata.name) {
          url = rule.host;
        }
      })
    })

    for (let i of service.ingresses) {
      if ((i.metadata.namespace + '/' + i.metadata.name ===
        payload.metadata.namespace + '/' + payload.metadata.name) &&
        url !== "") {
        i.url = url;
      }
    };
  });

  state.services = services
  return state
}

export function ingressDeleted(state, payload) {
  let services = [...state.services];
  services.forEach((service, serviceID, services) => {
    if (!service.ingresses) {
      return;
    }

    let filtered = service.ingresses.filter((ingress) => ingress.metadata.namespace + '/' + ingress.metadata.name !== payload);
    services[serviceID].ingresses = filtered;
  });

  state.services = services
  return state
}
