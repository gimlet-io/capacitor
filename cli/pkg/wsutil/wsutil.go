package wsutil

import (
	"encoding/json"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gimlet-io/capacitor/pkg/kubernetes"
	"github.com/gorilla/websocket"
)

// WebSocketConnection wraps a WebSocket connection with a mutex to prevent concurrent writes
type WebSocketConnection struct {
	conn  *websocket.Conn
	mutex sync.Mutex
}

func NewWebSocketConnection(conn *websocket.Conn) *WebSocketConnection {
	return &WebSocketConnection{conn: conn}
}

// WriteMessage sends a message to the WebSocket connection in a thread-safe way
func (wsc *WebSocketConnection) WriteMessage(messageType int, data []byte) error {
	wsc.mutex.Lock()
	defer wsc.mutex.Unlock()
	return wsc.conn.WriteMessage(messageType, data)
}

// WriteControl sends a control message to the WebSocket connection in a thread-safe way
func (wsc *WebSocketConnection) WriteControl(messageType int, data []byte, deadline time.Time) error {
	wsc.mutex.Lock()
	defer wsc.mutex.Unlock()
	return wsc.conn.WriteControl(messageType, data, deadline)
}

// Close closes the WebSocket connection
func (wsc *WebSocketConnection) Close() error {
	wsc.mutex.Lock()
	defer wsc.mutex.Unlock()
	return wsc.conn.Close()
}

// Counters holds per-connection counters
type Counters struct {
	objects      int64
	managedBytes int64
	bytesSent    int64
}

func (c *Counters) AddObjects(n int64)      { atomic.AddInt64(&c.objects, n) }
func (c *Counters) AddManagedBytes(n int64) { atomic.AddInt64(&c.managedBytes, n) }
func (c *Counters) AddBytesSent(n int64)    { atomic.AddInt64(&c.bytesSent, n) }
func (c *Counters) Snapshot() (objects, bytes int64) {
	return atomic.LoadInt64(&c.objects), atomic.LoadInt64(&c.bytesSent)
}

// ParseProjectionFields extracts fields from params["fields"] supporting JSON array or comma-separated list
func ParseProjectionFields(params map[string]string) []string {
	if params == nil {
		return nil
	}
	raw, ok := params["fields"]
	if !ok || strings.TrimSpace(raw) == "" {
		return nil
	}
	var arr []string
	if err := json.Unmarshal([]byte(raw), &arr); err == nil {
		out := make([]string, 0, len(arr))
		for _, p := range arr {
			p = strings.TrimSpace(p)
			if p != "" {
				out = append(out, p)
			}
		}
		return out
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// TransformWatchEvent strips managedFields and applies projection, returning a shallow-copied event
// and the number of removed bytes from managedFields (best-effort)
func TransformWatchEvent(ev *kubernetes.WatchEvent, fields []string) (*kubernetes.WatchEvent, int) {
	if ev == nil {
		return nil, 0
	}
	out := *ev // shallow copy
	removed := 0
	if len(out.Object) > 0 {
		stripped, rm := StripManagedFieldsCounted(out.Object)
		removed = rm
		if len(fields) > 0 {
			stripped = ProjectObjectByFields(stripped, fields)
		}
		out.Object = stripped
	}
	return &out, removed
}

// StripManagedFieldsCounted removes metadata.managedFields and returns the new bytes and removed count
func StripManagedFieldsCounted(raw json.RawMessage) (json.RawMessage, int) {
	if len(raw) == 0 {
		return raw, 0
	}
	var v interface{}
	if err := json.Unmarshal(raw, &v); err != nil {
		return raw, 0
	}
	before, _ := json.Marshal(v)
	removeManagedFieldsFromAny(&v)
	after, err := json.Marshal(v)
	if err != nil {
		return raw, 0
	}
	removed := len(before) - len(after)
	if removed < 0 {
		removed = 0
	}
	return json.RawMessage(after), removed
}

func removeManagedFieldsFromAny(v *interface{}) {
	switch x := (*v).(type) {
	case map[string]interface{}:
		if md, ok := x["metadata"].(map[string]interface{}); ok {
			delete(md, "managedFields")
		}
		for k := range x {
			vv := x[k]
			removeManagedFieldsFromAny(&vv)
			x[k] = vv
		}
	case []interface{}:
		for i := range x {
			vv := x[i]
			removeManagedFieldsFromAny(&vv)
			x[i] = vv
		}
	}
}

// ProjectObjectByFields reduces the JSON to only the requested dot-path fields with minimal identity included
func ProjectObjectByFields(raw json.RawMessage, fields []string) json.RawMessage {
	if len(raw) == 0 || len(fields) == 0 {
		return raw
	}
	var src interface{}
	if err := json.Unmarshal(raw, &src); err != nil {
		return raw
	}
	dst := make(map[string]interface{})

	addPath := func(path string) {
		parts := strings.Split(path, ".")
		var copyValue func(cur interface{}, idx int) interface{}
		copyValue = func(cur interface{}, idx int) interface{} {
			if idx >= len(parts) {
				return cur
			}
			key := parts[idx]
			if m, ok := cur.(map[string]interface{}); ok {
				if key == "*" {
					return nil
				}
				child, ok := m[key]
				if !ok {
					return nil
				}
				next := copyValue(child, idx+1)
				if next == nil {
					return nil
				}
				return map[string]interface{}{key: next}
			}
			if arr, ok := cur.([]interface{}); ok {
				if key == "*" || strings.HasPrefix(key, "[*]") {
					nextIdx := idx + 1
					outArr := make([]interface{}, 0, len(arr))
					for _, el := range arr {
						next := copyValue(el, nextIdx)
						if next != nil {
							outArr = append(outArr, next)
						}
					}
					return outArr
				}
			}
			return nil
		}

		merged := copyValue(src, 0)
		var merge func(dst map[string]interface{}, src interface{})
		merge = func(dst map[string]interface{}, src interface{}) {
			if srcMap, ok := src.(map[string]interface{}); ok {
				for k, v := range srcMap {
					if v == nil {
						continue
					}
					if existing, ok := dst[k]; ok {
						if em, ok := existing.(map[string]interface{}); ok {
							if vm, ok := v.(map[string]interface{}); ok {
								merge(em, vm)
								continue
							}
						}
						if ea, ok := existing.([]interface{}); ok {
							if va, ok := v.([]interface{}); ok {
								maxLen := len(ea)
								if len(va) > maxLen {
									maxLen = len(va)
								}
								out := make([]interface{}, 0, maxLen)
								for i := 0; i < maxLen; i++ {
									var left, right interface{}
									if i < len(ea) {
										left = ea[i]
									}
									if i < len(va) {
										right = va[i]
									}
									if lm, ok := left.(map[string]interface{}); ok {
										if rm, ok := right.(map[string]interface{}); ok {
											mergedEl := make(map[string]interface{})
											for kk, vv := range lm {
												mergedEl[kk] = vv
											}
											merge(mergedEl, rm)
											out = append(out, mergedEl)
											continue
										}
									}
									if right != nil {
										out = append(out, right)
									} else {
										out = append(out, left)
									}
								}
								dst[k] = out
								continue
							}
						}
					}
					dst[k] = v
				}
			}
		}
		if merged != nil {
			merge(dst, merged)
		}
	}

	// Minimal identity
	addPath("apiVersion")
	addPath("kind")
	addPath("metadata.name")
	addPath("metadata.namespace")
	addPath("metadata.labels")
	addPath("metadata.creationTimestamp")
	addPath("metadata.deletionTimestamp")
	addPath("metadata.resourceVersion")

	for _, p := range fields {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		addPath(p)
	}

	b, err := json.Marshal(dst)
	if err != nil {
		return raw
	}
	return json.RawMessage(b)
}

// StatsEvent builds a kubernetes.WatchEvent with Type STATS and payload of counters snapshot
func StatsEvent(c *Counters) *kubernetes.WatchEvent {
	var objs, sent int64
	if c != nil {
		objs, sent = c.Snapshot()
	}
	payload := map[string]interface{}{
		"objects":         objs,
		"bytesSent":       sent,
		"intervalSeconds": 1,
	}
	data, _ := json.Marshal(payload)
	return &kubernetes.WatchEvent{Type: "STATS", Object: json.RawMessage(data)}
}

// MarshalAndWrite marshals v to JSON, increments bytesSent, and writes to WebSocket as text
func MarshalAndWrite(ws *WebSocketConnection, v interface{}, counters *Counters) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	if counters != nil {
		counters.AddBytesSent(int64(len(b)))
	}
	return ws.WriteMessage(websocket.TextMessage, b)
}
