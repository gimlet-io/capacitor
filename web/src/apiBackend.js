import { Component } from 'react';

export default class APIBackend extends Component {

  componentDidMount() {
    this.props.capacitorClient.getFluxState()
      .then(data => console.log(data), () => {/* Generic error handler deals with it */ });
  }

  render() {
    return null;
  }
}
