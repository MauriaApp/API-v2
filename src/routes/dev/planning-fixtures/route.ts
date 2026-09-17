import { FastifyInstance } from "fastify";
import { readdir, readFile } from "fs/promises";
import path from "path";

// Dev-only tooling: serves the Aurion planning fixtures collected by
// scripts/aurion-fixtures.ts (scripts/dumps/fixtures/, gitignored, never
// shipped in dist/). Only registered when TS_NODE_DEV is set (see
// src/index.ts) so this never exists in production.
const FIXTURES_DIR = path.join(__dirname, "..", "..", "..", "..", "scripts", "dumps", "fixtures");

async function readFixture(name: string) {
    // Reject anything that isn't a bare filename before it ever touches the
    // filesystem: this endpoint only runs locally, but a path like
    // "../../../etc/passwd" should still fail closed.
    if (!/^[\w.-]+\.json$/.test(name)) return null;
    try {
        const raw = await readFile(path.join(FIXTURES_DIR, name), "utf-8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

export async function planningFixturesRoute(fastify: FastifyInstance) {
    fastify.get("/dev/planning-fixtures", async () => {
        const index = await readFixture("_index.json");
        const files = (await readdir(FIXTURES_DIR).catch(() => [])).filter(
            (file) => file.endsWith(".json") && !file.startsWith("_")
        );

        const fixtures = await Promise.all(
            files.map(async (file) => {
                const data = await readFixture(file);
                return {
                    file,
                    label: data?.label ?? file,
                    weekStart: data?.weekStart ?? null,
                    events: Array.isArray(data?.events)
                        ? data.events.length
                        : 0,
                };
            })
        );

        return {
            weekStart: index?.weekStart ?? null,
            fixtures: fixtures.sort((a, b) => a.label.localeCompare(b.label)),
        };
    });

    fastify.get<{ Params: { file: string } }>(
        "/dev/planning-fixtures/:file",
        async (request, reply) => {
            const data = await readFixture(request.params.file);
            if (!data) {
                return reply.status(404).send({
                    success: false,
                    error: "Fixture not found",
                });
            }
            return { success: true, data: data.events ?? [] };
        }
    );
}
