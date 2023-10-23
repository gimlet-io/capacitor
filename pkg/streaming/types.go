package streaming

const (
	FLUX_STATE_RECEIVED string = "FLUX_STATE_RECEIVED"
)

type Envelope struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}
