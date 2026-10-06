/**
 * Dev-only. Dumps the logged-in student's own planning through the very code
 * the API serves, to keep a reference fixture of the *personal* title format
 * next to the promotion-wide ones harvested by aurion-fixtures.ts.
 *
 *   npx ts-node -T scripts/aurion-personal.ts [--weeks 8]
 *
 * The dump holds the developer's own schedule and stays gitignored.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";
import { SessionManager } from "../src/routes/aurion/utils/session-manager";
import { AurionPlanning } from "../src/routes/aurion/planning/planning";

dotenv.config({ path: ".env.dev" });

const FIXTURES = join(__dirname, "dumps", "fixtures");

async function main() {
    const email = process.env.AURION_EMAIL;
    const password = process.env.AURION_PASSWORD;
    if (!email || !password) {
        console.error("AURION_EMAIL et AURION_PASSWORD requis (.env.dev).");
        process.exit(1);
    }

    const weeksArg = process.argv.indexOf("--weeks");
    const weeks = weeksArg === -1 ? 8 : Number(process.argv[weeksArg + 1]);
    const start = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const end = start + weeks * 7 * 24 * 60 * 60 * 1000;

    const planning = new AurionPlanning(new SessionManager());
    const events = await planning.getPlanning(email, password, start, end);

    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(
        join(FIXTURES, "_personnel.json"),
        JSON.stringify(
            {
                label: "Planning personnel",
                kind: "personal",
                weekStart: new Date(start).toISOString().slice(0, 10),
                events,
            },
            null,
            2
        )
    );
    console.log(`${events.length} événements -> fixtures/_personnel.json`);
    for (const e of events.slice(0, 2)) {
        console.log("  ---");
        for (const line of String(e.title).split("\n")) console.log(`   |${line}`);
    }
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
