import axios, { AxiosResponse } from 'axios';
import { FluxService } from './types/service';
import { FluxEvent } from './types/fluxEvent';
import { FluxState } from './types/fluxState';

export default class CapacitorClient {

  onError: (response: AxiosResponse) => void;
  constructor(onError) {
    this.onError = onError
  }


  getFluxState = (): Promise<FluxState> => this.get('/api/fluxState');

  getFluxEvents = (): Promise<FluxEvent[]> => this.get('/api/fluxEvents');

  getServices = (): Promise<FluxService[]> => this.get('/api/services');

  describeConfigmap = (namespace, name): Promise<string> => this.get(`/api/describeConfigmap?namespace=${namespace}&name=${name}`);

  describeSecret = (namespace, name): Promise<string> => this.get(`/api/describeSecret?namespace=${namespace}&name=${name}`);

  describeDeployment = (namespace, name): Promise<string> => this.get(`/api/describeDeployment?namespace=${namespace}&name=${name}`);

  describePod = (namespace, name): Promise<string> => this.get(`/api/describePod?namespace=${namespace}&name=${name}`);

  podLogsRequest = (namespace, deployment) => this.get(`/api/logs?namespace=${namespace}&deploymentName=${deployment}`);

  stopPodLogsRequest = (namespace, deployment) => this.get(`/api/stopLogs?namespace=${namespace}&deploymentName=${deployment}`);

  suspend = (resource, namespace, name) => this.post(`/api/suspend?resource=${resource}&namespace=${namespace}&name=${name}`);

  resume = (resource, namespace, name) => this.post(`/api/resume?resource=${resource}&namespace=${namespace}&name=${name}`);

  reconcile = (resource, namespace, name) => this.post(`/api/reconcile?resource=${resource}&namespace=${namespace}&name=${name}`);

  get = async <T = any>(path: string): Promise<T> => {
    try {
      const { data } = await axios.get(path, {
        withCredentials: true
      });
      return data;
    } catch (error) {
      this.onError(error.response);
      throw error.response;
    }
  }

  post = async <T = any>(path: string, body: any = undefined): Promise<T> => {
    try {
      const { data } = await axios
        .post(path, body, {
          withCredentials: true,
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
