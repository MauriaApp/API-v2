import { FastifyInstance } from "fastify";
import Sentry from "@sentry/node";
import { PalantirPlanningRequest } from "../../../types/palantir";
import { SessionManager } from "../../aurion/utils/session-manager";
import { fetchGroupLessons } from "../utils/harvester";
import {
    currentWindow,
    getStatus,
    lessonsFor,
    lessonsForGroup,
    resolveGroup,
} from "../utils/palantir-index";
import { statusSchema } from "../status/route";

export async function palantirPlanningRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: PalantirPlanningRequest }>(
        "/palantir/planning",
        {
            schema: {
                description:
                    "Emploi du temps d'une entité renvoyée par /palantir/search. Salles et classes sont servies depuis l'index (le pass des rosters récolte le planning propre de chaque promotion) ; une classe sans leçons indexées est récupérée en direct sur Aurion, ~15 s. ATTENTION: Les timestamps sont en MILLISECONDES !",
                body: {
                    type: "object",
                    properties: {
                        email: { type: "string" },
                        password: { type: "string" },
                        kind: {
                            type: "string",
                            enum: ["room", "group"],
                        },
                        id: {
                            type: "string",
                            description:
                                "Le champ id de l'entité, tel que renvoyé par /palantir/search.",
                        },
                        startTimestamp: {
                            type: "number",
                            description: "Timestamp en millisecondes",
                        },
                        endTimestamp: {
                            type: "number",
                            description: "Timestamp en millisecondes",
                        },
                    },
                    required: ["email", "password", "kind", "id"],
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
                                        title: { type: "string" },
                                        start: { type: "string" },
                                        end: { type: "string" },
                                        allDay: { type: "boolean" },
                                        editable: { type: "boolean" },
                                        className: { type: "string" },
                                    },
                                    required: [
                                        "id",
                                        "title",
                                        "start",
                                        "end",
                                        "allDay",
                                        "editable",
                                        "className",
                                    ],
                                },
                            },
                            status: statusSchema,
                        },
                        required: ["success", "data", "status"],
                    },
                    404: {
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
            const { email, password, kind, id, startTimestamp, endTimestamp } =
                request.body;
            try {
                if (kind === "room") {
                    return {
                        success: true,
                        data: lessonsFor(
                            kind,
                            id,
                            startTimestamp,
                            endTimestamp
                        ),
                        status: getStatus(),
                    };
                }

                const resolved = resolveGroup(id);
                if (!resolved) {
                    return reply.status(404).send({
                        success: false,
                        error: "Groupe inconnu de l'index, relance une recherche.",
                    });
                }

                // The roster pass indexes each promotion's own planning:
                // serve it instantly, like a room's. Null = the index has
                // none for this group (older index, failed pass) → live.
                const indexed = lessonsForGroup(
                    id,
                    startTimestamp,
                    endTimestamp
                );
                if (indexed) {
                    return {
                        success: true,
                        data: indexed,
                        status: getStatus(),
                    };
                }

                const window = currentWindow();
                const session = new SessionManager();
                // Palantir walks stateful menus: it needs its own Aurion
                // session, not the shared cached one.
                await session.login(email, password, { noCache: true });
                const lessons = await fetchGroupLessons(
                    session,
                    resolved.node,
                    resolved.group.rowKey,
                    {
                        start: startTimestamp ?? window.start,
                        end: endTimestamp ?? window.end,
                    }
                );
                return { success: true, data: lessons, status: getStatus() };
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
