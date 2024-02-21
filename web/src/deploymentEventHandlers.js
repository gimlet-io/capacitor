export function deploymentCreated(state, payload) {
  let services = [...state.services];
  services.forEach((service, serviceID) => {
    if (!selectorsMatch(payload.spec.selector.matchLabels, service.svc.spec.selector)) {
      return;
    }

    if (service.deployment === undefined) {
      service[serviceID].deployment = payload;
    }
  });

  state.services = services
  return state
}

export function deploymentUpdated(state, payload) {
  let services = [...state.services];
  services.forEach((service, serviceID, services) => {
    if (!selectorsMatch(payload.spec.selector.matchLabels, service.svc.spec.selector)) {
      return;
    }

    if (service.deployment && service.deployment.metadata.namespace + '/' + service.deployment.metadata.name ===
      payload.metadata.namespace + '/' + payload.metadata.name) {
      services[serviceID].deployment = payload;
    }
  });

  state.services = services
  return state
}

export function deploymentDeleted(state, payload) {
  let services = [...state.services];
  services.forEach((service, stackID, stacks) => {
    if (service.deployment && service.deployment.namespace + '/' + service.deployment.name === payload) {
      delete stacks[stackID].deployment;
    }
  });

  state.services = services;
  return state
}

function selectorsMatch(first, second) {
  if (Object.keys(first).length !== Object.keys(second).length) {
    return false
  }

  for (const [k, v] of Object.entries(first)) {
    if (second.hasOwnProperty(k)) {
      let v2 = second[k];
      if (v !== v2) {
        return false;
      }
    } else {
      return false;
    }
  }

  for (const [k2, v2] of Object.entries(second)) {
    if (first.hasOwnProperty(k2)) {
      let v = first[k2];
      if (v2 !== v) {
        return false;
      }
    } else {
      return false;
    }
  }
}
