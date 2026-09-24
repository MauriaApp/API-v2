import { FastifyInstance } from "fastify";
import { getJuniaStatus } from "./status";

export async function statusRoute(fastify: FastifyInstance) {
  fastify.get(
    "/badjunia/status",
    {
      schema: {
        description:
          "Statut d'Aurion et du Wi-Fi Junia, relayé depuis BadJunia (darklouis.dev). " +
          "Un service n'est marqué en panne que si son dernier contrôle a échoué ; " +
          "`*Since` donne le début de l'incident en cours (ISO 8601). " +
          "`aurionTimes` donne le temps de réponse (ms) mesuré par BadJunia pour chaque " +
          "page Aurion (null si inconnu), à utiliser comme durée attendue des fetchs.",
        response: {
          200: {
            type: "object",
            properties: {
              aurionDown: { type: "boolean" },
              aurionSince: { type: "string", nullable: true },
              wifiDown: { type: "boolean" },
              wifiSince: { type: "string", nullable: true },
              aurionTimes: {
                type: "object",
                properties: {
                  login: { type: "integer", nullable: true },
                  home: { type: "integer", nullable: true },
                  grades: { type: "integer", nullable: true },
                  planning: { type: "integer", nullable: true },
                  absences: { type: "integer", nullable: true },
                  documents: { type: "integer", nullable: true },
                },
                required: [
                  "login",
                  "home",
                  "grades",
                  "planning",
                  "absences",
                  "documents",
                ],
              },
            },
            required: [
              "aurionDown",
              "aurionSince",
              "wifiDown",
              "wifiSince",
              "aurionTimes",
            ],
          },
        },
      },
    },
    async () => getJuniaStatus(),
  );
}
