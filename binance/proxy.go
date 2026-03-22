package binance

import (
	"encoding/json"
	"express-websocket/engine"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// priceClient represents a connected browser client
type priceClient struct {
	conn    *websocket.Conn
	symbols map[string]bool
	mu      sync.Mutex
}

var (
	priceClients   = make(map[*priceClient]bool)
	priceClientsMu sync.RWMutex
	broadcasterOnce sync.Once
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// Allow all origins — adjust if you want stricter CORS
		return true
	},
}

// priceMsg is the JSON format sent to browser clients.
// Matches the miniTicker format expected by core.js:
// {"data": {"s": "BTCUSDT", "c": "65432.10"}}
type priceMsg struct {
	Data struct {
		S string `json:"s"` // symbol
		C string `json:"c"` // close/last price
	} `json:"data"`
}

// PriceProxyHandler handles WebSocket connections from the browser dashboard.
// Query param: ?symbols=BTCUSDT,ETHUSDT,BNBUSDT
// It broadcasts realtime prices from engine.LatestPrices to all connected clients.
func PriceProxyHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[PriceProxy] ❌ Upgrade error: %v\n", err)
		return
	}

	// Parse requested symbols from ?symbols= query param
	symbolsParam := r.URL.Query().Get("symbols")
	symbolFilter := make(map[string]bool)
	if symbolsParam != "" {
		for _, s := range strings.Split(symbolsParam, ",") {
			sym := strings.TrimSpace(strings.ToUpper(s))
			if sym != "" {
				symbolFilter[sym] = true
			}
		}
	}

	client := &priceClient{
		conn:    conn,
		symbols: symbolFilter,
	}

	priceClientsMu.Lock()
	priceClients[client] = true
	priceClientsMu.Unlock()

	log.Printf("[PriceProxy] ✅ Client connected (symbols: %s)\n", symbolsParam)

	// Start the broadcaster goroutine once (shared across all clients)
	broadcasterOnce.Do(func() {
		go startPriceBroadcaster()
	})

	// Keep connection alive — read pings/pongs, detect disconnect
	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}

	// Client disconnected — clean up
	priceClientsMu.Lock()
	delete(priceClients, client)
	priceClientsMu.Unlock()
	conn.Close()
	log.Printf("[PriceProxy] 🔌 Client disconnected\n")
}

// startPriceBroadcaster runs a loop that pushes price updates to all connected clients
// every second, sourcing data from engine.LatestPrices (kept up-to-date by binance.Connect).
func startPriceBroadcaster() {
	log.Println("[PriceProxy] 🚀 Broadcaster started")
	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		priceClientsMu.RLock()
		if len(priceClients) == 0 {
			priceClientsMu.RUnlock()
			continue
		}

		// Collect current prices from engine
		type symbolPrice struct {
			symbol string
			price  string
		}
		var updates []symbolPrice
		engine.LatestPrices.Range(func(key, value interface{}) bool {
			sym := key.(string)
			info := value.(engine.PriceInfo)
			if info.Price > 0 {
				updates = append(updates, symbolPrice{
					symbol: sym,
					price:  formatPrice(info.Price),
				})
			}
			return true
		})
		priceClientsMu.RUnlock()

		if len(updates) == 0 {
			continue
		}

		// Send to each client
		priceClientsMu.RLock()
		for client := range priceClients {
			client.mu.Lock()
			for _, u := range updates {
				// Filter: only send symbols this client subscribed to (if filter set)
				if len(client.symbols) > 0 && !client.symbols[u.symbol] {
					continue
				}

				var msg priceMsg
				msg.Data.S = u.symbol
				msg.Data.C = u.price

				data, err := json.Marshal(msg)
				if err != nil {
					continue
				}

				client.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
				if err := client.conn.WriteMessage(websocket.TextMessage, data); err != nil {
					// Client likely disconnected; will be cleaned up in read loop
					break
				}
			}
			client.mu.Unlock()
		}
		priceClientsMu.RUnlock()
	}
}

// formatPrice converts a float64 price to a clean string representation
func formatPrice(p float64) string {
	if p < 1 {
		return strconv.FormatFloat(p, 'f', 6, 64)
	} else if p < 100 {
		return strconv.FormatFloat(p, 'f', 4, 64)
	}
	return strconv.FormatFloat(p, 'f', 2, 64)
}
