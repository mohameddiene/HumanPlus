# Rappels en arrière-plan (notifications push) — guide pas à pas

Objectif : recevoir les rappels même quand HUMAN+ est fermée. À faire une seule fois.
Il te faut : ton compte Supabase, ton dépôt GitHub (déploiement Vercel automatique).

## Étape 1 — Générer les clés
1. Ouvre `https://TON-SITE.vercel.app/outils/generer-cles-vapid.html`
2. Touche **Générer mes clés**.
3. Garde la page ouverte : tu auras besoin de la clé publique et de la clé privée.

## Étape 2 — Mettre la clé publique dans l'appli
1. Dans le fichier `supabase-config.js`, colle la clé **publique** entre les guillemets de `window.HUMAN_PLUS_VAPID_PUBLIC_KEY = ""`.
2. Envoie le fichier sur GitHub (commit). Attends que Vercel affiche **Ready**.

## Étape 3 — Créer les tables (Supabase)
1. Supabase → **SQL Editor** (Éditeur SQL) → **New query** (Nouvelle requête).
2. Colle tout le contenu de `supabase-push.sql`, puis **Run** (Exécuter).

## Étape 4 — Créer la fonction serveur
1. Supabase → **Edge Functions** → **Deploy a new function** (Déployer une nouvelle fonction) → **Via Editor**.
2. Nom de la fonction : `send-reminders` (exactement).
3. Efface le code d'exemple, colle tout le contenu de `supabase/functions/send-reminders/index.ts`, puis **Deploy** (Déployer).
4. Ouvre la fonction `send-reminders`, puis ses réglages (**Details** / Détails) : désactive **Verify JWT** (Vérifier le JWT). La fonction se protège avec son propre mot secret.

## Étape 5 — Ajouter les secrets
Supabase → **Edge Functions** → **Secrets** (Secrets de la fonction) → ajoute 4 secrets :

| Nom | Valeur |
|---|---|
| `VAPID_PUBLIC_KEY` | la clé publique |
| `VAPID_PRIVATE_KEY` | la clé privée |
| `VAPID_SUBJECT` | `mailto:ton-email@exemple.com` |
| `CRON_SECRET` | un mot secret long, inventé par toi |

## Étape 6 — Lancer le planificateur (chaque minute)
1. Ouvre `supabase-cron.sql` et remplace `CHANGE_ME` par **le même** mot que `CRON_SECRET`.
2. Supabase → **SQL Editor** → colle le fichier modifié → **Run**.

## Étape 7 — Activer sur le téléphone
1. Ouvre HUMAN+ (de préférence l'appli installée) et connecte-toi.
2. Onglet **Rappels** → **Activer les rappels en arrière-plan** → **Autoriser**.
3. Touche **Envoyer un test** : une notification doit arriver en quelques secondes.
4. Crée un rappel dans 2 minutes, ferme complètement l'appli, et attends.

## Si ça ne marche pas
- **Pas de notification de test** : Supabase → Edge Functions → `send-reminders` → **Logs** (Journaux). Envoie-moi l'erreur.
- **Rappels en retard ou absents sur certains téléphones (Oppo, Xiaomi, Tecno…)** : dans les paramètres du téléphone, autorise Chrome / HUMAN+ à tourner en arrière-plan et retire l'économie de batterie pour eux.
- **iPhone** : l'appli doit être installée sur l'écran d'accueil (iOS 16.4 minimum).
- Les rappels sont lus depuis ton compte : connecte-toi et laisse la synchronisation se faire (ouvre l'appli après chaque changement de rappel).
