package main

import (
	"context"
	"fmt"
	"os"
	"sync/atomic"

	_ "github.com/lib/pq"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
)

// Connexion et gestion de la session WhatsApp via whatsmeow (voir plan-houville.md, section H).
// Bascule Baileys -> whatsmeow (28/08/2026) : pairing code ET QR cassés côté Baileys par un bug
// amont non résolu (WhiskeySockets/Baileys#2364), reproduit identiquement sur AlwaysData et en
// local. whatsmeow est une implémentation indépendante du même protocole, en Go — pas concernée
// par ce bug précis. Diffusion à sens unique uniquement : aucun handler de message entrant,
// aucune réponse automatique aux habitants.
//
// Persistance : contrairement à Baileys où on gérait nous-mêmes un blob JSON dans Supabase,
// whatsmeow gère sa propre persistance via une connexion Postgres directe (sqlstore, schéma
// géré automatiquement — tables whatsmeow_*). Nécessite SUPABASE_DB_PASSWORD (mot de passe
// direct de la base, pas la clé API REST) — voir .env.example. RLS activée sans policy sur
// toutes les tables whatsmeow_* (accès direct Postgres uniquement, jamais via l'API REST
// publique — vérifié empiriquement, voir plan-houville.md). La session vit dans cette base,
// donc appairer depuis n'importe quelle machine (ex. en local pour le tout premier appairage)
// suffit à ce que le worker déployé la retrouve ensuite, sans aucun transfert manuel.

var connected atomic.Bool

func isWhatsAppConnected() bool {
	return connected.Load()
}

// buildPostgresDSN construit le DSN whatsmeow à partir de SUPABASE_URL (https://<ref>.supabase.co)
// plutôt que d'exiger une variable d'hôte séparée.
func buildPostgresDSN() (string, error) {
	dbPassword := os.Getenv("SUPABASE_DB_PASSWORD")
	if dbPassword == "" {
		return "", fmt.Errorf("SUPABASE_DB_PASSWORD doit être défini dans l'environnement")
	}
	ref, err := supabaseProjectRef()
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("postgres://postgres:%s@db.%s.supabase.co:5432/postgres?sslmode=require", dbPassword, ref), nil
}

// connectWhatsApp se connecte au compte WhatsApp déjà appairé, ou lance le flux d'appairage QR
// si aucun appareil n'est encore enregistré dans le store Postgres. Bloque jusqu'à connexion
// réussie dans le cas "pas encore appairé" (attend le scan) — comportement voulu uniquement au
// tout premier démarrage ; les redémarrages suivants trouvent le device déjà enregistré et se
// reconnectent normalement sans attendre.
func connectWhatsApp(ctx context.Context) (*whatsmeow.Client, error) {
	dsn, err := buildPostgresDSN()
	if err != nil {
		return nil, err
	}

	container, err := sqlstore.New(ctx, "postgres", dsn, waLog.Noop)
	if err != nil {
		return nil, fmt.Errorf("connexion store whatsmeow : %w", err)
	}

	deviceStore, err := container.GetFirstDevice(ctx)
	if err != nil {
		return nil, fmt.Errorf("lecture device whatsmeow : %w", err)
	}

	client := whatsmeow.NewClient(deviceStore, waLog.Noop)

	client.AddEventHandler(func(evt any) {
		switch evt.(type) {
		case *events.Connected:
			connected.Store(true)
			fmt.Println("WhatsApp connecté.")
		case *events.Disconnected:
			connected.Store(false)
			fmt.Println("WhatsApp déconnecté.")
		case *events.LoggedOut:
			connected.Store(false)
			fmt.Println("WhatsApp déconnecté : session invalidée, repairing nécessaire (supprimer le device en base et relancer).")
		}
	})

	if client.Store.ID == nil {
		qrChan, _ := client.GetQRChannel(ctx)
		if err := client.Connect(); err != nil {
			return nil, fmt.Errorf("connexion whatsmeow (appairage) : %w", err)
		}
		for evt := range qrChan {
			switch evt.Event {
			case "code":
				fmt.Printf("QR_CODE_DATA:%s\n", evt.Code)
			case "success":
				fmt.Println("Appairage réussi.")
			case "timeout":
				return nil, fmt.Errorf("appairage : délai dépassé, relancer")
			default:
				fmt.Println("Événement d'appairage :", evt.Event)
			}
		}
		return client, nil
	}

	if err := client.Connect(); err != nil {
		return nil, fmt.Errorf("connexion whatsmeow : %w", err)
	}
	return client, nil
}
