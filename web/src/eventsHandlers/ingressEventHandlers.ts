export function ingressCreated(state, payload) {
  let services = [...state.services];
  services.forEach(service => {
    payload.spec.rules.forEach(rule => {
      rule.http.paths.forEach(path => {
        if (path.backend.service.name === service.svc.metadata.name) {
          if (!serviceHasIngress(service, payload)) {
            if (service.ingresses === undefined) {
              service.ingresses = [];
            }

            service.ingresses.push(payload);
          }
        }
      })
    })
  });

  state.services = services
  return state
}

export function ingressUpdated(state, payload) {
  let services = [...state.services];
  services.forEach((service, serviceID, services) => {
    service.ingresses && service.ingresses.forEach((i, ingressID) => {
      if (i.metadata.namespace + '/' + i.metadata.name ===
        payload.metadata.namespace + '/' + payload.metadata.name) {
        services[serviceID].ingresses[ingressID] = payload;
      }
    });
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

function serviceHasIngress(service, ingress) {
  if (service.ingresses === undefined) {
    return false;
  }

  for (let i of service.ingresses) {
    if (i.metadata.namespace + '/' + i.metadata.name ===
      ingress.metadata.namespace + '/' + ingress.metadata.name) {
      return true;
    }
  }

  return false;
}
