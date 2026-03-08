package config

import (
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

var Top100Pairs = []string{
	"BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT",
	"AVAXUSDT", "LINKUSDT", "DOTUSDT", "MATICUSDT", "LTCUSDT", "BCHUSDT", "ATOMUSDT",
	"ETCUSDT", "XLMUSDT", "NEARUSDT", "ALGOUSDT", "VETUSDT", "FTMUSDT", "MANAUSDT",
	"SANDUSDT", "AXSUSDT", "GALLUSDT", "APEUSDT", "SHIBUSDT", "TRXUSDT", "FILUSDT",
	"ICPUSDT", "AAVEUSDT", "UNIUSDT", "EGLDUSDT", "FLOWUSDT", "THETAUSDT", "KSMUSDT",
	"XTZUSDT", "MKRUSDT", "RUNEUSDT", "CAKEUSDT", "NEOUSDT", "WAVESUSDT", "KLAYUSDT",
	"ZILUSDT", "HNTUSDT", "CHZUSDT", "ENJUSDT", "BATUSDT", "ZECUSDT", "DASHUSDT",
	"COMPUSDT", "YFIUSDT", "SNXUSDT", "SUSHIUSDT", "CRVUSDT", "BALUSDT", "RENUSDT",
	"UMAUSDT", "BANDUSDTBAND", "STORJUSDT", "OCEANUSDT", "ANKRUSDT", "IOTAUSDT",
	"ONTUSDT", "QTUMUSDT", "ZENUSDT", "LRCUSDT", "SKLUSDT", "CELRUSDT", "COTIUSDT",
	"STXUSDT", "RVNUSDT", "HOTUSDT", "SCUSDT", "DGBUSDT", "DENTUSDT", "REEFUSDT",
	"TFUELUSDT", "XVGUSDT", "MDTUSDT", "WOOUSDT", "GMTUSDT", "GALUSDT", "LDOUSDT",
	"OPUSDT", "ARBUSDT", "INJUSDT", "SUIUSDT", "SEIUSDT", "TIAUSDT", "ORDIUSDT",
	"WIFUSDT", "BONKUSDT", "JUPUSDT", "STRKUSDT", "PIXELUSDT", "AEVOUSDT", "BOMEUSDT",
	"WUSDT", "ENAUSDT",
}

type Config struct {
	Port                  int
	N8nWebhookURL         string
	PriceChangeThreshold  float64
	VolumeSpikeMultiplier float64
	CooldownMs            int
	Pairs                 []string
}

// Global config instance
var AppConfig Config

func LoadConfig() {
	// Load .env ignores error if file doesn't exist
	godotenv.Load()

	AppConfig = Config{
		Port:                  getEnvAsInt("PORT", 3000),
		N8nWebhookURL:         os.Getenv("N8N_WEBHOOK_URL"),
		PriceChangeThreshold:  getEnvAsFloat("PRICE_CHANGE_THRESHOLD", 3.0),
		VolumeSpikeMultiplier: getEnvAsFloat("VOLUME_SPIKE_MULTIPLIER", 0.0),
		CooldownMs:            getEnvAsInt("COOLDOWN_MS", 300000),
		Pairs:                 getPairs(),
	}
}

func getPairs() []string {
	mode := strings.ToLower(getEnvAsString("PAIRS_MODE", "top100"))
	if mode == "custom" {
		raw := os.Getenv("CUSTOM_PAIRS")
		if raw == "" {
			log.Println("[Config] PAIRS_MODE=custom but CUSTOM_PAIRS is empty. Falling back to top100.")
			return copyTop100()
		}
		parts := strings.Split(raw, ",")
		var list []string
		for _, p := range parts {
			trimmed := strings.ToUpper(strings.TrimSpace(p))
			if trimmed != "" {
				list = append(list, trimmed)
			}
		}
		if len(list) == 0 {
			return copyTop100()
		}
		return list
	}
	return copyTop100()
}

func copyTop100() []string {
	// Deduplicate inline to mimic JS .filter((v, i, a) => a.indexOf(v) === i)
	seen := make(map[string]bool)
	var list []string
	for _, p := range Top100Pairs {
		if !seen[p] {
			seen[p] = true
			list = append(list, p)
		}
	}
	return list
}

func getEnvAsString(key string, defaultVal string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return defaultVal
}

func getEnvAsInt(key string, defaultVal int) int {
	valueStr := getEnvAsString(key, "")
	if value, err := strconv.Atoi(valueStr); err == nil {
		return value
	}
	return defaultVal
}

func getEnvAsFloat(key string, defaultVal float64) float64 {
	valueStr := getEnvAsString(key, "")
	if value, err := strconv.ParseFloat(valueStr, 64); err == nil {
		return value
	}
	return defaultVal
}
