export function serviceCreated(state, payload) {
  let services = [...state.services];
  if (!services.some(service => service.svc.metadata.namespace + '/' + service.svc.metadata.name ===
    payload.metadata.namespace + '/' + payload.metadata.name)) {
    services.push({
      svc: payload,
      pods: [],
    });
  }

  state.services = services
  return state
}

export function serviceUpdated(state, payload) {
  let services = [...state.services];
  services.forEach(service => {
    if (service.metadata.namespace + '/' + service.metadata.name !==
      payload.metadata.namespace + '/' + payload.metadata.name) {
      return;
    }
    service.svc = payload;
  });

  state.services = services
  return state
}

export function serviceDeleted(state, payload) {
  let services = [...state.services];
  let toRemove = undefined;
  services.forEach((service, serviceID) => {
    if (service.svc.metadata.namespace + '/' + service.svc.metadata.name === payload) {
      toRemove = serviceID;
    }
  });
  if (toRemove !== undefined) {
    services.splice(toRemove, 1);
  }

  state.services = services
  return state
}
