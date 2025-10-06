package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gimlet-io/capacitor/pkg/helm"
	"github.com/gimlet-io/capacitor/pkg/kubernetes"
	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

// ClientMessage represents a message from the client
type ClientMessage struct {
	ID     string            `json:"id"`
	Action string            `json:"action"` // subscribe or unsubscribe
	Path   string            `json:"path"`
	Params map[string]string `json:"params,omitempty"`
}

// ServerMessage represents a message from the server
type ServerMessage struct {
	ID    string                 `json:"id"`
	Type  string                 `json:"type"` // data, error, status
	Path  string                 `json:"path"`
	Data  *kubernetes.WatchEvent `json:"data,omitempty"`
	Error string                 `json:"error,omitempty"`
}

// WebSocketConnection wraps a WebSocket connection with a mutex to prevent concurrent writes
type WebSocketConnection struct {
	conn  *websocket.Conn
	mutex sync.Mutex
}

type wsCounters struct {
	objects      int64
	managedBytes int64
	bytesSent    int64
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

// WebSocketHandler handles WebSocket connections
type WebSocketHandler struct {
	upgrader   websocket.Upgrader
	k8sClient  *kubernetes.Client
	helmClient *helm.Client

	// Maps connection to a map of resource paths to contexts
	// This allows us to cancel watches when clients unsubscribe
	watchContexts sync.Map
}

// NewWebSocketHandler creates a new WebSocketHandler
func NewWebSocketHandler(k8sClient *kubernetes.Client, helmClient *helm.Client) *WebSocketHandler {
	return &WebSocketHandler{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins
			},
		},
		k8sClient:  k8sClient,
		helmClient: helmClient,
	}
}

// UpdateClients updates the Kubernetes and Helm clients when the context changes
func (h *WebSocketHandler) UpdateClients(k8sClient *kubernetes.Client, helmClient *helm.Client) {
	h.k8sClient = k8sClient
	h.helmClient = helmClient
}

// HandleWebSocket handles a WebSocket connection
func (h *WebSocketHandler) HandleWebSocket(c echo.Context) error {
	// Upgrade the HTTP connection to a WebSocket connection
	conn, err := h.upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return fmt.Errorf("error upgrading to websocket: %w", err)
	}

	// Create our thread-safe wrapper
	ws := &WebSocketConnection{conn: conn}
	defer ws.Close()

	// Per-connection counters
	var counters wsCounters

	// Create connection context that can be cancelled when the connection closes
	connCtx, connCancel := context.WithCancel(context.Background())
	defer connCancel()

	// Create a map to store watch contexts for this connection
	watchContextsForConn := make(map[string]context.CancelFunc)
	h.watchContexts.Store(ws, watchContextsForConn)
	defer h.watchContexts.Delete(ws)

	// Handle ping/pong to keep connection alive
	conn.SetPingHandler(func(string) error {
		return ws.WriteControl(websocket.PongMessage, []byte{}, time.Now().Add(10*time.Second))
	})

	// Send ready message to indicate the server is ready to receive messages
	readyMsg := ServerMessage{
		Type: "ready",
	}
	if data, err := json.Marshal(readyMsg); err == nil {
		ws.WriteMessage(websocket.TextMessage, data)
	}

	// Periodic stats emission
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()
	go func() {
		for {
			select {
			case <-connCtx.Done():
				return
			case <-ticker.C:
				h.sendStatsMessage(ws, &counters)
			}
		}
	}()

	// Handle incoming messages
	for {
		// Read message
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("error reading message: %v", err)
			}
			break
		}

		// Parse message
		var clientMsg ClientMessage
		if err := json.Unmarshal(message, &clientMsg); err != nil {
			log.Printf("error parsing message: %v", err)
			h.sendErrorMessage(ws, "", "", "invalid message format")
			continue
		}

		// Handle message based on action
		switch clientMsg.Action {
		case "subscribe":
			h.handleSubscribe(connCtx, ws, &clientMsg, watchContextsForConn, &counters)
		case "unsubscribe":
			h.handleUnsubscribe(ws, &clientMsg, watchContextsForConn)
		default:
			h.sendErrorMessage(ws, clientMsg.ID, clientMsg.Path, "unknown action")
		}
	}

	return nil
}

// handleSubscribe handles a subscribe message
func (h *WebSocketHandler) handleSubscribe(
	connCtx context.Context,
	ws *WebSocketConnection,
	msg *ClientMessage,
	watchContextsForConn map[string]context.CancelFunc,
	counters *wsCounters,
) {
	// Log the subscription request
	log.Printf("Subscribe request for path: %s", msg.Path)

	// Check if already subscribed
	if _, exists := watchContextsForConn[msg.Path]; exists {
		h.sendStatusMessage(ws, msg.ID, msg.Path, "subscribed")
		return
	}

	// Create context for this watch that can be cancelled
	watchCtx, watchCancel := context.WithCancel(connCtx)
	watchContextsForConn[msg.Path] = watchCancel

	// Check if this is a Helm release path
	if strings.Contains(msg.Path, "/api/helm/releases") {
		h.handleHelmReleaseWatch(watchCtx, ws, msg)
		h.sendStatusMessage(ws, msg.ID, msg.Path, "subscribed")
		log.Printf("Successfully subscribed to Helm releases path: %s", msg.Path)
		return
	}

	// Check if this is a Helm history path
	if strings.Contains(msg.Path, "/api/helm/history") {
		h.handleHelmHistoryWatch(watchCtx, ws, msg)
		h.sendStatusMessage(ws, msg.ID, msg.Path, "subscribed")
		log.Printf("Successfully subscribed to Helm history path: %s", msg.Path)
		return
	}

	// Create channel for events
	eventsChan := make(chan *kubernetes.WatchEvent, 100)

	// Start watching in a goroutine
	go func() {
		defer close(eventsChan)
		defer watchCancel()

		if err := h.k8sClient.WatchPath(watchCtx, msg.Path, eventsChan); err != nil {
			if watchCtx.Err() == context.Canceled {
				log.Printf("Watch canceled for path: %s", msg.Path)
				return // Context was cancelled, expected
			}
			log.Printf("Error watching resource: %v", err)
			h.sendErrorMessage(ws, msg.ID, msg.Path, fmt.Sprintf("error watching resource: %v", err))
			delete(watchContextsForConn, msg.Path)
		}
	}()

	// Start sending events to client in a goroutine
	go func() {
		for {
			select {
			case event, ok := <-eventsChan:
				if !ok {
					log.Printf("Event channel closed for path: %s", msg.Path)
					return
				}
				// Update counters and send
				h.sendDataMessageWithCounters(ws, msg.ID, msg.Path, event, counters)
			case <-watchCtx.Done():
				log.Printf("Watch context done for path: %s", msg.Path)
				return
			}
		}
	}()

	// Send success message for standard K8s resources
	h.sendStatusMessage(ws, msg.ID, msg.Path, "subscribed")
}

// handleUnsubscribe handles an unsubscribe message
func (h *WebSocketHandler) handleUnsubscribe(
	ws *WebSocketConnection,
	msg *ClientMessage,
	watchContextsForConn map[string]context.CancelFunc,
) {
	// Check if subscribed
	watchCancel, exists := watchContextsForConn[msg.Path]
	if !exists {
		h.sendErrorMessage(ws, msg.ID, msg.Path, "not subscribed to this path")
		return
	}

	// Cancel the watch
	watchCancel()
	delete(watchContextsForConn, msg.Path)

	// Send success message
	h.sendStatusMessage(ws, msg.ID, msg.Path, "unsubscribed")
}

// sendDataMessage sends a data message to the client
func (h *WebSocketHandler) sendDataMessage(ws *WebSocketConnection, id, path string, data *kubernetes.WatchEvent) {
	// Create a shallow copy to avoid mutating the original event
	var event kubernetes.WatchEvent
	if data != nil {
		event = *data
		// Remove metadata.managedFields to avoid streaming large, unnecessary payloads
		if len(event.Object) > 0 {
			event.Object = stripManagedFields(event.Object)
		}
	}

	msg := ServerMessage{
		ID:   id,
		Type: "data",
		Path: path,
		Data: &event,
	}
	h.sendMessage(ws, &msg)
}

// sendDataMessageWithCounters is like sendDataMessage but updates counters
func (h *WebSocketHandler) sendDataMessageWithCounters(ws *WebSocketConnection, id, path string, data *kubernetes.WatchEvent, counters *wsCounters) {
	var event kubernetes.WatchEvent
	if data != nil {
		event = *data
		if len(event.Object) > 0 {
			stripped, removed := stripManagedFieldsCounted(event.Object)
			event.Object = stripped
			atomic.AddInt64(&counters.objects, 1)
			atomic.AddInt64(&counters.managedBytes, int64(removed))
		} else {
			atomic.AddInt64(&counters.objects, 1)
		}
	}

	msg := ServerMessage{
		ID:   id,
		Type: "data",
		Path: path,
		Data: &event,
	}
	// Marshal here to count exact bytes
	payload, err := json.Marshal(msg)
	if err != nil {
		log.Printf("error marshaling message: %v", err)
		return
	}
	atomic.AddInt64(&counters.bytesSent, int64(len(payload)))
	if err := ws.WriteMessage(websocket.TextMessage, payload); err != nil {
		log.Printf("error writing message: %v", err)
	}
}

// sendErrorMessage sends an error message to the client
func (h *WebSocketHandler) sendErrorMessage(ws *WebSocketConnection, id, path, errorMsg string) {
	msg := ServerMessage{
		ID:    id,
		Type:  "error",
		Path:  path,
		Error: errorMsg,
	}
	h.sendMessage(ws, &msg)
}

// sendStatusMessage sends a status message to the client
func (h *WebSocketHandler) sendStatusMessage(ws *WebSocketConnection, id, path, status string) {
	msg := ServerMessage{
		ID:   id,
		Type: "status",
		Path: path,
		Data: &kubernetes.WatchEvent{
			Type:   status,
			Object: nil,
		},
	}
	h.sendMessage(ws, &msg)
}

// sendStatsMessage emits periodic stats for the connection
func (h *WebSocketHandler) sendStatsMessage(ws *WebSocketConnection, counters *wsCounters) {
	objs := atomic.LoadInt64(&counters.objects)
	sent := atomic.LoadInt64(&counters.bytesSent)
	payload := map[string]interface{}{
		"objects":         objs,
		"bytesSent":       sent,
		"intervalSeconds": 1,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	msg := ServerMessage{
		Type: "stats",
		Path: "",
		Data: &kubernetes.WatchEvent{
			Type:   "STATS",
			Object: json.RawMessage(data),
		},
	}
	h.sendMessage(ws, &msg)
}

// sendMessage sends a message to the client
func (h *WebSocketHandler) sendMessage(ws *WebSocketConnection, msg *ServerMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("error marshaling message: %v", err)
		return
	}

	if err := ws.WriteMessage(websocket.TextMessage, data); err != nil {
		log.Printf("error writing message: %v", err)
	}
}

// stripManagedFields removes metadata.managedFields from a Kubernetes object represented as json.RawMessage.
// It returns the original bytes if unmarshaling or marshaling fails.
func stripManagedFields(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return raw
	}
	var v interface{}
	if err := json.Unmarshal(raw, &v); err != nil {
		return raw
	}
	removeManagedFieldsFromAny(&v)
	b, err := json.Marshal(v)
	if err != nil {
		return raw
	}
	return json.RawMessage(b)
}

// stripManagedFieldsCounted removes managedFields and returns removed byte count
func stripManagedFieldsCounted(raw json.RawMessage) (json.RawMessage, int) {
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

// handleHelmReleaseWatch handles watching Helm releases with polling
func (h *WebSocketHandler) handleHelmReleaseWatch(ctx context.Context, ws *WebSocketConnection, msg *ClientMessage) {
	// Extract namespace from the path if present
	// Path format: "/api/helm/releases" (all namespaces) or "/api/helm/releases/namespaces/{namespace}"
	namespace := ""
	pathParts := strings.Split(msg.Path, "/")

	// Look for standard K8s path pattern: /api/helm/releases/namespaces/{namespace}
	if len(pathParts) >= 6 && pathParts[4] == "namespaces" {
		namespace = pathParts[5]
		log.Printf("Extracted namespace from path: %s", namespace)
	}

	// Store previous releases to detect changes
	var previousReleases []*helm.Release

	// Start polling in a goroutine
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		// Get initial state
		startTime := time.Now()
		releases, err := h.helmClient.ListReleases(ctx, namespace)
		if err != nil {
			log.Printf("Error listing Helm releases: %v", err)
			h.sendErrorMessage(ws, msg.ID, msg.Path, fmt.Sprintf("Failed to list Helm releases: %v", err))
			return
		}

		// Send initial data
		h.compareAndSendHelmChanges(ws, msg, []*helm.Release{}, releases)
		previousReleases = releases
		elapsed := time.Since(startTime)
		log.Printf("Helm releases loading time: %v for namespace: %s", elapsed, namespace)
		// Poll for changes
		for {
			select {
			case <-ctx.Done():
				log.Printf("Context cancelled for Helm releases watch: %s", msg.Path)
				return
			case <-ticker.C:
				pollStartTime := time.Now()
				currentReleases, err := h.helmClient.ListReleases(ctx, namespace)
				if err != nil {
					log.Printf("Error listing Helm releases: %v", err)
					h.sendErrorMessage(ws, msg.ID, msg.Path, fmt.Sprintf("Failed to list Helm releases: %v", err))
					continue
				}

				h.compareAndSendHelmChanges(ws, msg, previousReleases, currentReleases)
				previousReleases = currentReleases
				pollElapsed := time.Since(pollStartTime)
				log.Printf("Helm releases poll time: %v for namespace: %s", pollElapsed, namespace)
			}
		}
	}()
}

// handleHelmHistoryWatch handles watching Helm release history with polling
func (h *WebSocketHandler) handleHelmHistoryWatch(ctx context.Context, ws *WebSocketConnection, msg *ClientMessage) {
	// Extract namespace and release name from the path
	// Path format: "/api/helm/history/{namespace}/{name}"
	pathParts := strings.Split(msg.Path, "/")

	if len(pathParts) < 5 {
		h.sendErrorMessage(ws, msg.ID, msg.Path, "Invalid path format for Helm history watch")
		return
	}

	namespace := pathParts[4]
	releaseName := pathParts[5]

	log.Printf("Watching Helm history for release %s in namespace %s", releaseName, namespace)

	// Store previous history to detect changes
	var previousHistory []helm.HistoryRelease

	// Start polling in a goroutine
	go func() {
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		// Get initial state
		history, err := h.helmClient.GetHistory(ctx, releaseName, namespace)

		if err != nil {
			log.Printf("Error getting Helm release history: %v", err)
			h.sendErrorMessage(ws, msg.ID, msg.Path, fmt.Sprintf("Failed to get Helm release history: %v", err))
			return
		}

		// Send initial data
		h.sendHelmHistory(ws, msg.ID, msg.Path, history)
		previousHistory = history

		// Poll for changes
		for {
			select {
			case <-ctx.Done():
				log.Printf("Context cancelled for Helm history watch: %s", msg.Path)
				return
			case <-ticker.C:
				currentHistory, err := h.helmClient.GetHistory(ctx, releaseName, namespace)
				if err != nil {
					log.Printf("Error getting Helm release history: %v", err)
					h.sendErrorMessage(ws, msg.ID, msg.Path, fmt.Sprintf("Failed to get Helm release history: %v", err))
					continue
				}

				// Check if anything has changed
				if !h.helmHistoryEqual(previousHistory, currentHistory) {
					h.sendHelmHistory(ws, msg.ID, msg.Path, currentHistory)
					previousHistory = currentHistory
				}
			}
		}
	}()
}

// helmHistoryEqual checks if two history lists are equal
func (h *WebSocketHandler) helmHistoryEqual(prev, curr []helm.HistoryRelease) bool {
	if len(prev) != len(curr) {
		return false
	}

	// Create maps for easier comparison
	prevMap := make(map[int]helm.HistoryRelease)
	for _, rev := range prev {
		prevMap[rev.Revision] = rev
	}

	for _, rev := range curr {
		prevRev, exists := prevMap[rev.Revision]
		if !exists {
			return false
		}

		// Compare relevant fields
		if prevRev.Status != rev.Status ||
			prevRev.Chart != rev.Chart ||
			prevRev.AppVersion != rev.AppVersion ||
			prevRev.Description != rev.Description {
			return false
		}
	}

	return true
}

// sendHelmHistory sends a list of release history items to the client
func (h *WebSocketHandler) sendHelmHistory(ws *WebSocketConnection, id, path string, history []helm.HistoryRelease) {
	// Create a response structure
	response := map[string]interface{}{
		"releases": history,
	}

	// Convert to JSON
	data, err := json.Marshal(response)
	if err != nil {
		log.Printf("Error marshaling Helm history: %v", err)
		h.sendErrorMessage(ws, id, path, fmt.Sprintf("Error marshaling Helm history: %v", err))
		return
	}

	// Send as a data message
	msg := &ServerMessage{
		ID:   id,
		Type: "data",
		Path: path,
		Data: &kubernetes.WatchEvent{
			Type:   "HISTORY_DATA",
			Object: json.RawMessage(data),
		},
	}

	h.sendMessage(ws, msg)
}

// compareAndSendHelmChanges compares release lists and sends appropriate events
func (h *WebSocketHandler) compareAndSendHelmChanges(ws *WebSocketConnection, msg *ClientMessage, previous, current []*helm.Release) {
	// Create maps for easier comparison
	prevMap := make(map[string]*helm.Release)
	for _, rel := range previous {
		key := fmt.Sprintf("%s/%s", rel.Namespace, rel.Name)
		prevMap[key] = rel
	}

	currMap := make(map[string]*helm.Release)
	for _, rel := range current {
		key := fmt.Sprintf("%s/%s", rel.Namespace, rel.Name)
		currMap[key] = rel
	}

	// Check for new or modified releases
	for key, currRel := range currMap {
		if prevRel, exists := prevMap[key]; exists {
			// Check if modified (compare revision and status)
			if prevRel.Revision != currRel.Revision || prevRel.Status != currRel.Status || !prevRel.Updated.Equal(currRel.Updated) {
				event := &kubernetes.WatchEvent{
					Type:   "MODIFIED",
					Object: h.helmReleaseToRawMessage(currRel),
				}
				h.sendDataMessage(ws, msg.ID, msg.Path, event)
			}
		} else {
			// New release
			event := &kubernetes.WatchEvent{
				Type:   "ADDED",
				Object: h.helmReleaseToRawMessage(currRel),
			}
			h.sendDataMessage(ws, msg.ID, msg.Path, event)
		}
	}

	// Check for deleted releases
	for key, prevRel := range prevMap {
		if _, exists := currMap[key]; !exists {
			event := &kubernetes.WatchEvent{
				Type:   "DELETED",
				Object: h.helmReleaseToRawMessage(prevRel),
			}
			h.sendDataMessage(ws, msg.ID, msg.Path, event)
		}
	}
}

// helmReleaseToRawMessage converts a Helm release to json.RawMessage
func (h *WebSocketHandler) helmReleaseToRawMessage(release *helm.Release) json.RawMessage {
	// Convert Helm release to a Kubernetes-like object structure
	obj := map[string]interface{}{
		"apiVersion": "helm.sh/v3",
		"kind":       "Release",
		"metadata": map[string]interface{}{
			"name":              release.Name,
			"namespace":         release.Namespace,
			"creationTimestamp": release.Updated.Format(time.RFC3339),
		},
		"spec": map[string]interface{}{
			"chart":        release.Chart,
			"chartVersion": release.ChartVersion,
			"values":       release.Values,
		},
		"status": map[string]interface{}{
			"status":     release.Status,
			"revision":   release.Revision,
			"appVersion": release.AppVersion,
			"notes":      release.Notes,
		},
	}

	data, err := json.Marshal(obj)
	if err != nil {
		log.Printf("Error marshaling Helm release: %v", err)
		return json.RawMessage("{}")
	}

	return json.RawMessage(data)
}
