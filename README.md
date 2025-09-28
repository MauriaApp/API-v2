# Mauria API v2

API Fastify en TypeScript qui fait l'interface entre Aurion et les contenus Supabase pour l'écosystème Mauria. Toutes les routes sont documentées via Swagger et exposées aux applications web et mobiles.

## Technologies utilisées

- Fastify `v5` et @fastify/swagger pour l'exposition REST + documentation OpenAPI
- TypeScript `v5.9` avec `ts-node-dev` pour le développement à chaud
- Got `v14` et Tough Cookie pour la gestion fine des sessions Aurion
- @supabase/supabase-js `v2` pour accéder aux contenus dynamiques
- @fastify/cors pour l'accès cross-origin côté Webapp
- Docker (multi-stage build) et Fly.io pour le déploiement automatisé
- GitHub Actions (`.github/workflows/fly-deploy.yml`) pour la livraison continue

## Structure du projet

- `src/index.ts` : point d'entrée Fastify, configuration CORS, Swagger et enregistrement des routes
- `src/routes/aurion` : logique de scraping/authentification Aurion (login, notes, planning, absences)
- `src/routes/supa-data` : routes exposant les données Supabase (associations, messages, outils, changelog)
- `src/types` : types partagés pour les payloads des routes
- `.env.example` : gabarit des variables d'environnement nécessaires
- `Dockerfile` + `.dockerignore` : image multi-étape optimisée pour la prod
- `fly.toml` : configuration Fly.io (port 8080, région `cdg`)
- `.github/workflows/fly-deploy.yml` : pipeline de déploiement continu sur Fly.io

## Fonctionnalités

### Intégration Aurion

- Authentification via session Aurion avec gestion des cookies et ViewState PrimeFaces
- Extraction des notes, absences et planning à partir du HTML Aurion (parsing DOM custom)
- Fenêtre temporelle du planning configurable via timestamps millisecondes

### Contenus Supabase

- Lecture des tables `associations`, `messages`, `liens` et `changelogs`
- Construction d'objets prêts à consommer par la Webapp (tri, renommage, enrichissement des URLs d'images Instagram)

### Documentation & DX

- Documentation OpenAPI générée automatiquement disponible sur la racine (`/`) et exportable en JSON via `/json`
- Sélection automatique du fichier d'environnement `.env.dev` quand `ts-node-dev` est utilisé

## Routes principales

- `POST /aurion/login` : vérifie les identifiants Aurion et initialise une session (corps `{ "email", "password" }`)
- `POST /aurion/grades` : retourne la liste des notes formatée (corps `{ "email", "password" }`)
- `POST /aurion/planning` : renvoie les événements sur une plage optionnelle (timestamps en millisecondes `startTimestamp`, `endTimestamp`)
- `POST /aurion/absences` : récupère les absences et retards (corps `{ "email", "password" }`)
- `GET /associations` : liste des associations (Nom, description, contact, image)
- `GET /messages` : message important à afficher sur la Webapp
- `GET /tools` : liens utiles (titre bouton, description, URL)
- `GET /updates` : changelog trié par version

Tous les schémas de requêtes/réponses sont visibles directement dans Swagger.

## Variables d'environnement

Créez un fichier `.env` (ou `.env.dev` pour l'exécution avec `pnpm dev`) à partir de `.env.example` et renseignez :

- `SUPABASE_URL` : URL du projet Supabase contenant les tables Mauria
- `SUPABASE_KEY` : clé de service (role `service_role` recommandé pour lecture complète)
- `PORT` *(optionnel)* : port d'écoute Fastify (`8080` par défaut)
- `HOST` *(optionnel)* : hôte d'écoute (`0.0.0.0` par défaut, requis pour Docker)

## Installation

### Prérequis

- Node.js `v20+`
- pnpm (recommandé) ou npm
- Accès Supabase configuré (URL + clé)

### Étapes

1. Cloner le dépôt Mauria et se placer dans `API-v2`
2. Copier `.env.example` vers `.env` (et `.env.dev` pour le mode dev) puis renseigner les secrets
3. Installer les dépendances : `pnpm install`
4. Lancer l'API en développement : `pnpm dev`
5. Ouvrir la documentation Swagger sur `http://localhost:8080` et tester une route

## Scripts utiles

- `pnpm dev` : démarrage à chaud via `ts-node-dev` (utilise `.env.dev` si présent)
- `pnpm build` : compilation TypeScript vers `dist/`
- `pnpm start` : exécution du build compilé (`dist/index.js`)

## Déploiement

### Docker

```bash
docker build -t mauria-api .
docker run -d --name mauria-api -p 8080:8080 --env-file .env mauria-api
```

### Fly.io

- Authentifiez-vous : `fly auth login`
- Vérifiez/ajustez `fly.toml` (app `mauria-api`, région `cdg`)
- Déployez : `fly deploy --remote-only`
- Configurez les secrets Supabase : `fly secrets set SUPABASE_URL=... SUPABASE_KEY=...`

Un workflow GitHub Actions (`Fly Deploy`) se charge aussi du déploiement automatiquement à chaque push sur `main` si `FLY_API_TOKEN` est défini.

## Contribution

- Créez une branche depuis `main` et utilisez `pnpm` pour la gestion des dépendances
- Respectez la structure existante des routes (séparation Fastify / services / parsers)
- Ajoutez des schémas Swagger cohérents pour toute nouvelle route
- Vérifiez la compilation avec `pnpm build` et testez les endpoints sensibles avant toute PR

## License

Le projet est destiné à suivre la même licence GNU GPL v3 que les autres applications Mauria. Ajoutez le fichier `LICENSE` si vous publiez l'API séparément.

