import { FastifyInstance } from "fastify";
import { supabase } from "./utils/supabase";

export async function toolsRoute(fastify: FastifyInstance) {
    fastify.get(
        "/tools",
        {
            schema: {
                response: {
                    200: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                buttonTitle: { type: "string" },
                                description: { type: "string" },
                                url: { type: "string" },
                            },
                            required: ["buttonTitle", "description", "url"],
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
                const tools = await getTools();
                return tools;
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

// Récupérer les liens depuis Firebase
export const getTools = async () => {
    try {
        const { data, error } = await supabase.from("liens").select("*");
        if (error) throw error;

        const links = data.map((link) => ({
            buttonTitle: link.titre,
            description: link.description,
            url: link.url,
        }));

        return links;
    } catch (error) {
        console.error("Error getting liens:", error);
        throw error;
    }
};
