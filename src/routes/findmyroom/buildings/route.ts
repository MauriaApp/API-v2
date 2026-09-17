import { FastifyInstance } from "fastify";
import Sentry from "@sentry/node";
import { getBuildings } from "../utils/findmyroom";

export async function buildingsRoute(fastify: FastifyInstance) {
    fastify.get(
        "/findmyroom/buildings",
        {
            schema: {
                description:
                    "Disponibilité des salles par bâtiment, proxifiée depuis " +
                    "findmyroom.junia.com/api/batiments-stats (pas de CORS côté source).",
                response: {
                    200: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                code: { type: "string" },
                                nom: { type: "string" },
                                dispo: { type: "number" },
                                total: { type: "number" },
                                pourcentage: { type: "number" },
                            },
                            required: [
                                "code",
                                "nom",
                                "dispo",
                                "total",
                                "pourcentage",
                            ],
                        },
                    },
                    500: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            error: { type: "string" },
                        },
                        required: ["success", "error"],
                    },
                },
            },
        },
        async (request, reply) => {
            try {
                return await getBuildings();
            } catch (error) {
                Sentry.captureException(error);
                return reply.status(500).send({
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                });
            }
        }
    );
}
