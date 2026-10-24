package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// One-shot : republie sur le Channel des messages déjà envoyés au groupe (rattrapage).
// Lit seulement messages_a_envoyer (aucune écriture), n'envoie jamais au groupe.
//
// Usage : go run ./cmd/channel-backfill <id> [<id> ...]   (envoyés dans l'ordre donné)
//
// Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_PASSWORD, WHATSAPP_CHANNEL_JID

type message struct {
	ID      int    `json:"id"`
	Contenu string `json:"contenu"`
	Statut  string `json:"statut"`
}

func fail(a ...any) {
	fmt.Println(a...)
	os.Exit(1)
}

func main() {
	ids := os.Args[1:]
	if len(ids) == 0 {
		fail("Usage : go run ./cmd/channel-backfill <id> [<id> ...]")
	}

	channel, err := types.ParseJID(os.Getenv("WHATSAPP_CHANNEL_JID"))
	if err != nil || channel.Server != types.NewsletterServer {
		fail("WHATSAPP_CHANNEL_JID doit être un Channel (...@newsletter)")
	}

	supabaseURL := os.Getenv("SUPABASE_URL")
	key := os.Getenv("SUPABASE_SERVICE_ROLE_KEY")
	dbPassword := os.Getenv("SUPABASE_DB_PASSWORD")
	if supabaseURL == "" || key == "" || dbPassword == "" {
		fail("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY et SUPABASE_DB_PASSWORD doivent être définis")
	}

	// Récupère et vérifie tous les messages avant de se connecter.
	req, _ := http.NewRequest("GET", supabaseURL+"/rest/v1/messages_a_envoyer?select=id,contenu,statut&id=in.("+strings.Join(ids, ",")+")", nil)
	req.Header.Set("apikey", key)
	req.Header.Set("Authorization", "Bearer "+key)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		fail("Lecture Supabase :", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	var rows []message
	if err := json.Unmarshal(body, &rows); err != nil {
		fail("Réponse Supabase illisible :", string(body))
	}
	byID := map[string]message{}
	for _, m := range rows {
		byID[fmt.Sprint(m.ID)] = m
	}
	var toSend []message
	for _, id := range ids {
		m, ok := byID[id]
		if !ok {
			fail("Message introuvable :", id)
		}
		if m.Statut != "envoye" {
			fail("Message", id, "pas encore envoyé au groupe (statut", m.Statut+") : abandon")
		}
		toSend = append(toSend, m)
	}

	ctx := context.Background()
	ref, _, _ := strings.Cut(strings.TrimPrefix(supabaseURL, "https://"), ".supabase.co")
	dsn := fmt.Sprintf("postgres://postgres:%s@db.%s.supabase.co:5432/postgres?sslmode=require", dbPassword, ref)
	container, err := sqlstore.New(ctx, "postgres", dsn, waLog.Noop)
	if err != nil {
		fail("Connexion store :", err)
	}
	device, err := container.GetFirstDevice(ctx)
	if err != nil || device.ID == nil {
		fail("Aucun appareil appairé :", err)
	}
	client := whatsmeow.NewClient(device, waLog.Noop)
	if err := client.Connect(); err != nil {
		fail("Connexion WhatsApp :", err)
	}
	defer client.Disconnect()
	time.Sleep(3 * time.Second)

	for i, m := range toSend {
		if i > 0 {
			time.Sleep(3 * time.Second)
		}
		res, err := client.SendMessage(ctx, channel, &waE2E.Message{Conversation: &m.Contenu})
		if err != nil {
			fail("Échec sur le message", m.ID, ":", err, "(messages suivants non envoyés)")
		}
		fmt.Printf("Message %d publié sur le Channel (id WhatsApp %s)\n", m.ID, res.ID)
	}
	fmt.Println("Terminé.")
}
