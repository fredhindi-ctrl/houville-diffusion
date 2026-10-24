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
//
// channelJID (facultatif, WHATSAPP_CHANNEL_JID) : Channel WhatsApp qui reçoit une copie de
// chaque message, juste après le groupe. Le groupe reste la référence : si l'envoi au Channel
// échoue, le message est quand même marqué envoyé (pas de retry, sinon doublon dans le groupe).
func pollAndSend(client *whatsmeow.Client, sb *supabaseClient, groupJID, channelJID string) error {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return fmt.Errorf("WHATSAPP_GROUP_JID invalide : %w", err)
	}

	var channel types.JID
	if channelJID != "" {
		channel, err = types.ParseJID(channelJID)
		if err != nil {
			return fmt.Errorf("WHATSAPP_CHANNEL_JID invalide : %w", err)
		}
		if channel.Server != types.NewsletterServer {
			return fmt.Errorf("WHATSAPP_CHANNEL_JID n'est pas un Channel (attendu ...@newsletter) : %s", channelJID)
		}
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
		if !channel.IsEmpty() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			_, err := client.SendMessage(ctx, channel, &waE2E.Message{
				Conversation: &m.Contenu,
			})
			cancel()
			if err != nil {
				fmt.Printf("Message %d envoyé au groupe mais échec sur le Channel (non bloquant) : %v\n", m.ID, err)
			}
		}
		if err := sendEmailCopy(m.Contenu); err != nil {
			// Non bloquant : le message est déjà parti sur WhatsApp, l'email n'est qu'une
			// copie de confort.
			fmt.Printf("Copie email du message %d échouée (non bloquant) : %v\n", m.ID, err)
		}
		if err := sb.markSent(m.ID); err != nil {
			fmt.Printf("Message %d envoyé mais marquage échoué : %v\n", m.ID, err)
		} else {
			fmt.Printf("Message %d envoyé et marqué.\n", m.ID)
		}
	}
	return nil
}
