import { FastifyInstance } from "fastify";
import { SessionManager } from "../utils/session-manager";
import { AurionNotes } from "./notes";

export default async function notesRoute(fastify: FastifyInstance) {
    fastify.get("/test/notes", async (request, reply) => {
        const sessionManager = new SessionManager();
        const aurionClient = new AurionNotes(sessionManager);

        try {
            const notes = await aurionClient.getAllNotes(
                "milo.montuori@student.junia.com",
                "W!CXs3MnkRzQ"
            );
            return { success: true, data: notes };
        } catch (error) {
            return reply.status(500).send({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    });
}
