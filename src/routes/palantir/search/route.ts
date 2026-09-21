import { FastifyInstance } from "fastify";
import Sentry from "@sentry/node";
import {
    PalantirEntityKind,
    PalantirSearchRequest,
} from "../../../types/palantir";
import { getStatus, kickBuild, search } from "../utils/palantir-index";
import { statusSchema } from "../status/route";

const ALL_KINDS: PalantirEntityKind[] = ["room", "group"];

export async function palantirSearchRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: PalantirSearchRequest }>(
        "/palantir/search",
        {
            schema: {
                description:
                    "Recherche une salle ou un groupe/classe dans l'index Palantir. Si l'index est périmé, l'ancien est servi pendant que le nouveau se construit ; s'il est vide, la réponse arrive avec une liste vide et un état \"building\" à sonder via /palantir/status.",
                body: {
                    type: "object",
                    properties: {
                        email: { type: "string" },
                        password: { type: "string" },
                        q: { type: "string" },
                        kinds: {
                            type: "array",
                            items: {
                                type: "string",
                                enum: ALL_KINDS,
                            },
                            description:
                                "Types à retourner. Tous par défaut.",
                        },
                        limit: { type: "number", default: 30 },
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
                                    results: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                kind: {
                                                    type: "string",
                                                    enum: ALL_KINDS,
                                                },
                                                id: { type: "string" },
                                                label: { type: "string" },
                                                detail: { type: "string" },
                                                type: { type: "string" },
                                                count: { type: "number" },
                                            },
                                            required: [
                                                "kind",
                                                "id",
                                                "label",
                                                "detail",
                                                "type",
                                                "count",
                                            ],
                                        },
                                    },
                                    status: statusSchema,
                                },
                                required: ["results", "status"],
                            },
                        },
                        required: ["success", "data"],
                    },
                },
            },
        },
        async (request) => {
            const { email, password, q, kinds, limit } = request.body;

            kickBuild(email, password, (error) =>
                Sentry.captureException(error)
            );

            const wanted =
                kinds && kinds.length
                    ? kinds.filter((k) => ALL_KINDS.includes(k))
                    : ALL_KINDS;

            const results = search(
                q,
                wanted,
                Math.min(Math.max(limit ?? 30, 1), 100)
            );
            return { success: true, data: { results, status: getStatus() } };
        }
    );
}
