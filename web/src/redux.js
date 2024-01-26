export const initialState = {
  fluxState: {},
  services: [],
  podLogs: {},
  textColors: {},
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
  assignContainerTextColors(state, pod)

  if (!state.podLogs[event.deployment]) {
    state.podLogs[event.deployment] = [];
  }

  const line = {
    color: state.textColors[pod],
    timestamp: new Date(event.timestamp),
    content: `[${pod}] ${event.message}`,
    pod: pod
  };
  state.podLogs[event.deployment].push(line);
  state.podLogs[event.deployment].sort((a, b) => a.timestamp - b.timestamp);

  return state;
}

function assignContainerTextColors(state, pod) {
  const textColors = ["text-red-200", "text-purple-200", "text-green-200", "text-blue-200", "text-yellow-200", "text-orange-200"];

  if (!state.textColors[pod]) {
    const availableColors = textColors.filter(color => !Object.values(state.textColors).includes(color));
    if (availableColors.length > 0) {
      state.textColors[pod] = availableColors[0];
    } else {
      state.textColors[pod] = state.textColors[Object.keys(state.textColors)[0]];
    }
  }
}

export function clearPodLogs(state, payload) {
  state.podLogs[payload.pod] = [];
  return state;
}
