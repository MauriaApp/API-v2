/**
 * Dev-only test: run the full harvestPlanning flow — groups, lessons, and
 * the new per-promotion student roster — on a single planning, and print
 * the roster sizes. This is the roster code path exactly as the weekly
 * daemon will run it, minus every other planning.
 *
 *   npx ts-node -T scripts/palantir-roster-test.ts
 *
 * Target planning via env: PROBE_FILIERE (default CIR) and
 * PROBE_PLANNING (default CIR1). Credentials from .env.dev; the rosters
 * are only counted, never printed.
 */

import dotenv from "dotenv";
import {
    MenuPage,
    ROOT_CHAIN,
    expand,
    newSession,
    openMenu,
    parseSidebarEntries,
    sleep,
} from "../src/routes/palantir/utils/aurion-menu";
import {
    MenuContext,
    harvestPlanning,
} from "../src/routes/palantir/utils/harvester";
import { harvestWindow } from "../src/routes/palantir/utils/index-format";

dotenv.config({ path: ".env.dev" });

const DELAY_MS = 150;

async function main() {
    const email = process.env.AURION_EMAIL;
    const password = process.env.AURION_PASSWORD;
    if (!email || !password) {
        throw new Error("AURION_EMAIL et AURION_PASSWORD requis (env ou .env.dev).");
    }

    const session = newSession();
    await session.login(email, password);
    console.log("login ok");

    const menu: MenuPage = await openMenu(session);
    const root = await expand(session, menu, ROOT_CHAIN, DELAY_MS);
    const filieres = parseSidebarEntries(root.body).filter(
        (e) => e.kind === "submenu" && !ROOT_CHAIN.includes(e.id)
    );
    const filiereRe = new RegExp(process.env.PROBE_FILIERE ?? "CIR", "i");
    const leafRe = new RegExp(process.env.PROBE_PLANNING ?? "CIR1", "i");
    const filiere = filieres.find((f) => filiereRe.test(f.label));
    if (!filiere) throw new Error(`filière ${filiereRe} introuvable`);
    const fresh = await openMenu(session);
    const opened = await expand(
        session,
        fresh,
        [...ROOT_CHAIN, filiere.id],
        DELAY_MS
    );
    const leaf = parseSidebarEntries(opened.body).find(
        (e) => e.kind === "item" && leafRe.test(e.label)
    );
    if (!leaf) throw new Error(`feuille ${leafRe} introuvable`);
    const node = {
        menuid: leaf.id,
        label: leaf.label,
        filiereId: filiere.id,
        filiere: filiere.label,
    };
    console.log(`planning: ${node.label}`);

    const ctx: MenuContext = {
        menu: fresh,
        viewState: opened.viewState,
        filiereId: filiere.id,
    };
    const result = await harvestPlanning(
        session,
        ctx,
        node,
        harvestWindow(Date.now())
    );
    await sleep(DELAY_MS);

    const promotions = result.groups.filter((g) => g.type === "Promotion");
    for (const promotion of promotions) {
        console.log(
            `  ${promotion.label || promotion.code} — ${promotion.students?.length ?? 0} étudiant(s)`
        );
    }
    console.log(
        `${result.groups.length} groupes (${promotions.length} promotions), ` +
            `${result.lessons.length} cours`
    );
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
