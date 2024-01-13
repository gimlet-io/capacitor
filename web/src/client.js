import axios from 'axios';

export default class CapacitorClient {
  constructor(onError) {
    this.onError = onError
  }

  URL = () => this.url;

  getFluxState = () => this.get('/api/fluxState');

  getServices = () => this.get('/api/services');

  describeConfigmap = (namespace, name) => this.get(`/api/describeConfigmap?namespace=${namespace}&name=${name}`);

  describeSecret = (namespace, name) => this.get(`/api/describeSecret?namespace=${namespace}&name=${name}`);

  describeDeployment = (namespace, name) => this.get(`/api/describeDeployment?namespace=${namespace}&name=${name}`);

  podLogsRequest = (namespace, svc) => this.get(`/api/logs?namespace=${namespace}&serviceName=${svc}`);

  stopPodLogsRequest = (namespace, svc) => this.get(`/api/stopLogs?namespace=${namespace}&serviceName=${svc}`);

  get = async (path) => {
    try {
      const { data } = await axios.get(path, {
        credentials: 'include'
      });
      return data;
    } catch (error) {
      this.onError(error.response);
      throw error.response;
    }
  }

  post = async (path, body) => {
    try {
      const { data } = await axios
        .post(path, body, {
          credentials: 'include',
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        });
      return data;
    } catch (error) {
      this.onError(error.response);
      throw error.response;
    }
  }

}
