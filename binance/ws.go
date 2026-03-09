package binance

import (
	"crypto/tls"
	"encoding/json"
	"express-websocket/config"
	"express-websocket/engine"
	"log"
	"math"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

type WsState struct {
	Connected         bool
	ReconnectAttempts int
	StartedAt         string
	TotalMessages     int64
	Ws                *websocket.Conn
}

var State = WsState{
	StartedAt: time.Now().Format(time.RFC3339),
}

// Build stream url based on pairs
func buildStreamUrl() string {
	var streams []string
	for _, p := range config.AppConfig.Pairs {
		streams = append(streams, strings.ToLower(p)+"@ticker")
	}
	// "wss://fstream.binance.com/stream?streams=btcusdt@ticker/ethusdt@ticker..."
	return "wss://fstream.binance.com/stream?streams=" + strings.Join(streams, "/")
}

type WsMessageMsg struct {
	Stream string            `json:"stream"`
	Data   engine.TickerData `json:"data"`
}

type WsMessageEvent struct {
	Event string `json:"e"`
	// The rest isn't parsed unless we need it
}

func Connect() {
	urlStr := buildStreamUrl()
	log.Printf("[WS] Connecting to Binance Futures (%d pairs)...\n", len(config.AppConfig.Pairs))

	dialer := *websocket.DefaultDialer
	dialer.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}

	conn, _, err := dialer.Dial(urlStr, nil)
	if err != nil {
		log.Printf("[WS] ❌ Error dialing: %v\n", err)
		reconnect()
		return
	}

	State.Ws = conn
	State.Connected = true
	State.ReconnectAttempts = 0
	log.Printf("[WS] ✅ Connected to Binance Futures WebSocket\n")

	// Start reading messages
	go func() {
		defer func() {
			State.Connected = false
			State.Ws = nil
			conn.Close()
			reconnect()
		}()

		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				log.Printf("[WS] ⚠️  Disconnected. Read error: %v\n", err)
				break
			}
			State.TotalMessages++

			handleMessage(message)
		}
	}()
}

func handleMessage(msg []byte) {
	// Fast check for '24hrTicker' string without unmarshaling fully
	if !strings.Contains(string(msg), "24hrTicker") {
		return
	}

	var parsedMsg WsMessageMsg
	if err := json.Unmarshal(msg, &parsedMsg); err != nil {
		log.Printf("[WS] Unmarshal error: %v | Raw: %s", err, string(msg))
		return
	}

	// Double check the event is specifically 24hrTicker inside Data block
	// Technically, if we only subscribe to @ticker, it should be 24hrTicker.
	engine.ApplyFilter(parsedMsg.Data)
}

func reconnect() {
	delay := getReconnectDelay()
	log.Printf("[WS] ⚠️  Reconnecting in %v seconds...\n", float64(delay)/1000.0)
	time.Sleep(time.Duration(delay) * time.Millisecond)
	Connect()
}

func getReconnectDelay() int {
	State.ReconnectAttempts++
	// Exponential backoff up to 60s
	delay := int(1000 * math.Pow(2, float64(State.ReconnectAttempts-1)))
	if delay > 60000 {
		return 60000
	}
	return delay
}
