package main

import (
	"encoding/json"
	"net/http"
	"os"
	"sync/atomic"
	"time"
)

// Endpoint /health pour UptimeRobot (voir plan-houville.md, section I). Jamais un 200 qui
// cache un problème réel : whatsapp déconnecté, Supabase injoignable, ou boucle de polling
// bloquée renvoient toujours un vrai 503.

var lastPollAt atomic.Int64 // unix timestamp du dernier passage de la boucle, quel que soit le résultat

const stallThreshold = pollInterval * 3

func workerAlive(startedAt time.Time) bool {
	last := lastPollAt.Load()
	if last == 0 {
		return time.Since(startedAt) < stallThreshold
	}
	return time.Since(time.Unix(last, 0)) < stallThreshold
}

func startHealthServer(sb *supabaseClient) {
	startedAt := time.Now()
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		whatsapp := isWhatsAppConnected()
		database := sb.ping() == nil
		worker := workerAlive(startedAt)
		healthy := whatsapp && database && worker

		status := "ok"
		if !healthy {
			status = "error"
		}
		w.Header().Set("Content-Type", "application/json")
		if !healthy {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":   status,
			"whatsapp": boolLabel(whatsapp, "connected", "disconnected"),
			"database": boolLabel(database, "ok", "error"),
			"worker":   boolLabel(worker, "ok", "stalled"),
		})
	})

	go func() {
		println("/health en écoute sur le port " + port + ".")
		_ = http.ListenAndServe(":"+port, mux)
	}()
}

func boolLabel(b bool, ifTrue, ifFalse string) string {
	if b {
		return ifTrue
	}
	return ifFalse
}
