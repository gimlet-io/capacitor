export const initialState = {
  fluxState: {}
}

export const ACTION_FLUX_STATE_RECEIVED = 'FLUX_STATE_RECEIVED';

export function rootReducer(state = initialState, action) {
  switch (action.type) {
    case ACTION_FLUX_STATE_RECEIVED:
      return fluxStateReceived(state, action.payload)
    default:
      console.log('Could not process redux event: ' + JSON.stringify(action));
      return state;
  }
}

function fluxStateReceived(state, payload) {
  state.fluxState = payload
  return state
}
