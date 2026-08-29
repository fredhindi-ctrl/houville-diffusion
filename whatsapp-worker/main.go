package main

import (
	"context"
	"fmt"
	"os"
	"time"
)

// Process permanent (AlwaysData) : connexion whatsmeow, boucle de polling de
// messages_a_envoyer, endpoint /health pour UptimeRobot. Voir plan-houville.md, sections H et I.

const pollInterval = 5 * time.Minute

func main() {
	ctx := context.Background()

	sb, err := newSupabaseClient()
	if err != nil {
		fmt.Println("Erreur fatale au démarrage :", err)
		os.Exit(1)
	}

	client, err := connectWhatsApp(ctx)
	if err != nil {
		fmt.Println("Erreur fatale au démarrage :", err)
		os.Exit(1)
	}
	defer client.Disconnect()

	groupJID := os.Getenv("WHATSAPP_GROUP_JID")

	startHealthServer(sb)

	poll := func() {
		lastPollAt.Store(time.Now().Unix())
		if !isWhatsAppConnected() {
			fmt.Println("Polling ignoré : WhatsApp non connecté pour l'instant.")
			return
		}
		if groupJID == "" {
			fmt.Println("Polling ignoré : WHATSAPP_GROUP_JID pas encore configuré.")
			return
		}
		if err := pollAndSend(client, sb, groupJID); err != nil {
			fmt.Println("Erreur pendant le polling :", err)
		}
	}

	// client.Connect() revient dès que la connexion est amorcée, pas une fois établie —
	// laisse un court instant pour que l'événement Connected ait une vraie chance d'arriver
	// avant le tout premier poll (sinon il est quasi toujours ignoré inutilement).
	waitConnected(3 * time.Second)
	poll()
	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()
	for range ticker.C {
		poll()
	}
}
