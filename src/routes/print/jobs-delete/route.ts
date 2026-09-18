import { FastifyInstance } from "fastify";
import { PrintSessionManager } from "../utils/session-manager";
import { PrintClient } from "../utils/print";
import { IdRequest } from "../../../types/aurion";
import Sentry from "@sentry/node";

export async function jobsDeleteRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: IdRequest & { ids: string[] } }>(
        "/print/jobs/delete",
        {
            schema: {
                body: {
                    type: "object",
                    properties: {
                        email: { type: "string" },
                        password: { type: "string" },
                        ids: { type: "array", items: { type: "string" }, minItems: 1 },
                    },
                    required: ["email", "password", "ids"],
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },

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
                await printClient.deleteJobs(request.body.ids);
                return { success: true };
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
