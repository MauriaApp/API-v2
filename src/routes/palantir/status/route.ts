import { FastifyInstance } from "fastify";
import { IdRequest } from "../../../types/aurion";
import { getStatus } from "../utils/palantir-index";

/** Shared by the three Palantir routes so the client always gets the progress. */
export const statusSchema = {
    type: "object",
    properties: {
        state: { type: "string", enum: ["empty", "building", "ready"] },
        phase: {
            type: "string",
            nullable: true,
            enum: ["plannings", "events", null],
        },
        done: { type: "number" },
        total: { type: "number" },
        elapsedMs: { type: "number" },
        builtAt: { type: "number", nullable: true },
        expiresAt: { type: "number", nullable: true },
        windowStart: { type: "number", nullable: true },
        windowEnd: { type: "number", nullable: true },
        stale: { type: "boolean" },
        error: { type: "string", nullable: true },
        failed: { type: "array", items: { type: "string" } },
        counts: {
            type: "object",
            properties: {
                lessons: { type: "number" },
                rooms: { type: "number" },
                groups: { type: "number" },
            },
            required: ["lessons", "rooms", "groups"],
        },
    },
    required: [
        "state",
        "done",
        "total",
        "elapsedMs",
        "stale",
        "failed",
        "counts",
    ],
} as const;

export async function palantirStatusRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: IdRequest }>(
        "/palantir/status",
        {
            schema: {
                description:
                    "État de l'index Palantir (construit par le harvester externe, publié via /palantir/publish, expiré chaque dimanche à 00:00 Paris). Lecture seule — la (re)construction n'est plus déclenchée par les utilisateurs.",
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
                            data: statusSchema,
                        },
                        required: ["success", "data"],
                    },
                },
            },
        },
        async (request) => {
            return { success: true, data: getStatus() };
        }
    );
}
