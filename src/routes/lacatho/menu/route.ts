import { FastifyInstance } from "fastify";
import Sentry from "@sentry/node";
import { getDailyMenu } from "./menu";

export async function menuRoute(fastify: FastifyInstance) {
    fastify.get(
        "/lacatho/menu",
        {
            schema: {
                description:
                    "Menu du jour des restaurants universitaires de la Catho de Lille, " +
                    "extrait du PDF publié sur all-lacatho.fr/fr/menu-jour. " +
                    "Une entrée par restaurant (Food Corner, Globe Trotter, Green, Tradi, Sandwicherie).",
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
                return await getDailyMenu();
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
