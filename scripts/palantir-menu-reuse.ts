/**
 * Dev-only probe: can one Aurion session open several planning leaves without
 * re-opening and re-expanding the sidebar menu for each one?
 *
 * The harvest currently pays openMenu (2 GET) + expand (POST + delay) before
 * every single leaf. If the server-side menu state persists across leaf
 * posts, that preamble can be paid once per worker and filière instead —
 * roughly a third of the events phase gone, and fewer requests for Aurion,
 * not more.
 *
 * Three measurements, one session:
 *   1. baseline  — the current openChoice sequence (fresh menu + expand + leaf)
 *   2. reuse A   — a second leaf posted with the SAME menu page and ViewState,
 *                  no re-open, no re-expand
 *   3. reuse B   — a fresh MainMenuPage GET, then a leaf post with the fresh
 *                  ViewState: does the expansion survive a menu reload?
 *
 * A selection screen is valid when it carries the DataTable widget and the
 * "Voir planning" button, and no <error-name> partial.
 *
 *   npx ts-node -T scripts/palantir-menu-reuse.ts
 *
 * Credentials come from .env.dev, nothing identifying is printed.
 */

import dotenv from "dotenv";
import {
    MenuPage,
    ROOT_CHAIN,
    expand,
    newSession,
    openLeaf,
    openMenu,
    parseSidebarEntries,
    sleep,
} from "../src/routes/palantir/utils/aurion-menu";

dotenv.config({ path: ".env.dev" });

const DELAY_MS = 150;

const isSelectionScreen = (body: string) =>
    body.includes('PrimeFaces.cw("DataTable"') &&
    body.includes("Voir planning") &&
    !body.includes("<error-name>");

async function main() {
    const email = process.env.AURION_EMAIL;
    const password = process.env.AURION_PASSWORD;
    if (!email || !password) {
        throw new Error("AURION_EMAIL et AURION_PASSWORD requis (env ou .env.dev).");
    }

    const session = newSession();
    let requests = 0;
    session.client = session.client.extend({
        hooks: {
            beforeRequest: [
                () => {
                    requests += 1;
                },
            ],
        },
    }) as unknown as typeof session.client;
    await session.login(email, password);
    console.log(`login ok (${requests} requêtes)`);

    // Expand the root, pick the filière, list its leaves.
    const menu = await openMenu(session);
    const root = await expand(session, menu, ROOT_CHAIN, DELAY_MS);
    const filieres = parseSidebarEntries(root.body).filter(
        (e) => e.kind === "submenu" && !ROOT_CHAIN.includes(e.id)
    );
    console.log(`filières: ${filieres.length}`);

    let leaves: { id: string; label: string; kind: "item" | "submenu" }[] = [];
    let filiere = filieres.find((f) => f.label.includes("CPG"));
    for (const candidate of filiere ? [filiere] : filieres) {
        const fresh = await openMenu(session);
        const opened = await expand(
            session,
            fresh,
            [...ROOT_CHAIN, candidate.id],
            DELAY_MS
        );
        const items = parseSidebarEntries(opened.body).filter(
            (e) => e.kind === "item"
        );
        console.log(`  ${candidate.label}: ${items.length} feuilles`);
        if (items.length >= 2) {
            filiere = candidate;
            leaves = items;
            break;
        }
    }
    if (!filiere || leaves.length < 2) {
        throw new Error("aucune filière avec au moins 2 feuilles trouvée");
    }
    // "Mon Planning" and other odd leaves lead elsewhere than the selection
    // screen — keep only real promotion plannings.
    const plannings = leaves.filter((l) =>
        /planning/i.test(l.label) && !/mon planning/i.test(l.label)
    );
    if (plannings.length < 2) {
        throw new Error("pas assez de feuilles de planning réelles");
    }
    leaves = plannings;
    console.log(
        `filière retenue: ${filiere.label} — feuilles ${leaves
            .map((l) => l.label)
            .join(", ")}`
    );

    // 1. Baseline: the sequence the harvest runs today.
    let mark = Date.now();
    let req = requests;
    const bMenu = await openMenu(session);
    const bOpened = await expand(
        session,
        bMenu,
        [...ROOT_CHAIN, filiere.id],
        DELAY_MS
    );
    const bLeaf = await openLeaf(
        session,
        bMenu,
        bOpened.viewState,
        leaves[0]!.id
    );
    console.log(
        `1. baseline   : ${requests - req} requêtes, ${
            Date.now() - mark
        } ms — écran de sélection: ${isSelectionScreen(bLeaf.body)}`
    );

    await sleep(DELAY_MS);

    // 2. Reuse A: same menu page and ViewState, second leaf, nothing re-paid.
    mark = Date.now();
    req = requests;
    let reuseAOk = false;
    let reuseAError = "";
    try {
        const aLeaf = await openLeaf(
            session,
            bMenu,
            bOpened.viewState,
            leaves[1]!.id
        );
        reuseAOk = isSelectionScreen(aLeaf.body);
    } catch (e) {
        reuseAError = e instanceof Error ? e.message : String(e);
    }
    console.log(
        `2. réutilisation A (rien re-payé): ${
            requests - req
        } requêtes, ${Date.now() - mark} ms — écran de sélection: ${reuseAOk}${
            reuseAError ? ` — erreur: ${reuseAError}` : ""
        }`
    );

    await sleep(DELAY_MS);

    // 2b. Reuse A twice more: a third and fourth post with the same ViewState,
    //     to make sure it is not single-use — a worker needs one per planning.
    mark = Date.now();
    req = requests;
    let reuseA2Ok = false;
    let reuseA2Error = "";
    try {
        const a2Leaf = await openLeaf(
            session,
            bMenu,
            bOpened.viewState,
            leaves[0]!.id
        );
        const a3Leaf = await openLeaf(
            session,
            bMenu,
            bOpened.viewState,
            leaves[1]!.id
        );
        reuseA2Ok = isSelectionScreen(a2Leaf.body) && isSelectionScreen(a3Leaf.body);
    } catch (e) {
        reuseA2Error = e instanceof Error ? e.message : String(e);
    }
    console.log(
        `2b. réutilisation A x2 (3e et 4e posts, même ViewState): ${
            requests - req
        } requêtes, ${Date.now() - mark} ms — écrans de sélection: ${reuseA2Ok}${
            reuseA2Error ? ` — erreur: ${reuseA2Error}` : ""
        }`
    );

    await sleep(DELAY_MS);

    // 3. Reuse B: fresh menu GET, no expand — does the expansion persist?
    mark = Date.now();
    req = requests;
    let reuseBOk = false;
    let reuseBDetail = "";
    try {
        const cMenu: MenuPage = await openMenu(session);
        const entries = parseSidebarEntries(cMenu.body).filter(
            (e) => e.kind === "item"
        );
        const stillListed = entries.some((e) => e.id === leaves[0]!.id);
        const cLeaf = await openLeaf(
            session,
            cMenu,
            cMenu.viewState,
            leaves[0]!.id
        );
        reuseBOk = isSelectionScreen(cLeaf.body);
        reuseBDetail = `feuille visible dans le menu rechargé: ${stillListed}`;
    } catch (e) {
        reuseBDetail = e instanceof Error ? e.message : String(e);
    }
    console.log(
        `3. réutilisation B (menu rechargé, pas re-déplié): ${
            requests - req
        } requêtes, ${Date.now() - mark} ms — écran de sélection: ${reuseBOk} — ${reuseBDetail}`
    );

    console.log(`total: ${requests} requêtes`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
