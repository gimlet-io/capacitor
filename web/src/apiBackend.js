import { Component } from 'react';
import {
  ACTION_FLUX_STATE_RECEIVED,
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
  }

  render() {
    return null;
  }
}
