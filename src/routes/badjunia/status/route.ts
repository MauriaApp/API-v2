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
          "`*Since` donne le début de l'incident en cours (ISO 8601).",
        response: {
          200: {
            type: "object",
            properties: {
              aurionDown: { type: "boolean" },
              aurionSince: { type: "string", nullable: true },
              wifiDown: { type: "boolean" },
              wifiSince: { type: "string", nullable: true },
            },
            required: ["aurionDown", "aurionSince", "wifiDown", "wifiSince"],
          },
        },
      },
    },
    async () => getJuniaStatus(),
  );
}
