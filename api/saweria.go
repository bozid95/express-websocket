package api

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"

	"express-websocket/config"
)

type SaweriaPayload struct {
	Version      string `json:"version"`
	ID           string `json:"id"`
	DonatorName  string `json:"donator_name"`
	DonatorEmail string `json:"donator_email"`
	AmountRaw    int    `json:"amount_raw"`
	Message      string `json:"message"`
	CreatedAt    string `json:"created_at"`
}

func SaweriaWebhookHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	body, err := ioutil.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Cannot read body", http.StatusBadRequest)
		return
	}

	// Verify HMAC-SHA256 Signature
	signature := r.Header.Get("Saweria-Signature")
	if config.AppConfig.SaweriaSecret != "" && signature != "" {
		mac := hmac.New(sha256.New, []byte(config.AppConfig.SaweriaSecret))
		mac.Write(body)
		expectedMAC := hex.EncodeToString(mac.Sum(nil))

		if !hmac.Equal([]byte(signature), []byte(expectedMAC)) {
			log.Println("[Saweria] Invalid webhook signature")
			http.Error(w, "Invalid signature", http.StatusUnauthorized)
			return
		}
	} else if config.AppConfig.SaweriaSecret == "" {
		log.Println("[Saweria] WARNING: SAWERIA_SECRET not set, bypassing signature validation")
	}

	var payload SaweriaPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		log.Printf("[Saweria] Failed to parse payload: %v", err)
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	log.Printf("[Saweria] Received donation from %s: %d", payload.DonatorName, payload.AmountRaw)

	if config.AppConfig.SupabaseURL == "" || config.AppConfig.SupabaseKey == "" {
		log.Println("[Saweria] Supabase config missing. Donation not saved.")
		w.WriteHeader(http.StatusOK)
		return
	}

	// Save to Supabase
	record := map[string]interface{}{
		"donator_name":  payload.DonatorName,
		"donator_email": payload.DonatorEmail,
		"amount":        payload.AmountRaw,
		"message":       payload.Message,
	}

	reqBody, _ := json.Marshal(record)
	url := fmt.Sprintf("%s/rest/v1/donations", config.AppConfig.SupabaseURL)
	req, _ := http.NewRequest("POST", url, bytes.NewBuffer(reqBody))
	req.Header.Set("apikey", config.AppConfig.SupabaseKey)
	req.Header.Set("Authorization", "Bearer "+config.AppConfig.SupabaseKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", "return=minimal")

	client := &http.Client{}
	res, err := client.Do(req)
	if err != nil || res.StatusCode >= 300 {
		log.Printf("[Saweria] Failed to save to Supabase: %v", err)
		http.Error(w, "Internal error", http.StatusInternalServerError)
		return
	}
	defer res.Body.Close()

	log.Println("[Saweria] Successfully saved donation to DB")
	w.WriteHeader(http.StatusOK)
}
