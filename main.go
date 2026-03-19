package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"express-websocket/api"
	"express-websocket/binance"
	"express-websocket/config"
	"express-websocket/engine"
)

func main() {
	// 1. Initial Load Env
	config.LoadConfig()

	// 2. Print Banner
	fmt.Println("")
	fmt.Println("╔══════════════════════════════════════════════════════╗")
	fmt.Println("║     Binance WebSocket → n8n Bridge (Go) v1.0         ║")
	fmt.Println("╚══════════════════════════════════════════════════════╝")
	fmt.Printf("  Pairs monitored   : %d\n", len(config.AppConfig.Pairs))
	fmt.Printf("  Threshold         : ±%.2f%%\n", config.AppConfig.PriceChangeThreshold)
	fmt.Printf("  Cooldown          : %ds per coin\n", config.AppConfig.CooldownMs/1000)

	volMultiplierInfo := "disabled"
	if config.AppConfig.VolumeSpikeMultiplier > 0 {
		volMultiplierInfo = fmt.Sprintf("%.2fx spike", config.AppConfig.VolumeSpikeMultiplier)
	}
	fmt.Printf("  Volume check      : %s\n", volMultiplierInfo)

	webhookUrl := config.AppConfig.N8nWebhookURL
	if webhookUrl == "" {
		webhookUrl = "⚠️  NOT SET"
	}
	fmt.Printf("  n8n webhook       : %s\n", webhookUrl)
	fmt.Println("")

	// 3. Register HTTP Routes
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		status := "ok"
		if !binance.State.Connected {
			status = "disconnected"
			w.WriteHeader(http.StatusServiceUnavailable)
		} else {
			w.WriteHeader(http.StatusOK)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":            status,
			"connected":         binance.State.Connected,
			"uptime":            binance.State.StartedAt,
			"reconnectAttempts": binance.State.ReconnectAttempts,
		})
	})

	http.HandleFunc("/status", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		json.NewEncoder(w).Encode(map[string]interface{}{
			"totalMessages":  binance.State.TotalMessages,
			"totalChecked":   engine.Stats.TotalChecked,
			"totalPassed":    engine.Stats.TotalPassed,
			"totalBlocked":   engine.Stats.TotalBlocked,
			"perCoin":        engine.Stats.PerCoin,
			"pairsMonitored": len(config.AppConfig.Pairs),
		})
	})

	http.HandleFunc("/webhook/saweria", api.SaweriaWebhookHandler)

	http.HandleFunc("/api/ai-insight", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.Method != "POST" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		apiKey := os.Getenv("GROQ_API_KEY")
		if apiKey == "" {
			log.Println("[AI Proxy] ❌ Error: GROQ_API_KEY is not set in environment.")
			http.Error(w, "Groq API Key not configured on server", http.StatusInternalServerError)
			return
		}

		// Proxy request to Groq
		body, _ := io.ReadAll(r.Body)
		log.Printf("[AI Proxy] 🔍 Analyzing data (length: %d chars)...\n", len(body))
		
		groqPayload := map[string]interface{}{
			"model": "llama-3.3-70b-versatile",
			"messages": []map[string]string{
				{"role": "system", "content": `Anda adalah "CryptoSpike Pro Strategist", pakar analisis kuantitatif kripto. Tugas Anda adalah memberikan **Actionable Intelligence** dalam Bahasa Indonesia yang sangat mendalam berdasarkan data historis yang diberikan.

FOKUS UTAMA:
Menganalisis korelasi antara Score, Strategy, dan Outcome (TP/SL) untuk menemukan "Golden Setup" (kondisi dengan akurasi >75%).

STRUKTUR LAPORAN (Wajib):

## 🎯 1. Ringkasan Executive (The Golden Setup)
Identifikasi kombinasi Score dan Strategi yang menghasilkan Win Rate tertinggi. Sebutkan "Safe Zone" entry (contoh: Score 82-87 di koin Tier-1).

## 📊 2. Matriks Keputusan Strategis
Buat tabel Markdown: | Parameter | Win Rate | Profitability | Rekomendasi |
Evaluasi apakah Score tinggi (80+) saat ini valid atau sedang anomali.

## 📉 3. Red Flags & Signal Filtering (Go/No-Go)
- Identifikasi koin atau kondisi (dari field 'reasons') yang sering gagal (SL).
- Analisis "Conversion Rate" dari TP1 ke TP3. Apakah layak untuk hold lama?
- Berikan checklist 5 poin sebelum user melakukan entry.

## 💡 4. Analisis Eksposur Aktif
Evaluasi sinyal yang sedang "Running". Berikan peringatan jika ada risiko tinggi atau dorongan kepercayaan diri jika setupnya ideal.

Gunakan Markdown yang rapi, tabel, dan bold text. Pastikan nada bicara profesional dan berorientasi pada data (data-driven).`},
				{"role": "user", "content": string(body)},
			},
			"temperature": 0.4,
		}

		jsonPayload, _ := json.Marshal(groqPayload)
		req, err := http.NewRequest("POST", "https://api.groq.com/openai/v1/chat/completions", bytes.NewBuffer(jsonPayload))
		if err != nil {
			log.Printf("[AI Proxy] ❌ Error creating request: %v\n", err)
			http.Error(w, "Failed to create Groq request", http.StatusInternalServerError)
			return
		}

		req.Header.Set("Authorization", "Bearer "+apiKey)
		req.Header.Set("Content-Type", "application/json")

		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("[AI Proxy] ❌ Error calling Groq API: %v\n", err)
			http.Error(w, "Failed to call Groq API", http.StatusInternalServerError)
			return
		}
		defer resp.Body.Close()

		log.Printf("[AI Proxy] ✅ Groq Response Status: %d\n", resp.StatusCode)
		
		if resp.StatusCode != 200 {
			errBody, _ := io.ReadAll(resp.Body)
			log.Printf("[AI Proxy] ❌ Groq Error: %s\n", string(errBody))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(resp.StatusCode)
			w.Write(errBody)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	})

	http.HandleFunc("/config/threshold", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var payload map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "Invalid JSON body", http.StatusBadRequest)
			return
		}

		if val, exists := payload["threshold"]; exists {
			var n float64
			switch v := val.(type) {
			case float64:
				n = v
			case string:
				parsed, err := strconv.ParseFloat(v, 64)
				if err != nil {
					http.Error(w, "Threshold must be a valid number", http.StatusBadRequest)
					return
				}
				n = parsed
			default:
				http.Error(w, "Threshold must be a number", http.StatusBadRequest)
				return
			}

			if n <= 0 {
				http.Error(w, "Threshold must be a positive number", http.StatusBadRequest)
				return
			}

			config.AppConfig.PriceChangeThreshold = n
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"message": "Threshold updated successfully",
				"value":   n,
			})
			log.Printf("[Config] Threshold runtime updated to %.2f\n", n)
			return
		}
		http.Error(w, "Missing 'threshold' field", http.StatusBadRequest)
	})

	// 4. Live prices endpoint for dashboard
	http.HandleFunc("/api/prices", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		prices := make(map[string]engine.PriceInfo)
		engine.LatestPrices.Range(func(key, value interface{}) bool {
			prices[key.(string)] = value.(engine.PriceInfo)
			return true
		})
		json.NewEncoder(w).Encode(prices)
	})

	// 5. Serve static files (dashboard)
	http.Handle("/dashboard/", http.StripPrefix("/dashboard/", http.FileServer(http.Dir("./public"))))

	// 5. Start HTTP Server
	go func() {
		addr := fmt.Sprintf(":%d", config.AppConfig.Port)
		log.Printf("[Server] 🚀 Running on http://localhost%s\n", addr)
		log.Printf("[Server]    Endpoints: GET /health  |  GET /status  |  POST /config/threshold  |  POST /webhook/saweria  |  GET /dashboard.html\n\n")
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Fatalf("[FATAL] HTTP server failed to start: %v\n", err)
		}
	}()

	// 5. Start 1H Candle Close Detector (polls REST API every 5 min)
	go engine.StartCandleDetector()

	// 6. Start Binance WebSocket (real-time 24H ticker)
	binance.Connect()

	// 7. Graceful Shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Printf("\n[Server] 🛑 Signal %v received, shutting down gracefully...", sig)
	os.Exit(0)
}
