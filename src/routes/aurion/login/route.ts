import { FastifyInstance } from "fastify";
import { AurionLogin } from "./login";
import { SessionManager } from "../utils/session-manager";

interface LoginRequest {
    email: string;
    password: string;
}

export default async function loginRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: LoginRequest }>(
        "/aurion/login",
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
            const aurionClient = new AurionLogin(sessionManager);

            try {
                await aurionClient.login(
                    request.body.email,
                    request.body.password
                );
                return { success: true };
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
