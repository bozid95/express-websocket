package engine

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"express-websocket/config"
	"io"
	"log"
	"net/http"
	"time"
)

// TriggerPayload represents the data sent to n8n
type TriggerPayload struct {
	Symbol             string  `json:"symbol"`
	PriceChangePercent string  `json:"priceChangePercent"`
	LastPrice          string  `json:"lastPrice"`
	HighPrice          string  `json:"highPrice"`
	LowPrice           string  `json:"lowPrice"`
	Volume             string  `json:"volume"`
	QuoteVolume        string  `json:"quoteVolume"`
	Direction          string  `json:"direction"`
	Threshold          float64 `json:"threshold"`
	TriggeredAt        string  `json:"triggeredAt"`
}

// Insecure HTTP client (analogous to rejectUnauthorized: false in Node.js)
var httpClient = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	},
}

func TriggerN8n(payload TriggerPayload) {
	url := config.AppConfig.N8nWebhookURL

	if url == "" || stringsContains(url, "your-n8n-instance") {
		log.Printf("[n8n] ⚠️  N8N_WEBHOOK_URL is not configured. Skipping trigger for %s.\n", payload.Symbol)
		return
	}

	bodyData, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[n8n] ❌ Failed to serialize payload for %s: %s\n", payload.Symbol, err)
		return
	}

	req, err := http.NewRequest("POST", url, bytes.NewBuffer(bodyData))
	if err != nil {
		log.Printf("[n8n] ❌ Failed to create request for %s: %s\n", payload.Symbol, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	res, err := httpClient.Do(req)
	if err != nil {
		log.Printf("[n8n] ❌ Request error for %s (timeout/network): %s\n", payload.Symbol, err)
		return
	}
	defer res.Body.Close()

	if res.StatusCode >= 200 && res.StatusCode < 300 {
		log.Printf("[n8n] ✅ Triggered for %s → HTTP %d\n", payload.Symbol, res.StatusCode)
	} else {
		respBody, _ := io.ReadAll(res.Body)
		log.Printf("[n8n] ❌ HTTP %d for %s: %s\n", res.StatusCode, payload.Symbol, string(respBody))
	}
}

// Helper
func stringsContains(s, substr string) bool {
	return bytes.Contains([]byte(s), []byte(substr))
}
