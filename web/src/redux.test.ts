import {
  ACTION_FLUX_STATE_RECEIVED,
  ACTION_SERVICE_CREATED,
  ACTION_SERVICE_UPDATED,
  ACTION_SERVICE_DELETED,
  ACTION_DEPLOYMENT_CREATED,
  ACTION_DEPLOYMENT_UPDATED,
  ACTION_DEPLOYMENT_DELETED,
  ACTION_POD_CREATED,
  ACTION_POD_UPDATED,
  ACTION_POD_DELETED,
  ACTION_INGRESS_CREATED,
  ACTION_INGRESS_UPDATED,
  ACTION_INGRESS_DELETED,
  initialState,
  rootReducer
} from './redux';
import { test, expect } from "@jest/globals";


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

test('should create service', () => {
  const serviceCreated = {
    type: ACTION_SERVICE_CREATED,
    payload: {
      metadata: {
        namespace: "default",
        name: "svc"
      }
    }
  };

  let reduced = rootReducer(initialState, serviceCreated);

  expect(reduced.services.length).toEqual(1);
});

test('should update service', () => {
  const state = deepCopy(initialState)
  state.services = [
      {
        svc: {
          metadata: {
            namespace: "default",
            name: "svc"
          },
          spec: {
            ports: [{ port: 3000 }],
          },
        }
      },
    ];

  const serviceUpdated = {
    type: ACTION_SERVICE_UPDATED,
    payload: {
      metadata: {
        namespace: "default",
        name: "svc"
      },
      spec: {
        ports: [{ port: 4000 }],
      },
    }
  };

  let reduced = rootReducer(state, serviceUpdated);

  expect(reduced.services[0].svc.spec.ports[0].port).toEqual(4000);
});

test('should delete service', () => {
  const state = deepCopy(initialState)
  state.services = [
      {
        svc: {
          metadata: {
            namespace: "default",
            name: "svc"
          },
          spec: {
            ports: [{ port: 3000 }],
          },
        }
      },
    ];

  const serviceDeleted = {
    type: ACTION_SERVICE_DELETED,
    payload: "default/svc"
  };

  let reduced = rootReducer(state, serviceDeleted);

  expect(reduced.services.length).toEqual(0);
});

test('should create deployment', () => {
  const state = deepCopy(initialState)
  state.services = [
      {
        svc: {
          spec: {
            selector: {
              "app.kubernetes.io/instance": "getting-started-app",
            }
          },
        }
      },
    ];

  const deploymentCreated = {
    type: ACTION_DEPLOYMENT_CREATED,
    payload: {
      metadata: {
        namespace: "default",
        name: "deployment"
      },
      spec: {
        selector: {
          matchLabels: {
            "app.kubernetes.io/instance": "getting-started-app",
          }
        },
      }
    }
  };

  let reduced = rootReducer(state, deploymentCreated);
  expect(reduced.services[0].deployment.name).not.toEqual("deployment");
});

test('should update deployment', () => {
  const state = deepCopy(initialState)
  state.services = [
      {
        svc: {
          spec: {
            selector: {
              "app.kubernetes.io/instance": "getting-started-app",
            }
          },
        },
        deployment: {
          metadata: {
            namespace: "default",
            name: "deployment"
          },
          spec: {
            replicas: 1,
            selector: {
              matchLabels: {
                "app.kubernetes.io/instance": "getting-started-app",
              }
            },
          }
        }
      },
    ];

  const deploymentUpdated = {
    type: ACTION_DEPLOYMENT_UPDATED,
    payload: {
      metadata: {
        namespace: "default",
        name: "deployment"
      },
      spec: {
        replicas: 2,
        selector: {
          matchLabels: {
            "app.kubernetes.io/instance": "getting-started-app",
          }
        },
      }
    }
  };

  let reduced = rootReducer(state, deploymentUpdated);
  expect(reduced.services[0].deployment.spec.replicas).toEqual(2);
});


test('should delete deployment', () => {
  const state = deepCopy(initialState)
  state.services = [
      {
        svc: {
          spec: {
            selector: {
              "app.kubernetes.io/instance": "getting-started-app",
            }
          },
        },
        deployment: {
          metadata: {
            namespace: "default",
            name: "deployment"
          },
          spec: {
            replicas: 1,
            selector: {
              matchLabels: {
                "app.kubernetes.io/instance": "getting-started-app",
              }
            },
          }
        }
      },
    ];

  const deploymentDeleted = {
    type: ACTION_DEPLOYMENT_DELETED,
    payload: "default/deployment"
  };

  let reduced = rootReducer(state, deploymentDeleted);
  expect(reduced.services[0].deployment).toEqual(undefined);
});

test('should create pod', () => {
  const state = deepCopy(initialState)
  state.services = [
      {
        svc: {
          spec: {
            selector: {
              "app.kubernetes.io/instance": "getting-started-app",
            }
          },
        }
      },
    ];

  const podCreated = {
    type: ACTION_POD_CREATED,
    payload: {
      metadata: {
        namespace: "default",
        name: "pod",
        labels: {
          "app.kubernetes.io/instance": "getting-started-app",
        }
      }
    }
  };

  let reduced = rootReducer(state, podCreated);
  expect(reduced.services[0].pods.length).toEqual(1);
});

test('should update pod', () => {
  const state = deepCopy(initialState)
  state.services = [
      {
        svc: {
          spec: {
            selector: {
              "app.kubernetes.io/instance": "getting-started-app",
            }
          },
        },
        pods: [
          {
            metadata: {
              namespace: "default",
              name: "pod",
              labels: {
                "app.kubernetes.io/instance": "getting-started-app",
              }
            },
            status: {
              conditions: [{ type: "Available", status: "False" }],
            }
          }
        ],
      },
    ];

  const podUpdated = {
    type: ACTION_POD_UPDATED,
    payload: {
      metadata: {
        namespace: "default",
        name: "pod",
        labels: {
          "app.kubernetes.io/instance": "getting-started-app",
        }
      },
      status: {
        conditions: [{ type: "Available", status: "True" }],
      }
    }
  };

  let reduced = rootReducer(state, podUpdated);
  expect(reduced.services[0].pods[0].status.conditions[0].status).toEqual("True");
});

test('should delete pod', () => {
  const state = deepCopy(initialState)
  state.services = [
      {
        pods: [
          {
            metadata: {
              namespace: "default",
              name: "pod",
            },
          }
        ],
      },
    ];

  const podUpdated = {
    type: ACTION_POD_DELETED,
    payload: "default/pod"
  };

  let reduced = rootReducer(state, podUpdated);
  expect(reduced.services[0].pods.length).toEqual(0);
});

test('should create ingress', () => {
  const state = deepCopy(initialState)
  state.services = [
      {
        svc: {
          metadata: {
            namespace: "default",
            name: "service"
          }
        }
      },
    ];

  const ingressCreated = {
    type: ACTION_INGRESS_CREATED,
    payload: {
      spec: {
        rules: [
          {
            http: {
              paths: [
                {
                  backend: {
                    service: {
                      name: "service"
                    }
                  }
                }
              ]
            }
          }
        ],
      }
    }
  };

  let reduced = rootReducer(state, ingressCreated);
  expect(reduced.services[0].ingresses.length).toEqual(1);
});

test('should update ingress', () => {
  const state = deepCopy(initialState)
  state.services = [
      {
        svc: {
          metadata: {
            namespace: "default",
            name: "service"
          }
        },
        ingresses: [
          {
            metadata: {
              namespace: "default",
              name: "ingress",
            },
            spec: {
              rules: [
                {
                  http: {
                    paths: [
                      {
                        backend: {
                          service: {
                            name: "service",
                            port: {
                              number: 8000
                            }
                          }
                        }
                      }
                    ]
                  }
                }
              ],
            }
          }
        ],
      },
    ];

  const ingressUpdated = {
    type: ACTION_INGRESS_UPDATED,
    payload: {
      metadata: {
        namespace: "default",
        name: "ingress",
      },
      spec: {
        rules: [
          {
            http: {
              paths: [
                {
                  backend: {
                    service: {
                      name: "service",
                      port: {
                        number: 9000
                      }
                    }
                  }
                }
              ]
            }
          }
        ],
      }
    }
  };

  let reduced = rootReducer(state, ingressUpdated);
  expect(reduced.services[0].ingresses[0].spec.rules[0].http.paths[0].backend.service.port.number).toEqual(9000);
});

test('should delete ingress', () => {
  const state = deepCopy(initialState)
  state.services = [
      {
        ingresses: [
          {
            metadata: {
              namespace: "default",
              name: "ingress",
            },
          }
        ],
      },
    ];

  const ingressDeleted = {
    type: ACTION_INGRESS_DELETED,
    payload: "default/ingress"
  };

  let reduced = rootReducer(state, ingressDeleted);
  expect(reduced.services[0].ingresses.length).toEqual(0);
});
