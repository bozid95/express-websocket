package fetcher

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Ticker24h struct {
	Symbol      string `json:"symbol"`
	QuoteVolume string `json:"quoteVolume"`
}

// FetchTop100Pairs fetches 24hr ticker data from Binance Futures,
// sorts by QuoteVolume descending, returns the top 100 USDT pairs.
func FetchTop100Pairs() ([]string, error) {
	log.Println("[API] Fetching top 100 pairs by volume from Binance Futures...")
	client := &http.Client{Timeout: 10 * time.Second}

	resp, err := client.Get("https://fapi.binance.com/fapi/v1/ticker/24hr")
	if err != nil {
		return nil, fmt.Errorf("failed to fetch 24hr ticker: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response body: %v", err)
	}

	var tickers []Ticker24h
	if err := json.Unmarshal(body, &tickers); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JSON: %v", err)
	}

	type sortableTicker struct {
		Symbol string
		Volume float64
	}

	var valid []sortableTicker
	for _, t := range tickers {
		if strings.HasSuffix(t.Symbol, "USDT") {
			vol, err := strconv.ParseFloat(t.QuoteVolume, 64)
			if err == nil {
				valid = append(valid, sortableTicker{Symbol: t.Symbol, Volume: vol})
			}
		}
	}

	sort.Slice(valid, func(i, j int) bool {
		return valid[i].Volume > valid[j].Volume
	})

	limit := 100
	if len(valid) < limit {
		limit = len(valid)
	}

	var pairs []string
	for i := 0; i < limit; i++ {
		pairs = append(pairs, valid[i].Symbol)
	}

	log.Printf("[API] Fetched top %d dynamic pairs by volume.", len(pairs))
	return pairs, nil
}
