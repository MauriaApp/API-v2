import { FastifyInstance } from "fastify";
import { SessionManager } from "../utils/session-manager";
import { AurionPlanning } from "./planning";

export default async function planningRoute(fastify: FastifyInstance) {
    fastify.get("/test/planning", async (request, reply) => {
        const sessionManager = new SessionManager();
        const aurionClient = new AurionPlanning(sessionManager);

        try {
            const planning = await aurionClient.getPlanning(
                "milo.montuori@student.junia.com",
                "W!CXs3MnkRzQ",
                1757887200000,
                1758405600000
            );
            return { success: true, data: planning };
        } catch (error) {
            return reply.status(500).send({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    });
}
