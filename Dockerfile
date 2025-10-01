# Étape 1 : Build
FROM node:24-slim AS build

WORKDIR /app

# Copie ciblée pour envoyer package.json + lock file en priorité
COPY package*.json ./

# Installer les dépendances de prod ET de dev
RUN npm ci

# Copier le code source
COPY . .

# Compiler le code TypeScript (si applicable)
RUN npm run build

# Étape 2 : Runtime minimal
FROM node:20-slim

WORKDIR /

# Copier uniquement le build/dist et fichiers nécessaires, pas tout le projet
COPY --from=build /app .
COPY --from=build /app/package*.json .
# Installer uniquement les dépendances de prod
RUN npm ci --only=production

EXPOSE 8080

# Entrée du serveur (adapte selon ton fichier d’entrée réel)
CMD ["node", "dist/index.js"]
