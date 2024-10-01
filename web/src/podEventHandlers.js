export function podCreated(state, payload) {
  let services = [...state.services];
  services.forEach(service => {
    if (labelsMatchSelectors(payload.metadata.labels, service.svc.spec.selector)) {
      if (!serviceHasPod(service, payload)) {
        if (!service.pods) {
          service.pods = [];
        }
        service.pods.push(payload)
      }
    }
  });

  state.services = services
  return state
}

export function podUpdated(state, payload) {
  let services = [...state.services];
  services.forEach((service, serviceID, services) => {
    if (labelsMatchSelectors(payload.metadata.labels, service.svc.spec.selector)) {
      service.pods && service.pods.forEach((pod, podID) => {
        if (pod.metadata.namespace + '/' + pod.metadata.name ===
          payload.metadata.namespace + '/' + payload.metadata.name) {
          services[serviceID].pods[podID] = payload;
        }
      })
    }
  });

  state.services = services
  return state
}

export function podDeleted(state, payload) {
  let services = [...state.services];
  services.forEach(service => {
    let toRemove = undefined;
    service.pods.forEach((pod, podID) => {
      if (pod.metadata.namespace + '/' + pod.metadata.name === payload) {
        toRemove = podID;
      }
    });
    if (toRemove !== undefined) {
      service.pods.splice(toRemove, 1);
    }
  });

  state.services = services
  return state
}

function labelsMatchSelectors(labels, selectors) {
  for (const [k2, v2] of Object.entries(selectors)) {
    // eslint-disable-next-line no-prototype-builtins
    if (labels.hasOwnProperty(k2)) {
      let v = labels[k2];
      if (v2 !== v) {
        return false;
      }
    } else {
      return false;
    }
  }

  return true;
}

function serviceHasPod(service, pod) {
  if (service.pods === undefined) {
    return false;
  }

  for (let servicePod of service.pods) {
    if (servicePod.metadata.namespace + '/' + servicePod.metadata.name ===
      pod.metadata.namespace + '/' + pod.metadata.name) {
      return true;
    }
  }

  return false;
}
