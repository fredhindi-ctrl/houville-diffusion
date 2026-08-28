# Gabarits des messages de diffusion WhatsApp

Formatage WhatsApp (pas du Markdown standard) : `*gras*`, `_italique_`, `~barré~`,
` ```monospace``` `. Pas de titres, pas de tableaux, pas de liens `[texte](url)` — une URL
seule sur sa ligne devient automatiquement cliquable.

Chaque message correspond à **une ligne `messages_a_envoyer`**, donc à **une seule nouveauté**
(pas de digest groupé) — conforme au plan. Le rappel Telegram est systématique sur chaque
message, pour que les habitants le découvrent naturellement au fil des diffusions.

## Nouveau compte rendu

Le message ne contient pas le texte intégral du compte rendu (risque de fautes d'OCR présentées
comme si elles étaient le document officiel — voir discussion plus bas), mais un **"quick
insight"** : les décisions principales, extraites automatiquement du texte OCR, pour donner un
aperçu immédiat sans ouvrir le PDF. Le PDF reste la source de référence, toujours lié en bas.

**Extraction des décisions (`extraireTopics`)** : dans les comptes rendus de conseil municipal,
les décisions actées suivent une formule quasi systématique — une phrase commençant par un verbe
de délibération (`DÉCIDE`, `AUTORISE`, `APPROUVE`, `ADOPTE`, `VOTE`, `ACCEPTE`, `REFUSE`,
`CHARGE`, `DÉSIGNE`, `FIXE`). On récupère ces phrases après avoir reflow le texte OCR (les
retours à la ligne de l'OCR suivent le découpage visuel du scan, pas les phrases). **Testé sur un
vrai compte rendu** (20 août 2026) : extraction propre des deux décisions réelles du document,
sans bruit — voir résultat ci-dessous.

**Gabarit :**

```
📋 *COMPTE RENDU DU CONSEIL MUNICIPAL*
_{date_conseil en toutes lettres}_

*Points abordés :*
{liste à puces des décisions extraites, 3-5 max}

📄 Compte rendu complet (PDF) :
{url_pdf}

🔍 Pour rechercher un mot-clé dans les anciens comptes rendus, direction Telegram :
🦉 @oedicneme_bot
https://t.me/oedicneme_bot
```

**Rendu concret (exemple réel, compte rendu du 20 août 2026 — extraction testée ci-dessus) :**

> 📋 **COMPTE RENDU DU CONSEIL MUNICIPAL**
> *Conseil municipal du 20 août 2026*
>
> **Points abordés :**
> • DÉCIDE d'abroger et de remplacer la précédente délibération n°12-2025 fixant la tarification sur l'année civile 2026 à compter du 1er Septembre 2026.
> • DÉCIDE d'adopter les tarifs forfaitaires ci-dessus pour la saison de 10 mois, allant du 01/09/2026 au 30/06/2027.
>
> 📄 Compte rendu complet (PDF) :
> http://cdn1_4.reseaudespetitescommunes.fr/cities/1052/documents/0badmsijtwx59w9.pdf
>
> 🔍 Pour rechercher un mot-clé dans les anciens comptes rendus, direction Telegram :
> 🦉 @oedicneme_bot
> https://t.me/oedicneme_bot

*(Décidé : on garde le verbe brut extrait tel quel — "DÉCIDE d'abroger..." — plutôt que de
reformuler automatiquement. Plus fidèle au texte officiel, pas de risque de déformer le sens, et
plus simple/fiable à implémenter que de la reformulation.)*

**Cas limite à gérer** : si `extraireTopics` ne trouve aucune décision formulée ainsi (compte
rendu sans vote formel, ou formulation différente d'une séance à l'autre), le message retombe sur
le gabarit simple (titre + date + lien PDF + rappel Telegram), sans section "Points abordés"
vide.

## Nouvelle actualité

**Gabarit :**

```
📢 *Nouvelle actualité*

*{titre}*
{extrait, tronqué à ~200 caractères si besoin}

🔗 En savoir plus :
{url}

🔍 Recherche dans les comptes rendus : 🦉 @oedicneme_bot
https://t.me/oedicneme_bot
```

**Rendu concret (exemple réel) :**

> 📢 **Nouvelle actualité**
>
> **FETE PATRONALE 2026 - 26 ET 27 SEPTEMBRE 2026**
> FETE PATRONALE 2026 - 26 ET 27 SEPTEMBRE 2026
>
> 🔗 En savoir plus :
> http://www.houvillelabranche.fr/fr/actualite/99718/fete-patronale-2026-26-27-septembre-2026
>
> 🔍 Recherche dans les comptes rendus : 🦉 @oedicneme_bot
> https://t.me/oedicneme_bot

## Notes d'implémentation

- `date_conseil` stocké en `date` SQL (`YYYY-MM-DD`) → à reformater en français lisible
  ("20 août 2026") au moment de générer le message, pas en base.
- `extrait` peut être `null` (actualité sans texte) → dans ce cas, sauter la ligne d'extrait
  plutôt que d'afficher "null" ou une ligne vide disgracieuse.
- Un extrait déjà tronqué par le site se termine souvent par "..." (ex. l'exemple
  "ANNULATION SOIREE...") — pas besoin de re-tronquer si la longueur est déjà raisonnable ;
  ne couper qu'au-delà de ~200 caractères pour éviter un message à rallonge.
- Ces gabarits seront implémentés comme deux fonctions pures dans
  `vercel-app/lib/scraper/whatsapp-templates.ts` (ex. `formatMessageCompteRendu(cr, texteOcr)`,
  `formatMessageActualite(actu)`), appelées par `api/cron/scrape.ts` au moment d'insérer
  dans `messages_a_envoyer`.
- `extraireTopics(texteOcr)` vit dans le même fichier (ou `whatsapp-templates.ts` importe
  depuis `pdf.ts`) — logique testée manuellement ci-dessus, à couvrir par un vrai test
  avant de la considérer fiable en production (cf. `verify` habituel du projet).
- Décidé : verbe de délibération gardé tel quel en tête de puce ("DÉCIDE d'abroger..."), pas
  de reformulation automatique.
