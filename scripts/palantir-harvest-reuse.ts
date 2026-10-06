/**
 * Dev-only validation of the menu-context reuse in the real harvest flow:
 * discover the plannings, then run the refactored harvestAll over the CPG
 * filière only — one contiguous bucket, so a single worker opens CPG1, reads
 * its whole schedule, then opens CPG2 through the same cached menu page.
 *
 * Success = both plannings return groups and lessons, and the second one does
 * not fall back to a full menu re-open (visible as a much shorter open).
 *
 *   npx ts-node -T scripts/palantir-harvest-reuse.ts
 *
 * Credentials from .env.dev; nothing identifying is printed.
 */

import dotenv from "dotenv";
import { newSession } from "../src/routes/palantir/utils/aurion-menu";
import { discoverPlannings, harvestAll } from "../src/routes/palantir/utils/harvester";

dotenv.config({ path: ".env.dev" });

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
    const email = process.env.AURION_EMAIL;
    const password = process.env.AURION_PASSWORD;
    if (!email || !password) {
        throw new Error("AURION_EMAIL et AURION_PASSWORD requis (env ou .env.dev).");
    }

    const scout = newSession();
    await scout.login(email, password);
    const started = Date.now();
    const nodes = await discoverPlannings(scout);
    console.log(
        `découverte: ${nodes.length} plannings en ${Date.now() - started} ms`
    );

    const bucket = nodes.filter((n) => n.filiere.includes("CPG"));
    console.log(
        `bucket CPG: ${bucket.map((n) => n.label).join(", ")}`
    );

    // One week is enough to exercise the whole readLessons path.
    const now = Date.now();
    const window = { start: now - 7 * DAY_MS, end: now + 7 * DAY_MS };

    const mark = Date.now();
    let perNode: string[] = [];
    await harvestAll(email, password, bucket, window, (node, result, error) => {
        if (error || !result) {
            perNode.push(
                `${node.label}: ÉCHEC — ${error instanceof Error ? error.message : error}`
            );
            return;
        }
        perNode.push(
            `${node.label}: ${result.groups.length} groupes, ${result.lessons.length} cours`
        );
    });
    for (const line of perNode) console.log(line);
    console.log(`moisson du bucket: ${Date.now() - mark} ms`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
