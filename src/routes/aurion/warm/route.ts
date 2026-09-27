import { FastifyInstance } from "fastify";
import { AurionWarm } from "./warm";
import { SessionManager } from "../utils/session-manager";
import { IdRequest } from "../../../types/aurion";
import Sentry from "@sentry/node";

export async function warmRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: IdRequest }>(
        "/aurion/warm",
        {
            schema: {
                description:
                    "Ensures the Aurion session for this account is logged in and its home-page tokens are cached, without fetching any feature data. Fast no-op when the session is already warm.",
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
                        },
                        required: ["success"],
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
            const aurionWarm = new AurionWarm(sessionManager);

            try {
                await aurionWarm.warm(
                    request.body.email,
                    request.body.password
                );
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
