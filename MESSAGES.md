# Gabarits des messages de diffusion WhatsApp

Ce document décrit les gabarits **actuellement utilisés** par
`vercel-app/lib/scraper/whatsapp-templates.ts`.

Formatage WhatsApp : `*gras*`, `_italique_`. Les URL sont laissées en clair afin d'être
cliquables dans WhatsApp.

Chaque nouveauté crée une ligne distincte dans `messages_a_envoyer`.

## Compte rendu du conseil municipal

Le message ne reproduit pas le document complet. Il affiche au maximum quelques décisions
extraites de façon déterministe du texte OCR, puis renvoie vers le PDF officiel.

Les verbes de délibération reconnus par `extraireTopics` sont notamment :
`DÉCIDE`, `AUTORISE`, `APPROUVE`, `ADOPTE`, `VOTE`, `ACCEPTE`, `REFUSE`, `CHARGE`,
`DÉSIGNE`, `FIXE`.

Aucune reformulation générative n'est effectuée : le texte extrait est gardé aussi proche que
possible du document OCR.

Gabarit courant :

```text
📋 *COMPTE RENDU DU CONSEIL MUNICIPAL*
_Conseil municipal du {date en toutes lettres}_

*Points abordés :*
• {décision 1}
• {décision 2}
...

📄 Compte rendu complet (PDF) :
{url_pdf}

🦉 Pour rechercher un mot-clé dans les archives, direction Œdicnème :
{WEBAPP_URL}
```

Si aucune décision n'est détectée, la section `Points abordés` est simplement omise.

## Actualité

Gabarit courant :

```text
📢 *Nouvelle actualité*

*{titre}*
{extrait éventuel, tronqué si nécessaire}

🔗 En savoir plus :
{url}

🦉 Recherche dans les archives : Œdicnème
{WEBAPP_URL}
```

Si `WEBAPP_URL` n'est pas défini, le code omet l'URL plutôt que d'envoyer un lien cassé.

## Source de vérité du comportement

Le comportement effectif est dans :

`vercel-app/lib/scraper/whatsapp-templates.ts`

Ce fichier de documentation ne doit plus contenir de référence à Telegram, BotFather,
`@oedicneme_bot` ou `t.me` : Telegram a été abandonné et n'appartient plus à l'architecture.
