import { FastifyInstance } from "fastify";
import { SessionManager } from "../utils/session-manager";
import { IdRequest } from "../../../types/aurion";
import { AurionDocuments, DownloadType } from "./documents";
import Sentry from "@sentry/node";

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
    fastify.post<{
        Body: IdRequest & {
            category: string;
            docIndex: number;
            downloadType: DownloadType;
            submitParam: string;
            selectName?: string;
            optionValue?: string;
            downloadButtonParam?: string;
            consulterParam?: string;
        };
    }>(
        "/aurion/documents/download",
        {
            schema: {
                body: {
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
                },
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
}
