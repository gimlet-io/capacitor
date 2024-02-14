import { Component } from 'react';
import {
  ACTION_FLUX_STATE_RECEIVED,
  ACTION_FLUX_EVENTS_RECEIVED,
  ACTION_SERVICES_RECEIVED,
} from "./redux";

export default class APIBackend extends Component {

  componentDidMount() {
    this.props.capacitorClient.getFluxState()
      .then(
        data => this.props.store.dispatch(
          {type: ACTION_FLUX_STATE_RECEIVED, payload: data}
        ),
        () => {/* Generic error handler deals with it */ }
      );
    this.props.capacitorClient.getServices()
      .then(
        data => this.props.store.dispatch(
          {type: ACTION_SERVICES_RECEIVED, payload: data}
        ),
        () => {/* Generic error handler deals with it */ }
      );
    this.props.capacitorClient.getFluxEvents()
      .then(
        data => this.props.store.dispatch(
          {type: ACTION_FLUX_EVENTS_RECEIVED, payload: data}
        ),
        () => {/* Generic error handler deals with it */ }
      );
  }

  render() {
    return null;
  }
}
