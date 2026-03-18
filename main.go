package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"

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

	// 4. Serve static files (dashboard)
	http.Handle("/dashboard/", http.StripPrefix("/dashboard/", http.FileServer(http.Dir("./public"))))

	// 5. Start HTTP Server
	go func() {
		addr := fmt.Sprintf(":%d", config.AppConfig.Port)
		log.Printf("[Server] 🚀 Running on http://localhost%s\n", addr)
		log.Printf("[Server]    Endpoints: GET /health  |  GET /status  |  POST /config/threshold  |  GET /dashboard.html\n\n")
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
