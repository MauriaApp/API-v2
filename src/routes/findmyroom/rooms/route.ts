import { FastifyInstance } from "fastify";
import Sentry from "@sentry/node";
import { getRoomsForBuilding } from "../utils/findmyroom";

// Building codes are things like "IC2" or "PR_39BV": letters, digits,
// underscores. Reject anything else before it reaches the upstream URL.
const VALID_BUILDING_CODE = /^[A-Za-z0-9_]+$/;

export async function roomsRoute(fastify: FastifyInstance) {
    fastify.get<{ Params: { building: string } }>(
        "/findmyroom/rooms/:building",
        {
            schema: {
                description:
                    "Salles d'un bâtiment et leur disponibilité, proxifiée depuis " +
                    "findmyroom.junia.com/api/salles/{batiment} (pas de CORS côté source).",
                params: {
                    type: "object",
                    properties: {
                        building: { type: "string" },
                    },
                    required: ["building"],
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            date: { type: "string" },
                            heure: { type: "string" },
                            salles: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        salle: { type: "string" },
                                        statut: { type: "string" },
                                        capacite: {
                                            type: "number",
                                            nullable: true,
                                        },
                                        type_salle: {
                                            type: "string",
                                            nullable: true,
                                        },
                                        libre_jusqua: {
                                            type: "string",
                                            nullable: true,
                                        },
                                        libre_jusqua_en: {
                                            type: "string",
                                            nullable: true,
                                        },
                                        duree_max: {
                                            type: "string",
                                            nullable: true,
                                        },
                                        duree_max_en: {
                                            type: "string",
                                            nullable: true,
                                        },
                                    },
                                    required: ["salle", "statut"],
                                },
                            },
                        },
                        required: ["date", "heure", "salles"],
                    },
                    400: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            error: { type: "string" },
                        },
                        required: ["success", "error"],
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
            const { building } = request.params;
            if (!VALID_BUILDING_CODE.test(building)) {
                return reply.status(400).send({
                    success: false,
                    error: "Invalid building code",
                });
            }
            try {
                return await getRoomsForBuilding(building);
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
