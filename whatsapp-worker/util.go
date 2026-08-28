package main

import (
	"fmt"
	"os"
	"strings"
)

// supabaseProjectRef extrait la référence de projet depuis SUPABASE_URL
// (https://<ref>.supabase.co) — évite de dupliquer cette info dans une variable séparée.
func supabaseProjectRef() (string, error) {
	url := os.Getenv("SUPABASE_URL")
	url = strings.TrimPrefix(url, "https://")
	url = strings.TrimPrefix(url, "http://")
	ref, _, ok := strings.Cut(url, ".supabase.co")
	if !ok || ref == "" {
		return "", fmt.Errorf("SUPABASE_URL invalide ou absent (attendu https://<ref>.supabase.co)")
	}
	return ref, nil
}
