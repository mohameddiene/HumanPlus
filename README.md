# HUMAN+ — PWA + Supabase Auth & Admin

## Ce que contient cette version
- Compte client : inscription, connexion, déconnexion, réinitialisation par e-mail.
- Synchronisation cloud des séances, habitudes, hydratation, langue et historique H+ Outdoor après connexion.
- Espace admin masqué par défaut et accessible uniquement aux rôles `owner` et `moderator`.
- Le compte `lebusinessman008@gmail.com` reçoit automatiquement le rôle `owner` lors de son inscription Supabase. Si le compte existe déjà, le SQL attribue aussi le rôle.
- Le propriétaire peut autoriser un modérateur existant par e-mail depuis l'administration.
- Zone « Superviser » réservée aux rôles owner/moderator, avec graphiques pour comptes, modules, Outdoor, abonnements et revenus.

## Configuration obligatoire
Cette archive est un kit d'intégration prêt à configurer, pas un backend déjà connecté. Il faut créer ton propre projet Supabase.

1. Crée un projet sur https://supabase.com/.
2. Dans Supabase > SQL Editor, exécute entièrement `supabase-schema.sql`.
3. Dans Project Settings > API, copie l'URL du projet et la clé publique `anon` (ou publishable key).
4. Remplace les deux valeurs dans `supabase-config.js`.
   - `HUMAN_PLUS_SUPABASE_URL`: URL `https://....supabase.co`
   - `HUMAN_PLUS_SUPABASE_ANON_KEY`: clé publique anon/publishable.
   - Ne mets JAMAIS la clé `service_role` dans le site, le ZIP, GitHub ou le navigateur.
5. Dans Authentication > URL Configuration, ajoute l'URL de ton site dans Site URL et Redirect URLs.
6. Déploie le dossier sur Vercel ou un hébergeur HTTPS.
7. Inscris-toi avec `lebusinessman008@gmail.com`, confirme l'e-mail si la confirmation est activée, puis connecte-toi. Tu seras automatiquement dirigé vers l'administration.
8. Connecte-toi avec le compte propriétaire. La page d’accueil reste ton espace personnel ; le lien « Superviser » apparaît dans la navigation.
9. Pour autoriser un modérateur : la personne doit d’abord créer son compte. Ensuite, depuis « Superviser », saisis l’adresse e-mail de ce compte.

## Sécurité et limites à connaître
- L'administration n'est pas présente dans la navigation publique. Le rôle est vérifié dans Supabase et protégé par RLS ; masquer un écran seul n'est jamais une sécurité suffisante.
- Le rôle `owner` est attribué par trigger SQL à l'adresse exacte `lebusinessman008@gmail.com`. Le client ne peut pas modifier son rôle.
- Les mots de passe ne sont jamais lisibles dans l'administration.
- Les événements de connexion du tableau de bord sont ceux que l'application enregistre lors des connexions/session starts. Pour une journalisation exhaustive, utiliser en plus les journaux d'authentification Supabase ou un webhook serveur.
- Le bouton Installer est toujours visible. Chrome/Android affiche la demande d’installation lorsqu’il expose l’événement PWA ; sinon le bouton indique comment passer par le menu du navigateur. Les installations PWA ne sont pas détectables sur tous les navigateurs. Le compteur représente uniquement les événements `appinstalled` reçus, pas toutes les installations réelles ni tous les appareils.
- Les abonnements et revenus sont en lecture seule dans le panneau. Cette version ne facture personne. Ils doivent être alimentés par un prestataire de paiement via une Edge Function/webhook vérifié. Ne jamais écrire un paiement confirmé depuis le navigateur.
- Le compte propriétaire ne doit pas être partagé. Active la confirmation e-mail et une politique de mot de passe solide dans Supabase.
- Les données des modules sont sauvegardées dans le compte connecté via Supabase. Sans connexion, elles restent locales sur l’appareil. Les anciennes données locales du prototype sont envoyées au cloud à la première connexion si aucun jeu de données cloud n’existe.

## Lancement local
L'authentification Supabase nécessite un serveur local, pas l'ouverture directe du fichier HTML.
- VS Code + Live Server, ou
- `python -m http.server 8000`, puis ouvrir `http://localhost:8000`.

La PWA nécessite HTTPS en production (localhost est accepté pour le développement).


## Version H+ Outdoor + profil
- Nouveau module H+ Outdoor : course, vélo, marche et marche rapide avec GPS en direct, distance, durée, allure, vitesse, tracé et historique local.
- Le suivi nécessite HTTPS et l'autorisation de localisation précise. La PWA tente d'utiliser Screen Wake Lock pour éviter que l'écran s'éteigne. Un navigateur mobile peut toutefois suspendre la géolocalisation lorsque l'écran est réellement verrouillé ou que l'application passe en arrière-plan. Pour un suivi fiable écran verrouillé, une application Android native sera nécessaire.
- Photo de profil : choisir une image JPG/PNG/WebP de 5 Mo maximum après connexion.
- Le bouton de réinitialisation de démonstration a été retiré. La déconnexion vide les champs du formulaire.

## Mise à jour Supabase
Dans Supabase > SQL Editor, exécuter le fichier `supabase-schema.sql` complet. Si le SQL échoue, ne pas relancer en boucle : conserver le message exact de l'erreur et le numéro de ligne pour diagnostic. Le bucket `profile-photos` est créé par le script. L'utilisateur propriétaire doit s'être inscrit avec l'adresse propriétaire configurée dans le script pour recevoir automatiquement le rôle owner.

- Le centre Notifications propose un panneau de notifications et demande l’autorisation du navigateur. Les notifications push à distance (serveur/VAPID) ne sont pas encore configurées.
- Le GPS Outdoor fonctionne pendant que l’application reste active au premier plan. Une PWA ne garantit pas le suivi quand l’écran est verrouillé ou le navigateur suspendu.
