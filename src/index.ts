import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import aurionRoutes from "./routes/aurion/index";
import supaDataRoutes from "./routes/supa-data/index";

import dotenv from "dotenv";
import fastifyCors from "@fastify/cors";
const env = process.env.TS_NODE_DEV;
if (env) {
    console.log("-- Running in development mode");
}
const envFile = env ? ".env.dev" : ".env";
dotenv.config({ path: envFile, override: true, quiet: true });

const port = process.env.PORT || 8080;
const host = process.env.HOST || "0.0.0.0";

const app = Fastify({ logger: false });

const start = async () => {
    try {
        // Register CORS plugin
        await app.register(fastifyCors, {
            origin: true,
            credentials: true,
        });

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
            routePrefix: "/",
            uiConfig: {
                docExpansion: "list",
                deepLinking: false,
            },
        });

        await app.listen({ port: Number(port), host });
        console.log(`Server listening at http://${host}:${port}`);
        console.log(`Swagger UI at http://${host}:${port}/docs`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
