import { FastifyInstance } from "fastify";
import { PrintSessionManager } from "../utils/session-manager";
import { PrintClient, PrintFolder } from "../utils/print";
import { IdRequest } from "../../../types/aurion";
import Sentry from "@sentry/node";

export async function jobsRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: IdRequest & { folder: PrintFolder } }>(
        "/print/jobs",
        {
            schema: {
                body: {
                    type: "object",
                    properties: {
                        email: { type: "string" },
                        password: { type: "string" },
                        folder: { type: "string", enum: ["WAITING", "PRINTED"] },
                    },
                    required: ["email", "password", "folder"],
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
                                        name: { type: "string" },
                                        date: { type: "string" },
                                        owner: { type: "string" },
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
            const sessionManager = new PrintSessionManager();
            const printClient = new PrintClient(sessionManager);

            try {
                await sessionManager.login(
                    request.body.email,
                    request.body.password
                );
                const jobs = await printClient.listJobs(request.body.folder);
                return { success: true, data: jobs };
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
