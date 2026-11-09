import { FastifyInstance } from "fastify";
import { SessionManager } from "../utils/session-manager";
import { AurionPlanning } from "./planning";
import { EventDetailsRequest } from "../../../types/aurion";
import Sentry from "@sentry/node";

const personSchema = {
    type: "object",
    properties: {
        lastName: { type: "string" },
        firstName: { type: "string" },
    },
    required: ["lastName", "firstName"],
};

export async function eventDetailsRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: EventDetailsRequest }>(
        "/aurion/planning/event",
        {
            schema: {
                description:
                    "Intervenants, apprenants et groupes d'un événement du planning. title, start et end = champs de l'événement renvoyés par /aurion/planning (son `id` n'est pas utilisable : Aurion le régénère à chaque chargement).",
                body: {
                    type: "object",
                    properties: {
                        email: { type: "string" },
                        password: { type: "string" },
                        title: { type: "string" },
                        start: { type: "string" },
                        end: { type: "string" },
                    },
                    required: ["email", "password", "title", "start", "end"],
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            data: {
                                type: "object",
                                properties: {
                                    teachers: {
                                        type: "array",
                                        items: personSchema,
                                    },
                                    students: {
                                        type: "array",
                                        items: personSchema,
                                    },
                                    groups: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                code: { type: "string" },
                                                label: { type: "string" },
                                            },
                                            required: ["code", "label"],
                                        },
                                    },
                                },
                                required: ["teachers", "students", "groups"],
                            },
                        },
                        required: ["success", "data"],
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
            const aurionClient = new AurionPlanning(new SessionManager());
            try {
                const data = await aurionClient.getEventDetails(
                    request.body.email,
                    request.body.password,
                    {
                        title: request.body.title,
                        start: request.body.start,
                        end: request.body.end,
                    }
                );
                return { success: true, data };
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
