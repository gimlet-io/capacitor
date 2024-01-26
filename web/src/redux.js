export const initialState = {
  fluxState: {},
  services: [],
  podLogs: {},
}

export const ACTION_FLUX_STATE_RECEIVED = 'FLUX_STATE_RECEIVED';
export const ACTION_SERVICES_RECEIVED = 'SERVICES_RECEIVED';
export const ACTION_POD_LOGS_RECEIVED = 'POD_LOGS_RECEIVED';
export const ACTION_CLEAR_PODLOGS = 'CLEAR_POD_LOGS';

export function rootReducer(state = initialState, action) {
  switch (action.type) {
    case ACTION_FLUX_STATE_RECEIVED:
      return fluxStateReceived(state, action.payload)
    case ACTION_SERVICES_RECEIVED:
      return servicesReceived(state, action.payload)
    case ACTION_POD_LOGS_RECEIVED:
        return podLogsReceived(state, action.payload)
    case ACTION_CLEAR_PODLOGS:
       return clearPodLogs(state, action.payload)
    default:
      console.log('Could not process redux event: ' + JSON.stringify(action));
      return state;
  }
}

function fluxStateReceived(state, payload) {
  state.fluxState = payload
  return state
}

function servicesReceived(state, payload) {
  state.services = payload
  return state
}

function podLogsReceived(state, event) {
  const pod = event.pod + "/" + event.container;

  if (!state.podLogs[event.deployment]) {
    state.podLogs[event.deployment] = [];
  }

  const line = {
    timestamp: new Date(event.timestamp),
    content: `[${event.timestamp}] ${event.message}`,
    pod: pod
  };
  state.podLogs[event.deployment].push(line);
  state.podLogs[event.deployment].sort((a, b) => a.timestamp - b.timestamp);

  return state;
}

export function clearPodLogs(state, payload) {
  state.podLogs[payload.pod] = [];
  return state;
}
