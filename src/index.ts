import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import loginRoute from "./routes/aurion/login/route";
import notesRoute from "./routes/aurion/notes/route";
import planningRoute from "./routes/aurion/planning/route";

const app = Fastify({ logger: false });

const start = async () => {
    try {
        // Enregistrer Swagger en premier
        await app.register(swagger, {
            openapi: {
                info: {
                    title: "Mon API Fastify",
                    description:
                        "API propre avec Fastify, TypeScript et Swagger",
                    version: "1.0.0",
                },
            },
        });

        await app.register(loginRoute);
        await app.register(notesRoute);
        await app.register(planningRoute);

        await app.register(swaggerUi, {
            routePrefix: "/docs",
            uiConfig: {
                docExpansion: "list",
                deepLinking: false,
            },
        });

        // Déclarer les routes APRÈS l'enregistrement des plugins
        app.get(
            "/ping",
            {
                schema: {
                    response: {
                        200: {
                            type: "object",
                            properties: { pong: { type: "boolean" } },
                            required: ["pong"],
                        },
                    },
                },
            },
            async () => ({ pong: true })
        );

        await app.listen({ port: 3000 });
        console.log("Server running @ http://localhost:3000");
        console.log("Swagger UI @ http://localhost:3000/docs");
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
