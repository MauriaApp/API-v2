/**
 * The Palantir harvester — the weekly build, run outside the API.
 *
 * History: the index used to be harvested by mauria-api itself, and that
 * traffic is what got Junia's firewall to ban the API's egress IP twice
 * (2026-09-23/24). This daemon now runs on a dedicated machine (see the
 * palantir-harvest systemd service): it walks Aurion slowly — one planning
 * after the other, one session — writes the index to local files (the
 * previous build is kept), then pushes it to the API's /palantir/publish.
 * The API persists it and never touches Aurion for Palantir.
 *
 *   npx ts-node -T scripts/palantir-daemon.ts                 # harvest + publish
 *   npx ts-node -T scripts/palantir-daemon.ts --publish-only  # repush the last local index
 *
 * Environment (or .env / systemd EnvironmentFile):
 *   AURION_EMAIL, AURION_PASSWORD       Aurion account to harvest with
 *   PALANTIR_PUBLISH_URL                 e.g. https://mauria-api.fly.dev/palantir/publish
 *   PALANTIR_PUBLISH_TOKEN               shared token, same value as the API's secret
 *   PALANTIR_DATA_DIR                    local index files (default scripts/data)
 *   PALANTIR_PUBLISH_ATTEMPTS            retries before giving up (default 6)
 *   PALANTIR_PUBLISH_RETRY_MS            delay between retries (default 30 min)
 *   PALANTIR_WORKERS, PALANTIR_DELAY_MS  harvest pacing (defaults: 1, 400 ms)
 */

import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";

import { newSession } from "../src/routes/palantir/utils/aurion-menu";
import { discoverPlannings, harvestAll } from "../src/routes/palantir/utils/harvester";
import {
    buildIndexData,
    harvestWindow,
    serializeIndex,
    type IndexData,
    type SerializedPalantirIndex,
} from "../src/routes/palantir/utils/index-format";
import type {
    PalantirGroup,
    PalantirLesson,
    PalantirPlanningNode,
} from "../src/types/palantir";

dotenv.config({ path: process.env.PALANTIR_ENV_FILE ?? ".env", quiet: true });

const PUBLISH_ATTEMPTS = Number(process.env.PALANTIR_PUBLISH_ATTEMPTS ?? 6);
const PUBLISH_RETRY_MS = Number(process.env.PALANTIR_PUBLISH_RETRY_MS ?? 30 * 60 * 1000);
const DATA_DIR = process.env.PALANTIR_DATA_DIR ?? path.join(__dirname, "data");

const log = (message: string) =>
    console.log(`[palantir-daemon] ${new Date().toISOString()} ${message}`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The service starts the daemon right after wg-quick up, and the first
 * Aurion call can race the tunnel coming up ("Client network socket
 * disconnected before secure TLS connection was established"). A few
 * retries with a delay absorb that race — the weekly timer has no other
 * chance until next Sunday.
 */
async function loginWithRetry(
    email: string,
    password: string,
    attempts = 4
): Promise<ReturnType<typeof newSession>> {
    for (let attempt = 1; ; attempt++) {
        const session = newSession();
        try {
            await session.login(email, password, { noCache: true });
            return session;
        } catch (error) {
            if (attempt >= attempts) throw error;
            const reason = error instanceof Error ? error.message : String(error);
            log(`login attempt ${attempt}/${attempts} failed: ${reason}`);
            await sleep(attempt * 5_000);
        }
    }
}

interface HarvestEntry {
    node: PalantirPlanningNode;
    result: { groups: PalantirGroup[]; lessons: PalantirLesson[] };
}

/** Walk Aurion sequentially and fold every planning into an index. */
async function harvest(email: string, password: string): Promise<IndexData> {
    const window = harvestWindow(Date.now());

    log(
        `harvest start — window ` +
            `${new Date(window.start).toISOString()} → ${new Date(window.end).toISOString()}` +
            ` (workers: ${process.env.PALANTIR_WORKERS ?? 1}, delay: ${process.env.PALANTIR_DELAY_MS ?? 400} ms)`
    );

    const scout = await loginWithRetry(email, password);
    const nodes = await discoverPlannings(scout);
    log(`discovered ${nodes.length} plannings`);

    const entries: HarvestEntry[] = [];
    const failed: string[] = [];
    let done = 0;

    await harvestAll(email, password, nodes, window, (node, result, error) => {
        done += 1;
        if (error || !result) {
            failed.push(node.label);
            log(
                `${done}/${nodes.length} ${node.label} FAILED: ` +
                    (error instanceof Error ? error.message : String(error))
            );
            return;
        }
        entries.push({ node, result });
        log(
            `${done}/${nodes.length} ${node.label} — ` +
                `${result.groups.length} groups, ${result.lessons.length} lessons, ` +
                `${result.groups.filter((g) => g.students?.length).length} rosters`
        );
    });

    if (nodes.length && entries.length === 0) {
        throw new Error(
            `harvest failed on all ${nodes.length} plannings (Aurion may have changed)`
        );
    }

    const data = buildIndexData(window, entries);
    data.failed = failed;
    const students = data.groups.reduce(
        (total, group) => total + (group.students?.length ?? 0),
        0
    );
    log(
        `harvest done — ${data.lessons.size} lessons, ${data.rooms.size} rooms, ` +
            `${data.groups.length} groups, ${students} students, ${failed.length} failed plannings`
    );
    return data;
}

/** Write the index locally: the new file lands atomically, the old one is kept. */
async function writeLocalFiles(data: IndexData): Promise<string> {
    const serialized = serializeIndex(data);
    await fs.mkdir(DATA_DIR, { recursive: true });

    const target = path.join(DATA_DIR, "index.json");
    const previous = path.join(DATA_DIR, "index.prev.json");
    const staging = path.join(DATA_DIR, "index.new.json");

    await fs.writeFile(staging, JSON.stringify(serialized));
    try {
        await fs.rename(target, previous);
    } catch {
        // No previous index yet — nothing to keep.
    }
    await fs.rename(staging, target);
    log(`index written to ${target} (previous build kept at ${previous})`);
    return target;
}

/** Push the serialized index to the API, retrying for hours if it is down. */
async function publish(serialized: SerializedPalantirIndex): Promise<void> {
    const url = process.env.PALANTIR_PUBLISH_URL;
    const token = process.env.PALANTIR_PUBLISH_TOKEN;
    if (!url || !token) {
        throw new Error("PALANTIR_PUBLISH_URL and PALANTIR_PUBLISH_TOKEN are required");
    }

    const body = JSON.stringify(serialized);
    for (let attempt = 1; attempt <= PUBLISH_ATTEMPTS; attempt++) {
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-palantir-token": token,
                },
                body,
            });
            if (res.ok) {
                const payload = (await res.json()) as { success?: boolean };
                if (payload.success) {
                    log(`published (${body.length} bytes) on attempt ${attempt}`);
                    return;
                }
                throw new Error(`API answered ok but success=false: ${JSON.stringify(payload)}`);
            }
            throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            if (attempt === PUBLISH_ATTEMPTS) {
                throw new Error(`publish failed after ${attempt} attempts: ${reason}`);
            }
            log(
                `publish attempt ${attempt}/${PUBLISH_ATTEMPTS} failed (${reason}) — ` +
                    `retrying in ${Math.round(PUBLISH_RETRY_MS / 60000)} min`
            );
            await sleep(PUBLISH_RETRY_MS);
        }
    }
}

async function main(): Promise<void> {
    const publishOnly = process.argv.includes("--publish-only");
    let serialized: SerializedPalantirIndex;

    if (publishOnly) {
        // index.json already holds the serialized form — republish it as is.
        const raw = await fs.readFile(path.join(DATA_DIR, "index.json"), "utf8");
        serialized = JSON.parse(raw) as SerializedPalantirIndex;
        log(
            `--publish-only: reusing local index from ` +
                `${new Date(serialized.builtAt).toISOString()}`
        );
    } else {
        const email = process.env.AURION_EMAIL;
        const password = process.env.AURION_PASSWORD;
        if (!email || !password) {
            throw new Error("AURION_EMAIL and AURION_PASSWORD are required");
        }
        const data = await harvest(email, password);
        await writeLocalFiles(data);
        serialized = serializeIndex(data);
    }

    await publish(serialized);
    log("done");
}

main().catch((error) => {
    console.error(
        `[palantir-daemon] ${new Date().toISOString()} fatal: ` +
            (error instanceof Error ? error.message : String(error))
    );
    process.exit(1);
});
