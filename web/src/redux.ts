import * as podEventHandlers from './eventsHandlers/podEventHandlers.ts';
import * as deploymentEventHandlers from './eventsHandlers/deploymentEventHandlers.ts';
import * as ingressEventHandlers from './eventsHandlers/ingressEventHandlers.ts';
import * as serviceEventHandlers from './eventsHandlers/serviceEventHandlers.ts';
import { Store } from 'redux';
import { FluxEvent } from './types/fluxEvent';
import { FluxService } from './types/service';
import { FluxState } from './types/fluxState';

export const initialState = {
  fluxState: {} as FluxState,
  fluxEvents: [] as FluxEvent[],
  services: [] as FluxService[],
  podLogs: {} as Record<string, string[]>,
  textColors: {} as Record<string, string>,
}

export type StoreState = Store<typeof initialState>;

export const ACTION_FLUX_STATE_RECEIVED = 'FLUX_STATE_RECEIVED';
export const ACTION_FLUX_EVENTS_RECEIVED = 'FLUX_EVENTS_RECEIVED';
export const ACTION_SERVICES_RECEIVED = 'SERVICES_RECEIVED';
export const ACTION_POD_LOGS_RECEIVED = 'POD_LOGS_RECEIVED';
export const ACTION_CLEAR_PODLOGS = 'CLEAR_POD_LOGS';

export const ACTION_DEPLOYMENT_CREATED = "DEPLOYMENT_CREATED";
export const ACTION_DEPLOYMENT_UPDATED = "DEPLOYMENT_UPDATED";
export const ACTION_DEPLOYMENT_DELETED = "DEPLOYMENT_DELETED";

export const ACTION_POD_CREATED = "POD_CREATED";
export const ACTION_POD_UPDATED = "POD_UPDATED";
export const ACTION_POD_DELETED = "POD_DELETED";

export const ACTION_SERVICE_CREATED = "SERVICE_CREATED";
export const ACTION_SERVICE_UPDATED = "SERVICE_UPDATED";
export const ACTION_SERVICE_DELETED = "SERVICE_DELETED";

export const ACTION_INGRESS_CREATED = "INGRESS_CREATED";
export const ACTION_INGRESS_UPDATED = "INGRESS_UPDATED";
export const ACTION_INGRESS_DELETED = "INGRESS_DELETED";

export function rootReducer(state = initialState, action) {
  switch (action.type) {
    case ACTION_FLUX_STATE_RECEIVED:
      return fluxStateReceived(state, action.payload)
    case ACTION_FLUX_EVENTS_RECEIVED:
      return fluxEventsReceived(state, action.payload)
    case ACTION_SERVICES_RECEIVED:
      return servicesReceived(state, action.payload)
    case ACTION_POD_LOGS_RECEIVED:
      return podLogsReceived(state, action.payload)
    case ACTION_CLEAR_PODLOGS:
      return clearPodLogs(state, action.payload)
    case ACTION_DEPLOYMENT_CREATED:
      return deploymentEventHandlers.deploymentCreated(state, action.payload)
    case ACTION_DEPLOYMENT_UPDATED:
      return deploymentEventHandlers.deploymentUpdated(state, action.payload)
    case ACTION_DEPLOYMENT_DELETED:
      return deploymentEventHandlers.deploymentDeleted(state, action.payload)
    case ACTION_POD_CREATED:
      return podEventHandlers.podCreated(state, action.payload)
    case ACTION_POD_UPDATED:
      return podEventHandlers.podUpdated(state, action.payload)
    case ACTION_POD_DELETED:
      return podEventHandlers.podDeleted(state, action.payload)
    case ACTION_INGRESS_CREATED:
      return ingressEventHandlers.ingressCreated(state, action.payload);
    case ACTION_INGRESS_UPDATED:
      return ingressEventHandlers.ingressUpdated(state, action.payload);
    case ACTION_INGRESS_DELETED:
      return ingressEventHandlers.ingressDeleted(state, action.payload);
    case ACTION_SERVICE_CREATED:
      return serviceEventHandlers.serviceCreated(state, action.payload)
    case ACTION_SERVICE_UPDATED:
      return serviceEventHandlers.serviceUpdated(state, action.payload)
    case ACTION_SERVICE_DELETED:
      return serviceEventHandlers.serviceDeleted(state, action.payload)
    default:
      if (action.type && action.type.startsWith('@@redux/INIT')) { // Ignoring Redux ActionTypes.INIT action
        return state
      }
      console.log('Could not process redux event: ' + JSON.stringify(action));
      return state;
  }
}

function fluxStateReceived(state, payload) {
  state.fluxState = payload
  return state
}

function fluxEventsReceived(state, payload) {
  state.fluxEvents = payload
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
