import { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import { PrintSessionManager } from "../utils/session-manager";
import { PrintClient } from "../utils/print";
import Sentry from "@sentry/node";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // SafeQ limit

export async function jobsUploadRoute(fastify: FastifyInstance) {
    // Scoped to this plugin: other routes keep their default body parsing
    await fastify.register(multipart, {
        limits: { fileSize: MAX_FILE_SIZE, files: 1 },
    });

    fastify.post(
        "/print/jobs/upload",
        {
            schema: {
                consumes: ["multipart/form-data"],
                response: {
                    200: {
                        type: "object",
                        properties: { success: { type: "boolean" } },
                    },
                    400: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            error: { type: "string" },
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
                const file = await request.file();
                if (!file) {
                    return reply
                        .status(400)
                        .send({ success: false, error: "Fichier manquant" });
                }
                // Text fields must precede the file part in the form data
                const field = (name: string) => {
                    const part = file.fields[name];
                    const single = Array.isArray(part) ? part[0] : part;
                    return single && "value" in single
                        ? String(single.value)
                        : "";
                };
                const email = field("email");
                const password = field("password");
                if (!email || !password) {
                    return reply.status(400).send({
                        success: false,
                        error: "Identifiants manquants",
                    });
                }

                const buffer = await file.toBuffer();
                if (file.file.truncated) {
                    return reply.status(400).send({
                        success: false,
                        error: "Fichier trop volumineux",
                    });
                }

                const sessionManager = new PrintSessionManager();
                const printClient = new PrintClient(sessionManager);
                await sessionManager.login(email, password);
                await printClient.uploadJob(
                    buffer,
                    file.filename,
                    file.mimetype,
                    field("bw") === "true",
                    field("duplex") === "true"
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
