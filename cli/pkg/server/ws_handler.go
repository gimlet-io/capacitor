// Copyright 2025 Laszlo Consulting Kft.
// SPDX-License-Identifier: Apache-2.0

package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/gimlet-io/capacitor/pkg/helm"
	"github.com/gimlet-io/capacitor/pkg/kubernetes"
	wsutil "github.com/gimlet-io/capacitor/pkg/wsutil"
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

// watchCfg stores per-watch configuration for a connection
type watchCfg struct {
	cancel context.CancelFunc
	fields []string
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
	ws := wsutil.NewWebSocketConnection(conn)
	defer ws.Close()

	// Per-connection counters
	var counters wsutil.Counters

	// Create connection context that can be cancelled when the connection closes
	connCtx, connCancel := context.WithCancel(context.Background())
	defer connCancel()

	// Create a map to store watch contexts and per-watch config for this connection
	watchContextsForConn := make(map[string]watchCfg)
	h.watchContexts.Store(ws, watchContextsForConn)
	defer h.watchContexts.Delete(ws)
	// Track subscription IDs to composite keys for precise unsubscribe
	watchIdsForConn := make(map[string]string)

	// Handle ping/pong to keep connection alive
	conn.SetPingHandler(func(string) error {
		return ws.WriteControl(websocket.PongMessage, []byte{}, time.Now().Add(10*time.Second))
	})

	// Send ready message to indicate the server is ready to receive messages
	readyMsg := ServerMessage{Type: "ready"}
	_ = wsutil.MarshalAndWrite(ws, &readyMsg, &counters)

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
			h.handleSubscribe(connCtx, ws, &clientMsg, watchContextsForConn, watchIdsForConn, &counters)
		case "unsubscribe":
			h.handleUnsubscribe(ws, &clientMsg, watchContextsForConn, watchIdsForConn)
		default:
			h.sendErrorMessage(ws, clientMsg.ID, clientMsg.Path, "unknown action")
		}
	}

	return nil
}

// handleSubscribe handles a subscribe message
func (h *WebSocketHandler) handleSubscribe(
	connCtx context.Context,
	ws *wsutil.WebSocketConnection,
	msg *ClientMessage,
	watchContextsForConn map[string]watchCfg,
	watchIdsForConn map[string]string,
	counters *wsutil.Counters,
) {
	// Log the subscription request
	log.Printf("Subscribe request for path: %s", msg.Path)

	// Build composite key from path and projection fields (if any)
	projFields := wsutil.ParseProjectionFields(msg.Params)
	key := makeWatchKey(msg.Path, projFields)

	// Check if already subscribed for this exact key
	if _, exists := watchContextsForConn[key]; exists {
		// Register this id to receive fan-out for the existing watch
		if msg.ID != "" {
			watchIdsForConn[msg.ID] = key
		}
		h.sendStatusMessage(ws, msg.ID, msg.Path, "subscribed")
		return
	}

	// Create context for this watch that can be cancelled
	watchCtx, watchCancel := context.WithCancel(connCtx)
	watchContextsForConn[key] = watchCfg{cancel: watchCancel, fields: projFields}
	watchIdsForConn[msg.ID] = key

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
			delete(watchContextsForConn, key)
			delete(watchIdsForConn, msg.ID)
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
				// Update counters and send to all ids mapped to this key
				for id, mappedKey := range watchIdsForConn {
					if mappedKey == key {
						h.sendDataMessageWithCountersAndProject(ws, id, msg.Path, event, counters, projFields)
					}
				}
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
	ws *wsutil.WebSocketConnection,
	msg *ClientMessage,
	watchContextsForConn map[string]watchCfg,
	watchIdsForConn map[string]string,
) {
	// Determine the composite key: prefer id mapping, fallback to path+params
	key, ok := watchIdsForConn[msg.ID]
	if !ok || key == "" {
		fields := wsutil.ParseProjectionFields(msg.Params)
		key = makeWatchKey(msg.Path, fields)
	}
	// Check if subscribed
	cfg, exists := watchContextsForConn[key]
	if !exists {
		h.sendErrorMessage(ws, msg.ID, msg.Path, "not subscribed to this path")
		return
	}

	// Remove this subscription id mapping
	if msg.ID != "" {
		delete(watchIdsForConn, msg.ID)
	}
	// Check if any other ids still reference this key
	remaining := false
	for _, k := range watchIdsForConn {
		if k == key {
			remaining = true
			break
		}
	}
	// Cancel and delete only if no more subscribers remain for this key
	if !remaining {
		cfg.cancel()
		delete(watchContextsForConn, key)
	}

	// Send success message
	h.sendStatusMessage(ws, msg.ID, msg.Path, "unsubscribed")
}

// makeWatchKey builds a stable composite key from path and projection fields
func makeWatchKey(path string, fields []string) string {
	if len(fields) == 0 {
		return path
	}
	cp := make([]string, len(fields))
	copy(cp, fields)
	sort.Strings(cp)
	return fmt.Sprintf("%s?fields=%s", path, strings.Join(cp, ","))
}

// sendDataMessage sends a data message to the client
func (h *WebSocketHandler) sendDataMessage(ws *wsutil.WebSocketConnection, id, path string, data *kubernetes.WatchEvent) {
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

// sendDataMessageWithCountersAndProject is like sendDataMessageWithCounters but also applies
// frontend-provided JSONPath-style projections when provided.
func (h *WebSocketHandler) sendDataMessageWithCountersAndProject(ws *wsutil.WebSocketConnection, id, path string, data *kubernetes.WatchEvent, counters *wsutil.Counters, fields []string) {
	transformed, removed := wsutil.TransformWatchEvent(data, fields)
	if transformed != nil {
		counters.AddObjects(1)
	}
	if removed > 0 {
		counters.AddManagedBytes(int64(removed))
	}
	msg := ServerMessage{ID: id, Type: "data", Path: path, Data: transformed}
	if err := wsutil.MarshalAndWrite(ws, &msg, counters); err != nil {
		log.Printf("error writing message: %v", err)
	}
}

// sendErrorMessage sends an error message to the client
func (h *WebSocketHandler) sendErrorMessage(ws *wsutil.WebSocketConnection, id, path, errorMsg string) {
	msg := ServerMessage{
		ID:    id,
		Type:  "error",
		Path:  path,
		Error: errorMsg,
	}
	h.sendMessage(ws, &msg)
}

// sendStatusMessage sends a status message to the client
func (h *WebSocketHandler) sendStatusMessage(ws *wsutil.WebSocketConnection, id, path, status string) {
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
func (h *WebSocketHandler) sendStatsMessage(ws *wsutil.WebSocketConnection, counters *wsutil.Counters) {
	msg := ServerMessage{Type: "stats", Data: wsutil.StatsEvent(counters)}
	_ = wsutil.MarshalAndWrite(ws, &msg, counters)
}

// sendMessage sends a message to the client
func (h *WebSocketHandler) sendMessage(ws *wsutil.WebSocketConnection, msg *ServerMessage) {
	if err := wsutil.MarshalAndWrite(ws, msg, nil); err != nil {
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

// handleHelmReleaseWatch handles watching Helm releases with polling
func (h *WebSocketHandler) handleHelmReleaseWatch(ctx context.Context, ws *wsutil.WebSocketConnection, msg *ClientMessage) {
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
func (h *WebSocketHandler) handleHelmHistoryWatch(ctx context.Context, ws *wsutil.WebSocketConnection, msg *ClientMessage) {
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
func (h *WebSocketHandler) sendHelmHistory(ws *wsutil.WebSocketConnection, id, path string, history []helm.HistoryRelease) {
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
func (h *WebSocketHandler) compareAndSendHelmChanges(ws *wsutil.WebSocketConnection, msg *ClientMessage, previous, current []*helm.Release) {
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
