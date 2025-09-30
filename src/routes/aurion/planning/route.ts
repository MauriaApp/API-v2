import { FastifyInstance } from "fastify";
import { SessionManager } from "../utils/session-manager";
import { AurionPlanning } from "./planning";
import { PlanningRequest } from "../../../types/aurion";
import Sentry from "@sentry/node";

export async function planningRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: PlanningRequest }>(
        "/aurion/planning",
        {
            schema: {
                description:
                    "Timestamp optionnel. Si pas de temps, start = aujourd'hui, end = aujourd'hui + 2 mois. ATTENTION: Les timestamps sont en MILLISECONDES !",
                body: {
                    type: "object",
                    properties: {
                        email: { type: "string" },
                        password: { type: "string" },
                        startTimestamp: {
                            type: "number",
                            description: "Timestamp en millisecondes",
                        },
                        endTimestamp: {
                            type: "number",
                            description: "Timestamp en millisecondes",
                        },
                    },
                    required: ["email", "password"],
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            data: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        id: { type: "string" },
                                        title: { type: "string" },
                                        start: { type: "string" },
                                        end: { type: "string" },
                                        allDay: { type: "boolean" },
                                        editable: { type: "boolean" },
                                        className: { type: "string" },
                                    },
                                    required: [
                                        "id",
                                        "title",
                                        "start",
                                        "end",
                                        "allDay",
                                        "editable",
                                        "className",
                                    ],
                                },
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
            const sessionManager = new SessionManager();
            const aurionClient = new AurionPlanning(sessionManager);

            const start = request.body.startTimestamp
                ? request.body.startTimestamp
                : Date.now() - 7 * 24 * 60 * 60 * 1000; // -1 semaine

            const end = request.body.endTimestamp
                ? request.body.endTimestamp
                : start + 60 * 24 * 60 * 60 * 1000; // + 2 months

            try {
                const planning = await aurionClient.getPlanning(
                    request.body.email,
                    request.body.password,
                    start,
                    end
                );
                return { success: true, data: planning };
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
