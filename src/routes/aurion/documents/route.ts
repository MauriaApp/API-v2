import { FastifyInstance } from "fastify";
import { SessionManager } from "../utils/session-manager";
import { IdRequest } from "../../../types/aurion";
import { AurionDocuments, DownloadType } from "./documents";
import {
    createDownloadToken,
    readDownloadToken,
    TOKEN_TTL_MS,
} from "./download-token";
import Sentry from "@sentry/node";

type DownloadBody = IdRequest & {
    category: string;
    docIndex: number;
    downloadType: DownloadType;
    submitParam: string;
    selectName?: string;
    optionValue?: string;
    downloadButtonParam?: string;
    consulterParam?: string;
};

const downloadBodySchema = {
    type: "object",
    properties: {
        email: { type: "string" },
        password: { type: "string" },
        category: { type: "string" },
        docIndex: { type: "number" },
        downloadType: { type: "string" },
        submitParam: { type: "string" },
        selectName: { type: "string" },
        optionValue: { type: "string" },
        downloadButtonParam: { type: "string" },
        consulterParam: { type: "string" },
    },
    required: [
        "email",
        "password",
        "category",
        "docIndex",
        "downloadType",
        "submitParam",
    ],
} as const;

export async function documentsRoute(fastify: FastifyInstance) {
    // List all documents across the dynamically discovered leaves.
    fastify.post<{ Body: IdRequest }>(
        "/aurion/documents",
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
                            data: {
                                type: "object",
                                properties: {
                                    categories: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                menuid: { type: "string" },
                                                label: { type: "string" },
                                            },
                                        },
                                    },
                                    documents: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                label: { type: "string" },
                                                type: { type: "string" },
                                                size: { type: "string" },
                                                comment: { type: "string" },
                                                category: { type: "string" },
                                                docIndex: { type: "number" },
                                                downloadType: { type: "string" },
                                                submitParam: { type: "string" },
                                                selectName: { type: "string" },
                                                optionValue: { type: "string" },
                                                downloadButtonParam: { type: "string" },
                                                consulterParam: { type: "string" },
                                            },
                                        },
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
            const sessionManager = new SessionManager();
            const aurionClient = new AurionDocuments(sessionManager);

            try {
                const result = await aurionClient.getAllDocuments(
                    request.body.email,
                    request.body.password
                );
                return { success: true, data: result };
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

    // Download a single document as binary (proxied PDF).
    fastify.post<{ Body: DownloadBody }>(
        "/aurion/documents/download",
        {
            schema: {
                body: downloadBodySchema,
                response: {
                    200: {
                        type: "string",
                        contentMediaType: "application/octet-stream",
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
            const sessionManager = new SessionManager();
            const aurionClient = new AurionDocuments(sessionManager);

            try {
                const { buffer, filename } =
                    await aurionClient.downloadDocument(
                        request.body.email,
                        request.body.password,
                        request.body.category,
                        request.body.docIndex,
                        request.body.downloadType,
                        request.body.submitParam,
                        request.body.selectName,
                        request.body.optionValue,
                        request.body.downloadButtonParam,
                        request.body.consulterParam
                    );
                reply.header("Content-Type", "application/octet-stream");
                reply.header(
                    "Content-Disposition",
                    `attachment; filename="${filename}"`
                );
                return reply.send(buffer);
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

    // Mint a short-lived link for the same download.  Mobile WebViews ignore
    // `<a download>` on a blob, so the Webapp opens this URL in the system
    // browser instead and lets it save the file natively.
    fastify.post<{ Body: DownloadBody }>(
        "/aurion/documents/download-link",
        {
            schema: {
                body: downloadBodySchema,
                response: {
                    200: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            data: {
                                type: "object",
                                properties: {
                                    token: { type: "string" },
                                    expiresIn: { type: "number" },
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
            try {
                const token = createDownloadToken(request.body);
                return {
                    success: true,
                    data: { token, expiresIn: TOKEN_TTL_MS },
                };
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

    // Serve the document to a plain browser navigation.  Opened by the system
    // browser, so failures render as a readable page rather than raw JSON.
    fastify.get<{ Querystring: { token?: string } }>(
        "/aurion/documents/file",
        {
            schema: {
                querystring: {
                    type: "object",
                    properties: { token: { type: "string" } },
                    required: ["token"],
                },
            },
        },
        async (request, reply) => {
            try {
                const payload = readDownloadToken(request.query.token ?? "");
                const sessionManager = new SessionManager();
                const aurionClient = new AurionDocuments(sessionManager);

                const { buffer, filename } =
                    await aurionClient.downloadDocument(
                        payload.email,
                        payload.password,
                        payload.category,
                        payload.docIndex,
                        payload.downloadType,
                        payload.submitParam,
                        payload.selectName,
                        payload.optionValue,
                        payload.downloadButtonParam,
                        payload.consulterParam
                    );

                reply.header("Content-Type", "application/octet-stream");
                reply.header("Content-Disposition", contentDisposition(filename));
                reply.header("Cache-Control", "no-store");
                return reply.send(buffer);
            } catch (error) {
                Sentry.captureException(error);
                const message =
                    error instanceof Error ? error.message : "Unknown error";
                return reply
                    .status(500)
                    .type("text/html; charset=utf-8")
                    .send(errorPage(message));
            }
        }
    );
}

/** `attachment` header that survives accents and quotes in Aurion filenames. */
function contentDisposition(filename: string): string {
    const ascii = filename.replace(/["\\]/g, "").replace(/[^\x20-\x7e]/g, "_");
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
        filename
    )}`;
}

function errorPage(message: string): string {
    const safe = message.replace(/[<>&]/g, "");
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8">` +
        `<meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>Mauria</title></head>` +
        `<body style="font-family:system-ui;padding:2rem;text-align:center">` +
        `<h1 style="font-size:1.1rem">Téléchargement impossible</h1>` +
        `<p style="color:#666">${safe}</p>` +
        `<p style="color:#666">Réessayez depuis l'application.</p>` +
        `</body></html>`;
}
