import axios from 'axios';

export default class CapacitorClient {
  constructor(onError) {
    this.onError = onError
  }

  URL = () => this.url;

  getFluxState = () => this.get('/api/fluxState');

  getFluxEvents = () => this.get('/api/fluxEvents');

  getServices = () => this.get('/api/services');

  describeConfigmap = (namespace, name) => this.get(`/api/describeConfigmap?namespace=${namespace}&name=${name}`);

  describeSecret = (namespace, name) => this.get(`/api/describeSecret?namespace=${namespace}&name=${name}`);

  describeDeployment = (namespace, name) => this.get(`/api/describeDeployment?namespace=${namespace}&name=${name}`);

  describePod = (namespace, name) => this.get(`/api/describePod?namespace=${namespace}&name=${name}`);

  podLogsRequest = (namespace, deployment) => this.get(`/api/logs?namespace=${namespace}&deploymentName=${deployment}`);

  stopPodLogsRequest = (namespace, deployment) => this.get(`/api/stopLogs?namespace=${namespace}&deploymentName=${deployment}`);

  suspend = (resource, namespace, name) => this.post(`/api/suspend?resource=${resource}&namespace=${namespace}&name=${name}`);

  resume = (resource, namespace, name) => this.post(`/api/resume?resource=${resource}&namespace=${namespace}&name=${name}`);

  reconcile = (resource, namespace, name) => this.post(`/api/reconcile?resource=${resource}&namespace=${namespace}&name=${name}`);

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
