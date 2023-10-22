import {
  ACTION_FLUX_STATE_RECEIVED,
  initialState,
  rootReducer
} from './redux';

function deepCopy(toCopy) {
  return JSON.parse(JSON.stringify(toCopy));
}

test('should store flux state', () => {
  const fluxState = {
    type: ACTION_FLUX_STATE_RECEIVED,
    payload: {
      gitRepositories: [{}, {}],
      kustomizations: [],
    }
  };

  let reduced = rootReducer(initialState, fluxState);

  expect(reduced.fluxState.gitRepositories.length).toEqual(2);
});
