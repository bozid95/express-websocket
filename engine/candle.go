package engine

import (
	"crypto/tls"
	"encoding/json"
	"express-websocket/config"
	"fmt"
	"io/ioutil"
	"log"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// CandleData represents a single kline
type CandleData struct {
	OpenTime  int64
	Open      float64
	High      float64
	Low       float64
	Close     float64
	Volume    float64
	CloseTime int64
}

// lastProcessedCandle tracks the last processed candle per symbol
var candleCache sync.Map // map[string]int64 (symbol -> last processed close time)

var insecureClient = &http.Client{
	Timeout: 15 * time.Second,
	Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	},
}

// StartCandleDetector runs a goroutine that polls 1H candles every 5 minutes
// and triggers n8n when a significant candle close is detected
func StartCandleDetector() {
	log.Println("[CANDLE] 🕯️  1H Candle Close Detector started (poll every 5 min)")

	// Initial delay — wait 30 seconds for WS connection to stabilize
	time.Sleep(30 * time.Second)

	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	// Run immediately on start, then every 5 min
	checkAllCandles()

	for range ticker.C {
		checkAllCandles()
	}
}

func checkAllCandles() {
	pairs := config.AppConfig.Pairs
	if len(pairs) == 0 {
		return
	}

	// Rate limit: check max 20 pairs per cycle to avoid API ban
	limit := 20
	if len(pairs) < limit {
		limit = len(pairs)
	}

	checked := 0
	triggered := 0

	for _, symbol := range pairs {
		if checked >= limit {
			break
		}

		candles, err := fetch1HCandles(symbol, 3)
		if err != nil {
			continue
		}

		if len(candles) < 2 {
			continue
		}

		// We want the LAST CLOSED candle (index: len-2), not the currently forming one (len-1)
		lastClosed := candles[len(candles)-2]

		// Skip if we already processed this candle
		if lastTs, ok := candleCache.Load(symbol); ok {
			if lastTs.(int64) >= lastClosed.CloseTime {
				continue
			}
		}

		// Calculate candle change percent
		candleChangePct := 0.0
		if lastClosed.Open > 0 {
			candleChangePct = ((lastClosed.Close - lastClosed.Open) / lastClosed.Open) * 100
		}

		threshold := config.AppConfig.PriceChangeThreshold
		if threshold <= 0 {
			threshold = 2.0
		}

		// Trigger if the 1H candle body is significant
		if math.Abs(candleChangePct) >= threshold {
			candleCache.Store(symbol, lastClosed.CloseTime)
			triggered++

			direction := "📉"
			dirTag := "DOWN"
			sign := ""
			if candleChangePct >= 0 {
				direction = "🚀"
				dirTag = "UP"
				sign = "+"
			}

			log.Printf("[CANDLE] %s %s 1H candle closed: %s%.2f%% | Sending to n8n...\n",
				direction, symbol, sign, candleChangePct)

			go TriggerN8n(TriggerPayload{
				Symbol:             symbol,
				PriceChangePercent: formatFloat(candleChangePct, 4),
				LastPrice:          formatFloat(lastClosed.Close, 8),
				HighPrice:          formatFloat(lastClosed.High, 8),
				LowPrice:           formatFloat(lastClosed.Low, 8),
				Volume:             formatFloat(lastClosed.Volume, 4),
				QuoteVolume:        formatFloat(lastClosed.Volume*lastClosed.Close, 2),
				Direction:          dirTag,
				Threshold:          threshold,
				TriggeredAt:        time.Now().Format(time.RFC3339),
			})
		}

		checked++
		time.Sleep(200 * time.Millisecond) // 200ms between API calls
	}

	if triggered > 0 {
		log.Printf("[CANDLE] Cycle done: %d/%d checked, %d triggered\n", checked, len(pairs), triggered)
	}
}

func fetch1HCandles(symbol string, limit int) ([]CandleData, error) {
	url := fmt.Sprintf("https://fapi.binance.com/fapi/v1/klines?symbol=%s&interval=1h&limit=%d", symbol, limit)

	resp, err := insecureClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var raw [][]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}

	var candles []CandleData
	for _, k := range raw {
		if len(k) < 12 {
			continue
		}
		c := CandleData{
			OpenTime:  int64(k[0].(float64)),
			Open:      parseStrFloat(k[1]),
			High:      parseStrFloat(k[2]),
			Low:       parseStrFloat(k[3]),
			Close:     parseStrFloat(k[4]),
			Volume:    parseStrFloat(k[5]),
			CloseTime: int64(k[6].(float64)),
		}
		candles = append(candles, c)
	}

	return candles, nil
}

func parseStrFloat(v interface{}) float64 {
	switch val := v.(type) {
	case string:
		f, _ := strconv.ParseFloat(val, 64)
		return f
	case float64:
		return val
	}
	return 0
}
