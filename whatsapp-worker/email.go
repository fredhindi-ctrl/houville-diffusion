package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

// Envoie une copie email de chaque message posté sur WhatsApp — juste une visibilité
// supplémentaire pour l'utilisateur, jamais une dépendance stricte : un échec d'email ne
// bloque jamais l'envoi WhatsApp lui-même ni le marquage "envoyé" (voir queue.go).
// Utilise Resend, sender de test onboarding@resend.dev — fonctionne sans domaine vérifié
// tant que le destinataire est l'adresse du compte Resend.
func sendEmailCopy(contenu string) error {
	apiKey := os.Getenv("RESEND_API_KEY")
	to := os.Getenv("EMAIL_TO")
	if apiKey == "" || to == "" {
		return fmt.Errorf("RESEND_API_KEY ou EMAIL_TO non défini, email ignoré")
	}

	payload := map[string]any{
		"from":    "Œdicnème <onboarding@resend.dev>",
		"to":      []string{to},
		"subject": "Copie du message WhatsApp envoyé",
		"text":    contenu,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", "https://api.resend.com/emails", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		return fmt.Errorf("Resend a répondu HTTP %d", resp.StatusCode)
	}
	return nil
}
