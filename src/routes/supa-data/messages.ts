import { FastifyInstance } from "fastify";
import { getSupabase } from "./utils/supabase";

export async function messagesRoute(fastify: FastifyInstance) {
    fastify.get(
        "/messages",
        {
            schema: {
                response: {
                    200: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                title: { type: "string" },
                                message: { type: "string" },
                            },
                            required: ["title", "message"],
                        },
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
            try {
                const messages = await getMessages();
                return messages;
            } catch (error) {
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

// Récupérer les messages importants depuis Supabase, du plus récent (id le
// plus grand, affiché en premier) au plus ancien
export const getMessages = async () => {
    try {
        const { data, error } = await getSupabase()
            .from("messages")
            .select("*")
            .order("id", { ascending: false });
        if (error) throw error;

        const messages = (data ?? []).map((entry) => ({
            title: entry.titre ?? "",
            message: entry.description ?? "",
        }));

        return messages;
    } catch (error) {
        throw new Error("Failed to fetch messages: " + error);
    }
};
