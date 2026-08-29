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
	waLog "go.mau.fi/whatsmeow/util/log"
)

// Utilitaire ponctuel : liste les groupes WhatsApp dont le compte déjà appairé est membre,
// pour trouver le JID à mettre dans WHATSAPP_GROUP_JID. Réutilise la même session Postgres
// que le worker (voir whatsapp-worker/whatsapp.go) — ne demande pas de nouveau QR si un
// appareil est déjà enregistré (package séparé, pas d'import possible depuis le "main" racine).

func main() {
	ctx := context.Background()

	dbPassword := os.Getenv("SUPABASE_DB_PASSWORD")
	supabaseURL := os.Getenv("SUPABASE_URL")
	if dbPassword == "" || supabaseURL == "" {
		fmt.Println("SUPABASE_URL et SUPABASE_DB_PASSWORD doivent être définis")
		os.Exit(1)
	}
	ref := strings.TrimPrefix(strings.TrimPrefix(supabaseURL, "https://"), "http://")
	ref, _, ok := strings.Cut(ref, ".supabase.co")
	if !ok || ref == "" {
		fmt.Println("SUPABASE_URL invalide (attendu https://<ref>.supabase.co)")
		os.Exit(1)
	}
	dsn := fmt.Sprintf("postgres://postgres:%s@db.%s.supabase.co:5432/postgres?sslmode=require", dbPassword, ref)

	container, err := sqlstore.New(ctx, "postgres", dsn, waLog.Noop)
	if err != nil {
		fmt.Println("Erreur connexion store :", err)
		os.Exit(1)
	}

	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		fmt.Println("Erreur lecture device :", err)
		os.Exit(1)
	}
	if deviceStore.ID == nil {
		fmt.Println("Aucun appareil appairé.")
		os.Exit(1)
	}

	client := whatsmeow.NewClient(deviceStore, waLog.Noop)
	if err := client.Connect(); err != nil {
		fmt.Println("Erreur connexion :", err)
		os.Exit(1)
	}
	defer client.Disconnect()

	// Laisse le temps à la connexion de s'établir avant d'appeler l'API groupes.
	time.Sleep(3 * time.Second)

	groups, err := client.GetJoinedGroups(ctx)
	if err != nil {
		fmt.Println("Erreur récupération groupes :", err)
		os.Exit(1)
	}
	fmt.Println("Groupes trouvés :")
	for _, g := range groups {
		fmt.Printf("  %s  —  %s\n", g.JID.String(), g.Name)
	}
}
