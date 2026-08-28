package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// Client REST minimal pour messages_a_envoyer — pas de client Go officiel Supabase, et on n'a
// besoin que de deux opérations simples (lire les messages en_attente, marquer envoye). La
// session WhatsApp elle-même (creds Signal, clés) est gérée séparément par whatsmeow via une
// connexion Postgres directe (voir whatsapp.go) — pas via cette API REST.
type supabaseClient struct {
	url        string
	serviceKey string
	http       *http.Client
}

func newSupabaseClient() (*supabaseClient, error) {
	url := os.Getenv("SUPABASE_URL")
	key := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	if url == "" || key == "" {
		return nil, fmt.Errorf("SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis")
	}
	return &supabaseClient{url: url, serviceKey: key, http: &http.Client{}}, nil
}

func (c *supabaseClient) do(method, path string, body []byte) ([]byte, int, error) {
	req, err := http.NewRequest(method, c.url+"/rest/v1"+path, bytes.NewReader(body))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("apikey", c.serviceKey)
	req.Header.Set("Authorization", "Bearer "+c.serviceKey)
	req.Header.Set("Content-Type", "application/json")
	if method == "PATCH" {
		req.Header.Set("Prefer", "return=minimal")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	return respBody, resp.StatusCode, nil
}

type messageAEnvoyer struct {
	ID      int    `json:"id"`
	Contenu string `json:"contenu"`
}

func (c *supabaseClient) pendingMessages() ([]messageAEnvoyer, error) {
	body, status, err := c.do("GET", "/messages_a_envoyer?select=id,contenu&statut=eq.en_attente&order=date_creation.asc", nil)
	if err != nil {
		return nil, err
	}
	if status >= 300 {
		return nil, fmt.Errorf("lecture messages_a_envoyer : status %d : %s", status, string(body))
	}
	var messages []messageAEnvoyer
	if err := json.Unmarshal(body, &messages); err != nil {
		return nil, fmt.Errorf("décodage messages_a_envoyer : %w", err)
	}
	return messages, nil
}

func (c *supabaseClient) markSent(id int) error {
	payload, _ := json.Marshal(map[string]any{
		"statut":     "envoye",
		"date_envoi": time.Now().UTC().Format(time.RFC3339),
	})
	_, status, err := c.do("PATCH", fmt.Sprintf("/messages_a_envoyer?id=eq.%d", id), payload)
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("marquage message %d : status %d", id, status)
	}
	return nil
}

// Ping léger pour /health (section I du plan) : une lecture bornée, pas d'écriture.
func (c *supabaseClient) ping() error {
	_, status, err := c.do("GET", "/messages_a_envoyer?select=id&limit=1", nil)
	if err != nil {
		return err
	}
	if status >= 300 {
		return fmt.Errorf("ping Supabase : status %d", status)
	}
	return nil
}
