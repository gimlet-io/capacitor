package streaming

const (
	FLUX_STATE_RECEIVED  string = "FLUX_STATE_RECEIVED"
	FLUX_EVENTS_RECEIVED string = "FLUX_EVENTS_RECEIVED"
	POD_LOGS_RECEIVED    string = "POD_LOGS_RECEIVED"

	DEPLOYMENT_CREATED string = "DEPLOYMENT_CREATED"
	DEPLOYMENT_UPDATED string = "DEPLOYMENT_UPDATED"
	DEPLOYMENT_DELETED string = "DEPLOYMENT_DELETED"

	POD_CREATED string = "POD_CREATED"
	POD_UPDATED string = "POD_UPDATED"
	POD_DELETED string = "POD_DELETED"

	SERVICE_CREATED string = "SERVICE_CREATED"
	SERVICE_UPDATED string = "SERVICE_UPDATED"
	SERVICE_DELETED string = "SERVICE_DELETED"

	INGRESS_CREATED string = "INGRESS_CREATED"
	INGRESS_UPDATED string = "INGRESS_UPDATED"
	INGRESS_DELETED string = "INGRESS_DELETED"
)

type Envelope struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type PodLogMessage struct {
	Timestamp  string `json:"timestamp"`
	Container  string `json:"container"`
	Message    string `json:"message"`
	Pod        string `json:"pod"`
	Deployment string `json:"deployment"`
}
