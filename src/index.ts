import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import aurionRoutes from "./routes/aurion/index";
import supaDataRoutes from "./routes/supa-data/index";

const app = Fastify({ logger: false });

const start = async () => {
    try {
        // Enregistrer Swagger en premier
        await app.register(swagger, {
            openapi: {
                info: {
                    title: "API Mauria",
                    description:
                        "API propre avec Fastify, TypeScript et Swagger. Toutes les routes sont documentées ici, avec exemples de requêtes et réponses.",
                    version: "2.0.0",
                },
            },
        });

        // Routes Aurion
        await Promise.all(
            Object.values(aurionRoutes).map((route) => app.register(route))
        );
        // Routes SupaData
        await Promise.all(
            Object.values(supaDataRoutes).map((route) => app.register(route))
        );

        await app.register(swaggerUi, {
            routePrefix: "/docs",
            uiConfig: {
                docExpansion: "list",
                deepLinking: false,
            },
        });

        await app.listen({ port: 3000 });
        console.log("Server running @ http://localhost:3000");
        console.log("Swagger UI @ http://localhost:3000/docs");
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
