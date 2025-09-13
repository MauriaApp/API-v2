import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { LoginRequest, aurionLogin } from "./login";

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
                            sessionId: { type: "string" },
                            statusCode: { type: "number" },
                        },
                        required: ["sessionId", "statusCode"],
                    },
                },
            },
        },
        async (
            request: FastifyRequest<{ Body: LoginRequest }>,
            reply: FastifyReply
        ) => {
            try {
                const { email, password } = request.body;
                const result = await aurionLogin(email, password);
                return reply.send(result);
            } catch (error) {
                return reply.status(500).send({ error: "Login failed" });
            }
        }
    );
}
