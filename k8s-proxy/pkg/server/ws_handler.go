package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
	"github.com/laszlo/k8s-proxy/pkg/kubernetes"
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
	upgrader  websocket.Upgrader
	k8sClient *kubernetes.Client

	// Maps connection to a map of resource paths to contexts
	// This allows us to cancel watches when clients unsubscribe
	watchContexts sync.Map
}

// NewWebSocketHandler creates a new WebSocketHandler
func NewWebSocketHandler(k8sClient *kubernetes.Client) *WebSocketHandler {
	return &WebSocketHandler{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins
			},
		},
		k8sClient: k8sClient,
	}
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
			h.handleSubscribe(connCtx, ws, &clientMsg, watchContextsForConn)
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
) {
	// Log the subscription request
	log.Printf("Subscribe request for path: %s", msg.Path)

	// Check if already subscribed
	if _, exists := watchContextsForConn[msg.Path]; exists {
		h.sendErrorMessage(ws, msg.ID, msg.Path, "already subscribed to this path")
		return
	}

	// Create context for this watch that can be cancelled
	watchCtx, watchCancel := context.WithCancel(connCtx)
	watchContextsForConn[msg.Path] = watchCancel

	// Create channel for events
	eventsChan := make(chan *kubernetes.WatchEvent, 100)

	// Start watching in a goroutine
	go func() {
		defer close(eventsChan)
		defer watchCancel()

		log.Printf("Starting watch for path: %s", msg.Path)
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
					return // Channel closed
				}
				log.Printf("Received event type: %s for path: %s", event.Type, msg.Path)
				h.sendDataMessage(ws, msg.ID, msg.Path, event)
			case <-watchCtx.Done():
				log.Printf("Watch context done for path: %s", msg.Path)
				return // Context cancelled
			}
		}
	}()

	// Send success message
	h.sendStatusMessage(ws, msg.ID, msg.Path, "subscribed")
	log.Printf("Successfully subscribed to path: %s", msg.Path)
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
	msg := ServerMessage{
		ID:   id,
		Type: "data",
		Path: path,
		Data: data,
	}
	h.sendMessage(ws, &msg)
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
