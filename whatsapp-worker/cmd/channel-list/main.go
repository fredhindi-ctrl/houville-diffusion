package main

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// Lecture seule : liste les derniers messages que les serveurs WhatsApp gardent sur le Channel.
// Usage : go run ./cmd/channel-list   (SUPABASE_URL, SUPABASE_DB_PASSWORD, WHATSAPP_CHANNEL_JID)

func main() {
	channel, err := types.ParseJID(os.Getenv("WHATSAPP_CHANNEL_JID"))
	if err != nil || channel.Server != types.NewsletterServer {
		fmt.Println("WHATSAPP_CHANNEL_JID doit être un Channel (...@newsletter)")
		os.Exit(1)
	}
	ctx := context.Background()
	ref, _, _ := strings.Cut(strings.TrimPrefix(os.Getenv("SUPABASE_URL"), "https://"), ".supabase.co")
	dsn := fmt.Sprintf("postgres://postgres:%s@db.%s.supabase.co:5432/postgres?sslmode=require", os.Getenv("SUPABASE_DB_PASSWORD"), ref)
	container, err := sqlstore.New(ctx, "postgres", dsn, waLog.Noop)
	if err != nil {
		fmt.Println("Connexion store :", err)
		os.Exit(1)
	}
	device, err := container.GetFirstDevice(ctx)
	if err != nil || device.ID == nil {
		fmt.Println("Aucun appareil appairé :", err)
		os.Exit(1)
	}
	client := whatsmeow.NewClient(device, waLog.Noop)
	if err := client.Connect(); err != nil {
		fmt.Println("Connexion WhatsApp :", err)
		os.Exit(1)
	}
	defer client.Disconnect()
	time.Sleep(3 * time.Second)

	msgs, err := client.GetNewsletterMessages(ctx, channel, &whatsmeow.GetNewsletterMessagesParams{Count: 20})
	if err != nil {
		fmt.Println("Lecture du Channel :", err)
		os.Exit(1)
	}
	fmt.Println(len(msgs), "message(s) sur le Channel :")
	for _, m := range msgs {
		text := ""
		if m.Message != nil {
			text = m.Message.GetConversation()
			if text == "" && m.Message.GetExtendedTextMessage() != nil {
				text = m.Message.GetExtendedTextMessage().GetText()
			}
		}
		text = strings.ReplaceAll(text, "\n", " ")
		if len([]rune(text)) > 70 {
			text = string([]rune(text)[:70]) + "…"
		}
		fmt.Printf("  %s  %s  type=%s  %s\n", m.Timestamp.Local().Format("02/01 15:04"), m.MessageID, m.Type, text)
	}
}
