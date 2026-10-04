import { FastifyInstance } from "fastify";
import { SessionManager } from "../../aurion/utils/session-manager";
import { PalantirPeopleRequest } from "../../../types/palantir";
import { isAdminEmail } from "../utils/admin";
import { searchPeople } from "../utils/palantir-index";

export async function palantirPeopleRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: PalantirPeopleRequest }>(
        "/palantir/people",
        {
            schema: {
                // Hidden from the Swagger UI: this endpoint must not be
                // advertised, and non-admins must not learn it exists.
                hide: true,
                body: {
                    type: "object",
                    properties: {
                        email: { type: "string" },
                        password: { type: "string" },
                        q: { type: "string" },
                        limit: { type: "number", default: 20 },
                    },
                    required: ["email", "password", "q"],
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
                                        items: {
                                            type: "object",
                                            properties: {
                                                name: { type: "string" },
                                                lessons: { type: "number" },
                                            },
                                            required: ["name", "lessons"],
                                        },
                                    },
                                    students: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                firstName: { type: "string" },
                                                lastName: { type: "string" },
                                                className: { type: "string" },
                                                groupId: { type: "string" },
                                            },
                                            required: [
                                                "firstName",
                                                "lastName",
                                                "className",
                                                "groupId",
                                            ],
                                        },
                                    },
                                },
                                required: ["teachers", "students"],
                            },
                        },
                        required: ["success", "data"],
                    },
                },
            },
        },
        async (request, reply) => {
            const { email, password, q, limit } = request.body;

            // For anyone else this route answers exactly like an unknown
            // one — a 403 would reveal both its existence and who its
            // users are. Bad credentials answer the same way.
            if (!(await isAdminEmail(email))) {
                return reply.callNotFound();
            }
            const session = new SessionManager();
            try {
                // Cache-allowed login, the same posture as /palantir/planning:
                // a live Aurion session for this email implies the password
                // was verified when it was created.
                await session.login(email, password);
            } catch {
                return reply.callNotFound();
            }

            const results = searchPeople(
                q,
                Math.min(Math.max(limit ?? 20, 1), 100)
            );
            return { success: true, data: results };
        }
    );
}
