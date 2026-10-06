/**
 * Dev-only harvester. Walks "Les plannings > Plannings Groupés par Promotion",
 * opens every leaf, ticks every group of the DataTable and dumps one week of
 * events per filière, so the Webapp can be exercised with real plannings from
 * classes other than the developer's own.
 *
 *   npx ts-node -T scripts/aurion-fixtures.ts
 *   npx ts-node -T scripts/aurion-fixtures.ts --only "ISEN CPG2" --week 2026-09-14
 *
 * Credentials come from .env.dev and are never written to the dumps. Nothing
 * here is imported by src/, so it never ships.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";
import { SessionManager } from "../src/routes/aurion/utils/session-manager";

dotenv.config({ path: ".env.dev" });

const BASE = "https://aurion.junia.com";
const FIXTURES = join(__dirname, "dumps", "fixtures");

/** "Les plannings" > "Plannings Groupés par Promotion". */
const ROOT_CHAIN = ["3131476", "7465293"];
/** Aurion is a shared production server: stay slow on purpose. */
const DELAY_MS = 400;

type MenuEntry = { id: string; label: string; kind: "item" | "submenu" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const slugify = (label: string) =>
    label
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

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

const parseViewState = (body: string) =>
    body.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/)?.[1] ?? "";

const parseIdInit = (body: string) =>
    body.match(/name="form:idInit" value="([^"]+)"/)?.[1] ?? "";

const parseSubmenuCommandId = (body: string) =>
    body.match(/PrimeFaces\.ab\(\{s:"([^"]+)"[^)]*u:"form:sidebar"/)?.[1] ??
    "form:j_idt52";

const parsePartialViewState = (body: string) =>
    body.match(
        /<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[([^\]]+)\]\]><\/update>/
    )?.[1] ?? "";

/** Every `<input name=… value=…>` of a form, minus the filter fields. */
function formFields(body: string): URLSearchParams {
    const fields = new URLSearchParams();
    for (const m of body.matchAll(
        /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g
    )) {
        const [, name, value] = m;
        if (name && !name.endsWith(":filter")) fields.append(name, value ?? "");
    }
    return fields;
}

type Session = InstanceType<typeof SessionManager>;

/** A freshly loaded MainMenuPage: the menu state lives on the server. */
async function openMenu(session: Session) {
    await session.client.get(`${BASE}/`, { responseType: "text" });
    const page = await session.client.get(`${BASE}/faces/MainMenuPage.xhtml`, {
        headers: { Referer: `${BASE}/` },
        responseType: "text",
    });
    return {
        body: page.body,
        viewState: parseViewState(page.body),
        idInit: parseIdInit(page.body),
        commandId: parseSubmenuCommandId(page.body),
    };
}

/**
 * Expand the nodes of `chain` in order. A nested node throws a
 * NullPointerException unless its parent was expanded first, and each partial
 * response carries the ViewState the next call has to use.
 */
async function expand(
    session: Session,
    menu: Awaited<ReturnType<typeof openMenu>>,
    chain: string[]
) {
    let viewState = menu.viewState;
    let body = menu.body;

    for (const node of chain) {
        const ajax = new URLSearchParams({
            "javax.faces.partial.ajax": "true",
            "javax.faces.source": menu.commandId,
            "javax.faces.partial.execute": menu.commandId,
            "javax.faces.partial.render": "form:sidebar",
            [menu.commandId]: menu.commandId,
            "webscolaapp.Sidebar.ID_SUBMENU": node,
            form: "form",
            "form:largeurDivCenter": "885",
            "form:idInit": menu.idInit,
            "form:sauvegarde": "",
            "javax.faces.ViewState": viewState,
        });

        const res = await session.client.post(
            `${BASE}/faces/MainMenuPage.xhtml`,
            { body: ajax.toString(), responseType: "text" }
        );
        if (res.body.includes("<error-name>")) {
            throw new Error(
                `sous-menu ${node} : ${res.body.match(/<error-name>([^<]+)/)?.[1]}`
            );
        }
        viewState = parsePartialViewState(res.body) || viewState;
        body = res.body;
        await sleep(DELAY_MS);
    }

    return { body, viewState };
}

/** Row keys of a DataTable, following its paginator when it has one. */
async function allRowKeys(
    session: Session,
    url: string,
    body: string,
    tableId: string
): Promise<string[]> {
    const keys = [...body.matchAll(/data-rk="([^"]+)"/g)].map((m) => m[1] ?? "");
    const widget = body.match(
        /PrimeFaces\.cw\("DataTable","[^"]+",\{id:"[^"]+",paginator:\{[^}]*rows:(\d+),rowCount:(\d+)/
    );
    const rows = Number(widget?.[1] ?? 0);
    const rowCount = Number(widget?.[2] ?? keys.length);
    if (!rows || rowCount <= keys.length) return keys;

    for (let first = keys.length; first < rowCount; first += rows) {
        const fields = formFields(body);
        fields.set("javax.faces.partial.ajax", "true");
        fields.set("javax.faces.source", tableId);
        fields.set("javax.faces.partial.execute", tableId);
        fields.set("javax.faces.partial.render", tableId);
        fields.set(`${tableId}_pagination`, "true");
        fields.set(`${tableId}_first`, String(first));
        fields.set(`${tableId}_rows`, String(rows));
        fields.set(`${tableId}_skipChildren`, "true");
        fields.set(`${tableId}_encodeFeature`, "true");
        fields.set("form", "form");
        fields.set("javax.faces.ViewState", parseViewState(body));

        const res = await session.client.post(url, {
            body: fields.toString(),
            responseType: "text",
        });
        const page = [...res.body.matchAll(/data-rk="([^"]+)"/g)].map(
            (m) => m[1] ?? ""
        );
        if (!page.length) break;
        keys.push(...page);
        await sleep(DELAY_MS);
    }

    return [...new Set(keys)];
}

/** Open a leaf, tick every group, and read one week of events out of it. */
async function harvest(
    session: Session,
    menu: Awaited<ReturnType<typeof openMenu>>,
    viewState: string,
    leaf: MenuEntry,
    week: { start: Date; end: Date }
) {
    const payload = new URLSearchParams({
        form: "form",
        "form:largeurDivCenter": "885",
        "form:idInit": menu.idInit,
        "form:sauvegarde": "",
        "javax.faces.ViewState": viewState,
        "form:sidebar": "form:sidebar",
        "form:sidebar_menuid": leaf.id,
    });
    const posted = await session.client.post(
        `${BASE}/faces/MainMenuPage.xhtml`,
        { body: payload.toString(), responseType: "text" }
    );
    const choiceUrl = posted.headers.location
        ? new URL(posted.headers.location, BASE).toString()
        : `${BASE}/faces/ChoixPlanning.xhtml`;
    const choice = await session.client.get(choiceUrl, {
        headers: { Referer: `${BASE}/faces/MainMenuPage.xhtml` },
        responseType: "text",
    });
    await sleep(DELAY_MS);

    const tableId = choice.body.match(
        /PrimeFaces\.cw\("DataTable","[^"]+",\{id:"([^"]+)"/
    )?.[1];
    const submitId = choice.body.match(
        /<button id="(form:j_idt\d+)"[^>]*>(?:(?!<\/button>)[\s\S])*?Voir planning/
    )?.[1];
    if (!tableId || !submitId) {
        throw new Error("écran de sélection inattendu (DataTable ou bouton)");
    }

    const rowKeys = await allRowKeys(session, choiceUrl, choice.body, tableId);
    if (!rowKeys.length) throw new Error("aucun groupe à cocher");

    const fields = formFields(choice.body);
    fields.set("form", "form");
    fields.set(`${tableId}_selection`, rowKeys.join(","));
    fields.set(submitId, submitId);
    fields.set("javax.faces.ViewState", parseViewState(choice.body));

    const shown = await session.client.post(choiceUrl, {
        body: fields.toString(),
        responseType: "text",
    });
    const planningUrl = shown.headers.location
        ? new URL(shown.headers.location, BASE).toString()
        : `${BASE}/faces/Planning.xhtml`;
    const planning = await session.client.get(planningUrl, {
        headers: { Referer: choiceUrl },
        responseType: "text",
    });
    await sleep(DELAY_MS);

    const scheduleId = planning.body.match(
        /PrimeFaces\.cw\("Schedule","[^"]+",\{id:"([^"]+)"/
    )?.[1];
    if (!scheduleId) throw new Error("widget Schedule introuvable");

    const evFields = formFields(planning.body);
    evFields.set("javax.faces.partial.ajax", "true");
    evFields.set("javax.faces.source", scheduleId);
    evFields.set("javax.faces.partial.execute", scheduleId);
    evFields.set("javax.faces.partial.render", scheduleId);
    evFields.set(scheduleId, scheduleId);
    evFields.set(`${scheduleId}_start`, String(week.start.getTime()));
    evFields.set(`${scheduleId}_end`, String(week.end.getTime()));
    evFields.set(`${scheduleId}_view`, "agendaWeek");
    evFields.set("form", "form");
    evFields.set("form:offsetFuseauNavigateur", "-7200000");
    evFields.set("javax.faces.ViewState", parseViewState(planning.body));

    const res = await session.client.post(planningUrl, {
        body: evFields.toString(),
        responseType: "text",
    });
    const json = res.body.match(/\[\{"id"[\s\S]*?\}\]/)?.[0];
    const events = json ? JSON.parse(json) : [];

    return { rowKeys, events };
}

function argValue(flag: string) {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
    const email = process.env.AURION_EMAIL;
    const password = process.env.AURION_PASSWORD;
    if (!email || !password) {
        console.error("AURION_EMAIL et AURION_PASSWORD requis (.env.dev).");
        process.exit(1);
    }

    const only = argValue("--only")?.toLowerCase();
    const weekArg = argValue("--week");
    const start = weekArg ? new Date(`${weekArg}T00:00:00`) : new Date();
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const week = { start, end };

    mkdirSync(FIXTURES, { recursive: true });

    const session = new SessionManager();
    console.log(`Connexion en tant que ${email} …`);
    await session.login(email, password);

    console.log("Énumération des filières …");
    const menu = await openMenu(session);
    const before = new Set(
        parseSidebarEntries(menu.body).map((e) => `${e.kind}:${e.id}`)
    );
    const root = await expand(session, menu, ROOT_CHAIN);
    const filieres = parseSidebarEntries(root.body).filter(
        (e) => e.kind === "submenu" && !before.has(`${e.kind}:${e.id}`)
    );
    console.log(`  ${filieres.length} filières.\n`);

    const report: Array<Record<string, unknown>> = [];

    for (const filiere of filieres) {
        if (only && !filiere.label.toLowerCase().includes(only)) continue;

        // The menu is stateful, so every filière is walked from a fresh page.
        const fresh = await openMenu(session);
        const seen = new Set(
            parseSidebarEntries(fresh.body).map((e) => `${e.kind}:${e.id}`)
        );
        const opened = await expand(session, fresh, [
            ...ROOT_CHAIN,
            filiere.id,
        ]);
        const leaves = parseSidebarEntries(opened.body).filter(
            (e) => e.kind === "item" && !seen.has(`${e.kind}:${e.id}`)
        );
        console.log(
            `${filiere.label} (${filiere.id}) — ${leaves.length} planning(s)`
        );

        for (const leaf of leaves) {
            const slug = slugify(leaf.label);
            try {
                const { rowKeys, events } = await harvest(
                    session,
                    fresh,
                    opened.viewState,
                    leaf,
                    week
                );
                writeFileSync(
                    join(FIXTURES, `${slug}.json`),
                    JSON.stringify(
                        {
                            label: leaf.label,
                            menuid: leaf.id,
                            weekStart: start.toISOString().slice(0, 10),
                            groups: rowKeys,
                            events,
                        },
                        null,
                        2
                    )
                );
                console.log(
                    `   ✓ ${leaf.label.padEnd(26)} ${String(rowKeys.length).padStart(3)} groupes, ${String(events.length).padStart(3)} événements -> fixtures/${slug}.json`
                );
                report.push({
                    filiere: filiere.label,
                    planning: leaf.label,
                    menuid: leaf.id,
                    groups: rowKeys.length,
                    events: events.length,
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : err;
                console.log(`   ✗ ${leaf.label.padEnd(26)} ${message}`);
                report.push({
                    filiere: filiere.label,
                    planning: leaf.label,
                    menuid: leaf.id,
                    error: String(message),
                });
            }
            await sleep(DELAY_MS);
        }
    }

    writeFileSync(
        join(FIXTURES, "_index.json"),
        JSON.stringify(
            { weekStart: start.toISOString().slice(0, 10), plannings: report },
            null,
            2
        )
    );
    const ok = report.filter((r) => !r.error).length;
    console.log(`\n${ok}/${report.length} plannings récoltés.`);
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
});
