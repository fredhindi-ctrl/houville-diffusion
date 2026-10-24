package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"go.mau.fi/whatsmeow/types"
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
	channelJID := os.Getenv("WHATSAPP_CHANNEL_JID") // facultatif : copie vers un Channel WhatsApp
	// Alternative : lien d'invitation du Channel, résolu par le worker lui-même une fois connecté
	// (évite de lancer un 2e client sur la même session, qui déconnecterait le worker).
	channelInvite := os.Getenv("WHATSAPP_CHANNEL_INVITE")

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
		if channelJID == "" && channelInvite != "" {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			info, err := client.GetNewsletterInfoWithInvite(ctx, channelInvite)
			cancel()
			if err != nil {
				// Réessayé au prochain passage ; le groupe est servi quand même.
				fmt.Println("Résolution du lien du Channel échouée (réessai au prochain poll) :", err)
			} else {
				channelJID = info.ID.String()
				role := ""
				if info.ViewerMeta != nil {
					role = string(info.ViewerMeta.Role)
				}
				fmt.Printf("Channel résolu : %q — JID %s — rôle du compte : %s\n", info.ThreadMeta.Name.Text, channelJID, role)
				if role != string(types.NewsletterRoleOwner) && role != string(types.NewsletterRoleAdmin) {
					fmt.Println("ATTENTION : le compte n'est ni propriétaire ni admin du Channel, les envois y échoueront.")
				}
			}
		}
		if err := pollAndSend(client, sb, groupJID, channelJID); err != nil {
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
