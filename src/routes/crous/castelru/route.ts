import { FastifyInstance } from "fastify";
import Sentry from "@sentry/node";
import { getCastelRuMenu } from "./castelru";

export async function castelruRoute(fastify: FastifyInstance) {
    fastify.get(
        "/crous/castelru/menu",
        {
            schema: {
                description:
                    "Menu du jour du CastelRU (seul restaurant universitaire de Châteauroux), " +
                    "extrait de crous-orleans-tours.fr/restaurant/le-castelru. " +
                    "Renvoie le menu du jour, sinon le prochain jour publié.",
                response: {
                    200: {
                        type: "object",
                        properties: {
                            date: { type: "string", nullable: true },
                            pdfUrl: { type: "string" },
                            restaurants: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        id: { type: "string" },
                                        name: { type: "string" },
                                        page: { type: "number" },
                                        sections: {
                                            type: "array",
                                            items: {
                                                type: "object",
                                                properties: {
                                                    title: { type: "string" },
                                                    items: {
                                                        type: "array",
                                                        items: { type: "string" },
                                                    },
                                                },
                                                required: ["title", "items"],
                                            },
                                        },
                                    },
                                    required: ["id", "name", "page", "sections"],
                                },
                            },
                        },
                        required: ["pdfUrl", "restaurants"],
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
                return await getCastelRuMenu();
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
