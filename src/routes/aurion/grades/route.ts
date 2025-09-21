import { FastifyInstance } from "fastify";
import { SessionManager } from "../utils/session-manager";
import { IdRequest } from "../../../types/aurion";
import { AurionGrades } from "./grades";

export async function gradesRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: IdRequest }>(
        "/aurion/grades",
        {
            schema: {
                body: {
                    type: "object",
                    properties: {
                        email: { type: "string" },
                        password: { type: "string" },
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
                                        date: { type: "string" },
                                        code: { type: "string" },
                                        name: { type: "string" },
                                        grade: { type: "string" },
                                        coefficient: { type: "string" },
                                        average: { type: "string" },
                                        min: { type: "string" },
                                        max: { type: "string" },
                                        median: { type: "string" },
                                        standardDeviation: { type: "string" },
                                        comment: { type: "string" },
                                    },
                                },
                            },
                        },
                    },
                    500: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            error: { type: "string" },
                        },
                    },
                },
            },
        },
        async (request, reply) => {
            const sessionManager = new SessionManager();
            const aurionClient = new AurionGrades(sessionManager);

            try {
                const grades = await aurionClient.getAllGrades(
                    request.body.email,
                    request.body.password
                );
                return { success: true, data: grades };
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
