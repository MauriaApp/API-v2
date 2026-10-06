/**
 * Dev-only Aurion explorer. Logs in, lists every sidebar entry with its
 * menuid, and optionally dumps the page a given menuid leads to.
 *
 *   AURION_EMAIL=… AURION_PASSWORD=… npx ts-node scripts/aurion-explore.ts
 *   … npx ts-node scripts/aurion-explore.ts --menuid 123456
 *
 * Credentials are read from the environment (or .env.dev) and never written
 * to the dumps. Nothing here is imported by src/, so it never ships.
 */

import { writeFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";
import { SessionManager } from "../src/routes/aurion/utils/session-manager";

dotenv.config({ path: ".env.dev" });

const BASE = "https://aurion.junia.com";
const DUMPS = join(__dirname, "dumps");

type MenuEntry = { id: string; label: string; kind: "item" | "submenu" };

/**
 * Sidebar entries, of two kinds: leaves submit a "sidebar_menuid", parents
 * lazy-load their children through their "submenu_<id>" class.
 */
function parseSidebarEntries(body: string): MenuEntry[] {
    const entries: MenuEntry[] = [];
    const seen = new Set<string>();

    const push = (id: string, label: string, kind: MenuEntry["kind"]) => {
        const key = `${kind}:${id}`;
        if (seen.has(key)) return;
        seen.add(key);
        entries.push({ id, label: label.trim(), kind });
    };

    const leaf =
        /'form:sidebar_menuid':'([\w_]+)'[\s\S]{0,400}?<span class="ui-menuitem-text">([^<]+)<\/span>/g;
    for (const m of body.matchAll(leaf)) {
        if (m[1] && m[2]) push(m[1], m[2], "item");
    }

    const parent =
        /submenu_(\d+)[\s\S]{0,300}?<span class="ui-menuitem-text">([^<]+)<\/span>/g;
    for (const m of body.matchAll(parent)) {
        if (m[1] && m[2]) push(m[1], m[2], "submenu");
    }

    return entries;
}

function parseViewState(body: string): string {
    return (
        body.match(
            /name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/
        )?.[1] ?? ""
    );
}

function parseIdInit(body: string): string {
    return body.match(/name="form:idInit" value="([^"]+)"/)?.[1] ?? "";
}

/** Source id of the p:remoteCommand that lazy-loads a submenu. */
function parseSubmenuCommandId(body: string): string {
    return (
        body.match(
            /PrimeFaces\.ab\(\{s:"([^"]+)"[^)]*u:"form:sidebar"/
        )?.[1] ?? "form:j_idt52"
    );
}

/** Partial responses carry a refreshed ViewState to use for the next call. */
function parsePartialViewState(body: string): string {
    return (
        body.match(
            /<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[([^\]]+)\]\]><\/update>/
        )?.[1] ?? ""
    );
}

function dump(name: string, content: string) {
    const path = join(DUMPS, name);
    writeFileSync(path, content);
    console.log(`  -> ${path} (${content.length} octets)`);
}

async function main() {
    const email = process.env.AURION_EMAIL;
    const password = process.env.AURION_PASSWORD;
    if (!email || !password) {
        console.error(
            "AURION_EMAIL et AURION_PASSWORD requis (env ou .env.dev)."
        );
        process.exit(1);
    }

    const menuidArg = process.argv.indexOf("--menuid");
    const wantedMenuid =
        menuidArg !== -1 ? process.argv[menuidArg + 1] : undefined;

    const session = new SessionManager();
    console.log(`Connexion en tant que ${email} …`);
    await session.login(email, password);
    console.log("Connecté.\n");

    const home = await session.client.get(`${BASE}/`, {
        responseType: "text",
    });
    let viewState = parseViewState(home.body);
    const idInit = parseIdInit(home.body);

    const menuPage = await session.client.get(`${BASE}/faces/MainMenuPage.xhtml`, {
        headers: { Referer: `${BASE}/` },
        responseType: "text",
    });
    dump("main-menu.html", menuPage.body);

    // A partial AJAX must carry the ViewState of the view it posts to.
    const menuViewState = parseViewState(menuPage.body) || viewState;
    const submenuCommandId = parseSubmenuCommandId(menuPage.body);

    const entries = parseSidebarEntries(menuPage.body);
    console.log(`\n${entries.length} entrées de menu trouvées :\n`);
    for (const { id, label, kind } of entries) {
        console.log(`  ${kind.padEnd(8)} ${id.padEnd(10)} ${label}`);
    }

    const submenuArg = process.argv.indexOf("--submenu");
    const wantedSubmenu =
        submenuArg !== -1 ? process.argv[submenuArg + 1] : undefined;

    if (wantedSubmenu) {
        // Children are lazy-loaded by the "chargerSousMenu" p:remoteCommand,
        // and the server tracks which node is open: a nested submenu throws a
        // NullPointerException unless its parent was expanded first. Pass the
        // whole path, e.g. --submenu 3131476,7465293
        const chain = wantedSubmenu.split(",").filter(Boolean);
        let currentViewState = menuViewState;
        let last = "";

        for (const node of chain) {
            console.log(`\nChargement du sous-menu ${node} …`);
            const ajax = new URLSearchParams({
                "javax.faces.partial.ajax": "true",
                "javax.faces.source": submenuCommandId,
                "javax.faces.partial.execute": submenuCommandId,
                "javax.faces.partial.render": "form:sidebar",
                [submenuCommandId]: submenuCommandId,
                "webscolaapp.Sidebar.ID_SUBMENU": node,
                form: "form",
                "form:largeurDivCenter": "885",
                "form:idInit": idInit,
                "form:sauvegarde": "",
                "javax.faces.ViewState": currentViewState,
            }).toString();

            const res = await session.client.post(
                `${BASE}/faces/MainMenuPage.xhtml`,
                { body: ajax, responseType: "text" }
            );
            dump(`submenu-${node}.xml`, res.body);

            if (res.body.includes("<error-name>")) {
                console.error(
                    `  échec: ${res.body.match(/<error-name>([^<]+)/)?.[1]}`
                );
                return;
            }
            currentViewState = parsePartialViewState(res.body) || currentViewState;
            last = res.body;
        }

        const children = parseSidebarEntries(last);
        console.log(`\n${children.length} entrée(s) après ce chemin :\n`);
        for (const { id, label, kind } of children) {
            console.log(`  ${kind.padEnd(8)} ${id.padEnd(10)} ${label}`);
        }
        if (!wantedMenuid) return;
        viewState = currentViewState;
    }

    if (!wantedMenuid) {
        console.log(
            "\nRelance avec --menuid <id> pour ouvrir une entrée et dumper la page."
        );
        return;
    }

    console.log(`\nOuverture du menuid ${wantedMenuid} …`);
    const payload = new URLSearchParams({
        form: "form",
        "form:largeurDivCenter": "885",
        "form:idInit": idInit,
        "form:sauvegarde": "",
        "javax.faces.ViewState": viewState || menuViewState,
        "form:sidebar": "form:sidebar",
        "form:sidebar_menuid": wantedMenuid,
    }).toString();

    const posted = await session.client.post(
        `${BASE}/faces/MainMenuPage.xhtml`,
        { body: payload, responseType: "text" }
    );
    dump(`menu-${wantedMenuid}-post.html`, posted.body);

    // The sidebar POST usually redirects; follow it manually to see the page.
    const location = posted.headers.location;
    const target = location
        ? new URL(location, BASE).toString()
        : `${BASE}/faces/Planning.xhtml`;
    console.log(`Page cible : ${target}`);

    const page = await session.client.get(target, {
        headers: { Referer: `${BASE}/faces/MainMenuPage.xhtml` },
        responseType: "text",
    });
    dump(`menu-${wantedMenuid}-page.html`, page.body);

    if (!process.argv.includes("--select-all")) return;

    // The checkbox DataTable ships its selection as one hidden field, so the
    // whole "tick every row on every page" dance is a single POST.
    const tableId = page.body.match(
        /PrimeFaces\.cw\("DataTable","[^"]+",\{id:"([^"]+)"/
    )?.[1];
    const submitId = page.body.match(
        /<button id="(form:j_idt\d+)"[^>]*>(?:(?!<\/button>)[\s\S])*?Voir planning/
    )?.[1];
    const rowKeys = [...page.body.matchAll(/data-rk="([^"]+)"/g)].map(
        (m) => m[1]
    );

    console.log(`\nDataTable ${tableId} — ${rowKeys.length} lignes`);
    console.log(`Bouton de validation : ${submitId}`);
    if (!tableId || !submitId || !rowKeys.length) {
        console.error("Structure inattendue, abandon.");
        return;
    }

    // Replay every field the form already carries, then override the selection.
    const fields = new URLSearchParams();
    for (const m of page.body.matchAll(
        /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g
    )) {
        const [, name, value] = m;
        if (name && !name.endsWith(":filter")) fields.append(name, value ?? "");
    }
    fields.set("form", "form");
    fields.set(`${tableId}_selection`, rowKeys.join(","));
    fields.set(submitId, submitId);
    fields.set("javax.faces.ViewState", parseViewState(page.body));

    const shown = await session.client.post(target, {
        body: fields.toString(),
        responseType: "text",
    });
    console.log(`POST "Voir planning" -> HTTP ${shown.statusCode}`);

    const redirect = shown.headers.location;
    const finalUrl = redirect
        ? new URL(redirect, BASE).toString()
        : `${BASE}/faces/Planning.xhtml`;
    const planning = await session.client.get(finalUrl, {
        headers: { Referer: target },
        responseType: "text",
    });
    console.log(`Page planning : ${finalUrl}`);
    dump("planning-groupe.html", planning.body);

    // Same AJAX the personal planning uses, against this page's Schedule id.
    const scheduleId = planning.body.match(
        /PrimeFaces\.cw\("Schedule","[^"]+",\{id:"([^"]+)"/
    )?.[1];
    if (!scheduleId) {
        console.error("Widget Schedule introuvable.");
        return;
    }
    console.log(`Schedule : ${scheduleId}`);

    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 7);

    const evFields = new URLSearchParams();
    for (const m of planning.body.matchAll(
        /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g
    )) {
        const [, name, value] = m;
        if (name && !name.endsWith(":filter")) evFields.append(name, value ?? "");
    }
    evFields.set("javax.faces.partial.ajax", "true");
    evFields.set("javax.faces.source", scheduleId);
    evFields.set("javax.faces.partial.execute", scheduleId);
    evFields.set("javax.faces.partial.render", scheduleId);
    evFields.set(scheduleId, scheduleId);
    evFields.set(`${scheduleId}_start`, String(monday.getTime()));
    evFields.set(`${scheduleId}_end`, String(sunday.getTime()));
    evFields.set(`${scheduleId}_view`, "agendaWeek");
    evFields.set("form", "form");
    evFields.set("form:offsetFuseauNavigateur", "-7200000");
    evFields.set("javax.faces.ViewState", parseViewState(planning.body));

    const res = await session.client.post(finalUrl, {
        body: evFields.toString(),
        responseType: "text",
    });
    const json = res.body.match(/\[\{"id"[\s\S]*?\}\]/)?.[0];
    if (!json) {
        dump("events-raw.xml", res.body);
        console.error("Pas de JSON d'événements dans la réponse.");
        return;
    }
    const events = JSON.parse(json);
    dump("events-cpg2.json", JSON.stringify(events, null, 2));
    console.log(`\n${events.length} événements pour la semaine du ${monday.toLocaleDateString("fr-FR")}`);
    for (const e of events.slice(0, 3)) {
        console.log("  ---");
        for (const line of String(e.title).split("\n")) console.log("   ", line);
    }
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
