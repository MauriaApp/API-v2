import { FastifyInstance } from "fastify";
import { PrintSessionManager } from "../utils/session-manager";
import { PrintClient } from "../utils/print";
import { IdRequest } from "../../../types/aurion";
import Sentry from "@sentry/node";

export async function balanceRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: IdRequest }>(
        "/print/balance",
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
                                type: "object",
                                properties: {
                                    personal: { type: "number" },
                                    bonus: { type: "number" },
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
            const sessionManager = new PrintSessionManager();
            const printClient = new PrintClient(sessionManager);

            try {
                await sessionManager.login(
                    request.body.email,
                    request.body.password
                );
                const balance = await printClient.getBalance();
                return { success: true, data: balance };
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
