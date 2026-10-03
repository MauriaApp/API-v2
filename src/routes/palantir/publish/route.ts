import { createHash, timingSafeEqual } from "crypto";
import { FastifyInstance } from "fastify";
import { SerializedPalantirIndex } from "../utils/index-format";
import { publishIndex, getStatus } from "../utils/palantir-index";
import { statusSchema } from "../status/route";

/**
 * The weekly harvester (a machine outside the API, see
 * scripts/palantir-daemon.ts) pushes its freshly built index here. The API
 * persists it to Supabase and serves it until the next publish — it never
 * talks to Aurion for Palantir.
 *
 * Auth is a shared token: without one, anyone could both stuff a fake index
 * into every user's search results and burn the caller's Supabase quota.
 * Digests are compared in constant time so the comparison leaks nothing.
 */

const PUBLISH_TOKEN = process.env.PALANTIR_PUBLISH_TOKEN;
const TOKEN_HEADER = "x-palantir-token";

function tokenMatches(candidate: string): boolean {
    if (!PUBLISH_TOKEN) return false;
    const a = createHash("sha256").update(PUBLISH_TOKEN).digest();
    const b = createHash("sha256").update(candidate).digest();
    return timingSafeEqual(a, b);
}

export async function palantirPublishRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: SerializedPalantirIndex }>(
        "/palantir/publish",
        {
            // The index runs a few MB; the instance-wide default is 1 MB.
            bodyLimit: 25 * 1024 * 1024,
            schema: {
                description:
                    "Publie un index Palantir fraîchement moissonné. Réservé au harvester externe (token x-palantir-token). L'index est persisté dans Supabase puis servi jusqu'au prochain publish ; l'API ne moissonne jamais Aurion elle-même.",
                body: {
                    type: "object",
                    required: [
                        "builtAt",
                        "expiresAt",
                        "window",
                        "lessons",
                        "rooms",
                        "groups",
                        "nodes",
                    ],
                    properties: {
                        builtAt: { type: "number" },
                        expiresAt: { type: "number" },
                        window: {
                            type: "object",
                            properties: {
                                start: { type: "number" },
                                end: { type: "number" },
                            },
                        },
                        lessons: { type: "array" },
                        rooms: { type: "array" },
                        groups: { type: "array" },
                        nodes: { type: "array" },
                        failed: { type: "array", items: { type: "string" } },
                    },
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            data: statusSchema,
                        },
                        required: ["success", "data"],
                    },
                    400: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            error: { type: "string" },
                        },
                        required: ["success", "error"],
                    },
                    401: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            error: { type: "string" },
                        },
                        required: ["success", "error"],
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
            if (!PUBLISH_TOKEN) {
                return reply.status(401).send({
                    success: false,
                    error: "PALANTIR_PUBLISH_TOKEN is not configured",
                });
            }
            if (!tokenMatches(String(request.headers[TOKEN_HEADER] ?? ""))) {
                return reply.status(401).send({
                    success: false,
                    error: "token invalide",
                });
            }

            try {
                await publishIndex(request.body);
                return { success: true, data: getStatus() };
            } catch (error) {
                return reply.status(500).send({
                    success: false,
                    error: error instanceof Error ? error.message : "Unknown error",
                });
            }
        }
    );
}
