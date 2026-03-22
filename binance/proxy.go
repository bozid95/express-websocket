package binance

import (
	"crypto/tls"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// upgrader allows WebSocket connections from any origin
var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// client represents a connected browser
type priceClient struct {
	conn    *websocket.Conn
	symbols []string
	send    chan []byte
}

var (
	clients   = make(map[*priceClient]bool)
	clientsMu sync.Mutex

	// shared Binance WS for proxy (separate from the engine's connection)
	proxyWs       *websocket.Conn
	proxyWsMu     sync.Mutex
	proxySymbols  string // sorted symbol key currently subscribed
	proxyOnce     sync.Once
)

// PriceProxyHandler upgrades the HTTP connection to WebSocket and subscribes
// the browser to live Binance miniTicker prices via the VPS as relay.
// Query param: ?symbols=BTCUSDT,ETHUSDT,...
func PriceProxyHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[PriceProxy] upgrade error: %v\n", err)
		return
	}

	symbolsParam := r.URL.Query().Get("symbols")
	var symbols []string
	for _, s := range strings.Split(symbolsParam, ",") {
		s = strings.TrimSpace(strings.ToUpper(s))
		if s != "" {
			symbols = append(symbols, s)
		}
	}

	c := &priceClient{
		conn:    conn,
		symbols: symbols,
		send:    make(chan []byte, 256),
	}

	clientsMu.Lock()
	clients[c] = true
	clientsMu.Unlock()

	log.Printf("[PriceProxy] client connected (%d symbols)\n", len(symbols))

	// Start (or restart) the shared proxy Binance WS with the union of all symbols
	proxyOnce.Do(func() {
		go runProxyBinanceWs()
	})
	go reconnectIfNeeded(symbols)

	// Write pump — sends messages from channel to browser
	go func() {
		defer conn.Close()
		for msg := range c.send {
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				break
			}
		}
	}()

	// Read pump — keeps connection alive and detects disconnect
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}

	clientsMu.Lock()
	delete(clients, c)
	close(c.send)
	clientsMu.Unlock()
	log.Println("[PriceProxy] client disconnected")
}

// reconnectIfNeeded checks if the proxy WS needs to subscribe to new symbols
func reconnectIfNeeded(newSymbols []string) {
	time.Sleep(500 * time.Millisecond) // brief wait for client to be registered

	clientsMu.Lock()
	allSymbols := make(map[string]bool)
	for c := range clients {
		for _, s := range c.symbols {
			allSymbols[s] = true
		}
	}
	clientsMu.Unlock()

	// Build sorted key
	var list []string
	for s := range allSymbols {
		list = append(list, s)
	}
	key := strings.Join(sortedStrings(list), ",")

	proxyWsMu.Lock()
	needReconnect := key != proxySymbols
	proxyWsMu.Unlock()

	if needReconnect {
		log.Printf("[PriceProxy] Symbols changed, reconnecting proxy WS...\n")
		proxyWsMu.Lock()
		if proxyWs != nil {
			proxyWs.Close()
		}
		proxyWsMu.Unlock()
	}
}

// runProxyBinanceWs maintains a persistent WebSocket to Binance miniTicker
// and broadcasts price updates to all connected browser clients.
func runProxyBinanceWs() {
	for {
		// Collect all symbols from connected clients
		clientsMu.Lock()
		symbolSet := make(map[string]bool)
		for c := range clients {
			for _, s := range c.symbols {
				symbolSet[s] = true
			}
		}
		clientsMu.Unlock()

		if len(symbolSet) == 0 {
			time.Sleep(2 * time.Second)
			continue
		}

		var symList []string
		for s := range symbolSet {
			symList = append(symList, s)
		}

		streams := make([]string, len(symList))
		for i, s := range symList {
			streams[i] = strings.ToLower(s) + "@miniTicker"
		}
		wsUrl := "wss://fstream.binance.com/stream?streams=" + strings.Join(streams, "/")

		proxyWsMu.Lock()
		proxySymbols = strings.Join(sortedStrings(symList), ",")
		proxyWsMu.Unlock()

		log.Printf("[PriceProxy] Connecting proxy WS for %d symbols...\n", len(symList))

		dialer := *websocket.DefaultDialer
		dialer.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
		conn, _, err := dialer.Dial(wsUrl, nil)
		if err != nil {
			log.Printf("[PriceProxy] dial error: %v — retry in 5s\n", err)
			time.Sleep(5 * time.Second)
			continue
		}

		proxyWsMu.Lock()
		proxyWs = conn
		proxyWsMu.Unlock()
		log.Println("[PriceProxy] proxy WS connected to Binance")

		// Read messages and broadcast to all clients
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				log.Printf("[PriceProxy] read error: %v\n", err)
				break
			}
			broadcastToClients(msg)
		}

		conn.Close()
		proxyWsMu.Lock()
		proxyWs = nil
		proxyWsMu.Unlock()
		log.Println("[PriceProxy] proxy WS disconnected, reconnecting in 3s...")
		time.Sleep(3 * time.Second)
	}
}

// broadcastToClients sends a raw Binance message to all browser clients.
// Filters per client's symbol subscription.
func broadcastToClients(raw []byte) {
	// Extract symbol quickly without full unmarshal
	var wrapper struct {
		Data struct {
			S string `json:"s"`
			C string `json:"c"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &wrapper); err != nil {
		return
	}
	sym := wrapper.Data.S
	price := wrapper.Data.C
	if sym == "" || price == "" {
		return
	}

	// Re-encode as the simple format core.js expects:
	// {"data": {"s": "BTCUSDT", "c": "65432.10"}}
	out, _ := json.Marshal(map[string]interface{}{
		"data": map[string]string{"s": sym, "c": price},
	})

	clientsMu.Lock()
	defer clientsMu.Unlock()
	for c := range clients {
		// Check if this client subscribed to this symbol
		subscribed := false
		for _, s := range c.symbols {
			if s == sym {
				subscribed = true
				break
			}
		}
		if !subscribed {
			continue
		}
		// Non-blocking send
		select {
		case c.send <- out:
		default:
			// Buffer full — skip this update for this client
		}
	}
}

func sortedStrings(s []string) []string {
	// Simple insertion sort (small slice)
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
	return s
}

// formatPrice is kept for potential future use
func formatPrice(p float64) string {
	if p < 1 {
		return strconv.FormatFloat(p, 'f', 6, 64)
	} else if p < 100 {
		return strconv.FormatFloat(p, 'f', 4, 64)
	}
	return strconv.FormatFloat(p, 'f', 2, 64)
}
