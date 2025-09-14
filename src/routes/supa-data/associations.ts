import { FastifyInstance } from "fastify";
import { supabase, pfpUrl } from "./utils/supabase";

export async function associationsRoute(fastify: FastifyInstance) {
    fastify.get(
        "/associations",
        {
            schema: {
                response: {
                    200: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                name: { type: "string" },
                                description: { type: "string" },
                                contact: { type: "string" },
                                image: { type: "string" },
                            },
                            required: ["name", "description", "contact"],
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
                const assos = await getAssos();
                return assos;
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

const getAssos = async () => {
    try {
        const { data, error } = await supabase.from("associations").select("*");
        if (error) throw error;

        data.forEach((item) => {
            if (
                item.lienContact &&
                item.lienContact.includes("instagram.com/")
            ) {
                item.nomInsta = item.lienContact.split("instagram.com/")[1];
                item.image = pfpUrl + item.nomInsta + ".jpg";
            }
        });

        const assos = data.map((asso) => ({
            name: asso.titre,
            description: asso.description,
            contact: asso.lienContact,
            image: asso.image,
        }));

        assos.sort((a, b) => a.name.localeCompare(b.name));

        return assos;
    } catch (error) {
        throw new Error("Failed to fetch associations: " + error);
    }
};
