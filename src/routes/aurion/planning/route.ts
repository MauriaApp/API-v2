import { FastifyInstance } from "fastify";
import { SessionManager } from "../utils/session-manager";
import { AurionPlanning } from "./planning";
import { PlanningRequest } from "../../../types/aurion";

export default async function planningRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: PlanningRequest }>(
        "/aurion/planning",
        {
            schema: {
                description:
                    "ATTENTION: Les timestamps sont en MILLISECONDES !",
                body: {
                    type: "object",
                    properties: {
                        email: { type: "string" },
                        password: { type: "string" },
                        startTimestamp: { type: "number" },
                        endTimestamp: { type: "number" },
                    },
                    required: [
                        "email",
                        "password",
                        "startTimestamp",
                        "endTimestamp",
                    ],
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

            try {
                const planning = await aurionClient.getPlanning(
                    request.body.email,
                    request.body.password,
                    request.body.startTimestamp,
                    request.body.endTimestamp
                );
                return { success: true, data: planning };
            } catch (error) {
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
