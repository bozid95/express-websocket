package engine

import (
	"log"
	"math"
	"strconv"
	"sync"
	"time"

	"express-websocket/config"
)

type TickerData struct {
	Symbol             string `json:"s"`
	PriceChangePercent string `json:"P"`
	LastPrice          string `json:"c"`
	HighPrice          string `json:"h"`
	LowPrice           string `json:"l"`
	BaseVolume         string `json:"v"`
	QuoteVolume        string `json:"q"`
}

// Global Stats Map (Concurrency safe)
type StatsData struct {
	TotalChecked int64
	TotalPassed  int64
	TotalBlocked int64
	PerCoin      map[string]*CoinStat
	mu           sync.Mutex
}

type CoinStat struct {
	Triggered   int
	LastAt      string
	LastPercent float64
}

var Stats = StatsData{
	PerCoin: make(map[string]*CoinStat),
}

// Maps
var cooldownMap sync.Map
var volumeHistory sync.Map

func ApplyFilter(ticker TickerData) {
	pctChange, _ := strconv.ParseFloat(ticker.PriceChangePercent, 64)
	lastPrice, _ := strconv.ParseFloat(ticker.LastPrice, 64)
	highPrice, _ := strconv.ParseFloat(ticker.HighPrice, 64)
	lowPrice, _ := strconv.ParseFloat(ticker.LowPrice, 64)
	baseVolume, _ := strconv.ParseFloat(ticker.BaseVolume, 64)
	quoteVolume, _ := strconv.ParseFloat(ticker.QuoteVolume, 64)

	// Increment total checked
	Stats.mu.Lock()
	Stats.TotalChecked++
	Stats.mu.Unlock()

	// ── Rule 1: Price change threshold
	if math.Abs(pctChange) < config.AppConfig.PriceChangeThreshold {
		return // Filtered out
	}

	// ── Rule 2: Volume spike (if enabled)
	if config.AppConfig.VolumeSpikeMultiplier > 0 {
		baseline := getBaselineVolume(ticker.Symbol)
		if baseline > 0 && quoteVolume < baseline*config.AppConfig.VolumeSpikeMultiplier {
			Stats.mu.Lock()
			Stats.TotalBlocked++
			Stats.mu.Unlock()
			return // Volume didn't spike enough
		}
		// Update rolling baseline
		updateBaselineVolume(ticker.Symbol, quoteVolume)
	}

	// ── Rule 3: Cooldown per coin
	now := time.Now()
	if lastTriggeredRaw, ok := cooldownMap.Load(ticker.Symbol); ok {
		lastTriggered := lastTriggeredRaw.(time.Time)
		if now.Sub(lastTriggered).Milliseconds() < int64(config.AppConfig.CooldownMs) {
			return // Still in cooldown
		}
	}

	// ── PASSED all filters → trigger n8n
	cooldownMap.Store(ticker.Symbol, now)

	Stats.mu.Lock()
	Stats.TotalPassed++
	if _, exists := Stats.PerCoin[ticker.Symbol]; !exists {
		Stats.PerCoin[ticker.Symbol] = &CoinStat{}
	}
	Stats.PerCoin[ticker.Symbol].Triggered++
	Stats.PerCoin[ticker.Symbol].LastAt = now.Format(time.RFC3339)
	Stats.PerCoin[ticker.Symbol].LastPercent = pctChange
	Stats.mu.Unlock()

	direction := "📉"
	dirTag := "DOWN"
	sign := ""
	if pctChange >= 0 {
		direction = "🚀"
		dirTag = "UP"
		sign = "+"
	}

	log.Printf("[FILTER] %s %s passed: %s%.2f%% | Sending to n8n...\n",
		direction, ticker.Symbol, sign, pctChange)

	// Fire and forget n8n trigger
	go TriggerN8n(TriggerPayload{
		Symbol:             ticker.Symbol,
		PriceChangePercent: formatFloat(pctChange, 4),
		LastPrice:          formatFloat(lastPrice, 8),
		HighPrice:          formatFloat(highPrice, 8),
		LowPrice:           formatFloat(lowPrice, 8),
		Volume:             formatFloat(baseVolume, 4),
		QuoteVolume:        formatFloat(quoteVolume, 2),
		Direction:          dirTag,
		Threshold:          config.AppConfig.PriceChangeThreshold,
		TriggeredAt:        now.Format(time.RFC3339),
	})
}

func getBaselineVolume(symbol string) float64 {
	val, ok := volumeHistory.Load(symbol)
	if !ok {
		return 0
	}
	history := val.([]float64)
	if len(history) < 3 {
		return 0
	}
	sum := 0.0
	for _, v := range history {
		sum += v
	}
	return sum / float64(len(history))
}

func updateBaselineVolume(symbol string, val float64) {
	var history []float64
	stored, ok := volumeHistory.Load(symbol)
	if ok {
		history = stored.([]float64)
	}
	history = append(history, val)
	if len(history) > 10 {
		history = history[1:] // Keep last 10
	}
	volumeHistory.Store(symbol, history)
}

func formatFloat(v float64, prec int) string {
	return strconv.FormatFloat(v, 'f', prec, 64)
}
