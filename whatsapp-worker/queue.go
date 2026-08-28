package main

import (
	"context"
	"fmt"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
)

// Poll messages_a_envoyer (statut=en_attente), poste dans le groupe WhatsApp, marque comme
// envoyé. Diffusion à sens unique uniquement (voir plan-houville.md, section H) : aucune
// lecture de message entrant ici, juste l'envoi des messages générés par vercel-app.
func pollAndSend(client *whatsmeow.Client, sb *supabaseClient, groupJID string) error {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return fmt.Errorf("WHATSAPP_GROUP_JID invalide : %w", err)
	}

	messages, err := sb.pendingMessages()
	if err != nil {
		return fmt.Errorf("lecture messages_a_envoyer : %w", err)
	}

	for _, m := range messages {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		_, err := client.SendMessage(ctx, jid, &waE2E.Message{
			Conversation: &m.Contenu,
		})
		cancel()
		if err != nil {
			// Message laissé en_attente : sera retenté au prochain passage.
			fmt.Printf("Échec d'envoi du message %d : %v\n", m.ID, err)
			continue
		}
		if err := sb.markSent(m.ID); err != nil {
			fmt.Printf("Message %d envoyé mais marquage échoué : %v\n", m.ID, err)
		} else {
			fmt.Printf("Message %d envoyé et marqué.\n", m.ID)
		}
	}
	return nil
}
