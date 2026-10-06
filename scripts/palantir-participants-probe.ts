/**
 * Dev-only probe: how does Aurion's "Participants" tab fetch its student list?
 *
 * Clicking an event on a planning opens the form:modaleDetail dialog through
 * the Schedule widget's eventSelect behavior (see the dump
 * planning-groupe.html: tabs "Ressources / Apprenants () / Groupes / Cours").
 * That dialog is where a promotion's student roster lives — the data source
 * for indexing students (never exposed through /palantir/search).
 *
 * The exact param name PrimeFaces uses to carry the selected event id is not
 * guessable from the dump alone (it depends on the PF version's schedule.js),
 * so this probe replays the whole live sequence with one group ticked and
 * tries each plausible candidate. The first response that renders the dialog
 * without an <error-name> is written to scripts/dumps/participants-response.html.
 *
 *   npx ts-node -T scripts/palantir-participants-probe.ts
 *
 * Target planning via env: PROBE_FILIERE (filière label regex, default CPG)
 * and PROBE_PLANNING (leaf label regex, default CPG2).
 *
 * Credentials come from .env.dev, nothing identifying is printed.
 */

import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
import {
    BASE,
    MenuPage,
    ROOT_CHAIN,
    expand,
    formFields,
    newSession,
    openLeaf,
    openMenu,
    parsePartialViewState,
    parseSidebarEntries,
    parseViewState,
    sleep,
} from "../src/routes/palantir/utils/aurion-menu";

dotenv.config({ path: ".env.dev" });

const DELAY_MS = 150;
const DUMPS_DIR = path.join(__dirname, "dumps");

const isChoiceScreen = (body: string) =>
    body.includes('PrimeFaces.cw("DataTable"') &&
    body.includes("Voir planning") &&
    !body.includes("<error-name>");

const stripTags = (html: string) =>
    html.replace(/<[^>]*>/g, "").trim();

/** Copy of the harvester's parseChoiceIds (private there). */
function parseChoiceIds(body: string) {
    const tableId = body.match(
        /PrimeFaces\.cw\("DataTable","[^"]+",\{id:"([^"]+)"/
    )?.[1];
    const submitId = body.match(
        /<button id="(form:j_idt\d+)"[^>]*>(?:(?!<\/button>)[\s\S])*?Voir planning/
    )?.[1];
    if (!tableId || !submitId) {
        throw new Error("écran de sélection inattendu (DataTable ou bouton)");
    }
    return { tableId, submitId };
}

/** Copy of the harvester's parseGroupRows, first page only. */
function parseGroupRows(body: string) {
    const rows: Array<{ rowKey: string; code: string; label: string; type: string }> = [];
    for (const m of body.matchAll(
        /<tr[^>]*data-rk="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g
    )) {
        const cells = [...(m[2] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
            .map((c) => stripTags(c[1] ?? ""));
        if (!m[1]) continue;
        rows.push({
            rowKey: m[1],
            code: cells[1] ?? "",
            label: cells[2] ?? "",
            type: cells[4] ?? "",
        });
    }
    return rows;
}

async function main() {
    const email = process.env.AURION_EMAIL;
    const password = process.env.AURION_PASSWORD;
    if (!email || !password) {
        throw new Error("AURION_EMAIL et AURION_PASSWORD requis (env ou .env.dev).");
    }

    const session = newSession();
    await session.login(email, password);
    console.log("login ok");

    // Menu preamble: expand the root, pick the filière, list its leaves.
    const menu: MenuPage = await openMenu(session);
    const root = await expand(session, menu, ROOT_CHAIN, DELAY_MS);
    const filieres = parseSidebarEntries(root.body).filter(
        (e) => e.kind === "submenu" && !ROOT_CHAIN.includes(e.id)
    );
    const filiereRe = new RegExp(process.env.PROBE_FILIERE ?? "CPG", "i");
    const leafRe = new RegExp(process.env.PROBE_PLANNING ?? "CPG2", "i");
    const filiere = filieres.find((f) => filiereRe.test(f.label));
    if (!filiere) throw new Error(`filière ${filiereRe} introuvable`);
    const fresh = await openMenu(session);
    const opened = await expand(session, fresh, [...ROOT_CHAIN, filiere.id], DELAY_MS);
    const leaf = parseSidebarEntries(opened.body).find(
        (e) => e.kind === "item" && leafRe.test(e.label)
    );
    if (!leaf) throw new Error(`feuille ${leafRe} introuvable`);
    console.log(`planning: ${leaf.label} (filière ${filiere.label})`);

    // Open the selection screen, tick one class row only.
    const choice = await openLeaf(
        session,
        fresh,
        opened.viewState,
        leaf.id
    );
    if (!isChoiceScreen(choice.body)) {
        throw new Error("écran de sélection non reconnu");
    }
    const { tableId, submitId } = parseChoiceIds(choice.body);
    const rows = parseGroupRows(choice.body);
    const promotionRe = new RegExp(process.env.PROBE_PROMOTION ?? "", "i");
    const promotion =
        rows.find((r) => r.type === "Promotion" && promotionRe.test(r.label)) ??
        rows.find((r) => r.type === "Promotion") ??
        rows[0];
    if (!promotion) throw new Error("aucune ligne de groupe");
    console.log(
        `groupe coché: ${promotion.label || promotion.code} (${promotion.type || "?"})`
    );

    // "Voir planning" with that single row → land on the Schedule page.
    const shown = await session.client.post(choice.url, {
        body: new URLSearchParams({
            ...Object.fromEntries(formFields(choice.body)),
            form: "form",
            [`${tableId}_selection`]: promotion.rowKey,
            [submitId]: submitId,
            "javax.faces.ViewState": parseViewState(choice.body),
        }).toString(),
        responseType: "text",
    });
    const planningUrl = shown.headers.location
        ? new URL(shown.headers.location, BASE).toString()
        : `${BASE}/faces/Planning.xhtml`;
    const planning = await session.client.get(planningUrl, {
        headers: { Referer: choice.url },
        responseType: "text",
    });
    await sleep(DELAY_MS);

    const scheduleId = planning.body.match(
        /PrimeFaces\.cw\("Schedule","[^"]+",\{id:"([^"]+)"/
    )?.[1];
    if (!scheduleId) throw new Error("widget Schedule introuvable");
    console.log(`planning chargé (${scheduleId})`);

    // Fetch one week of events to get a real event id.
    const now = Date.now();
    const ev = formFields(planning.body);
    ev.set("javax.faces.partial.ajax", "true");
    ev.set("javax.faces.source", scheduleId);
    ev.set("javax.faces.partial.execute", scheduleId);
    ev.set("javax.faces.partial.render", scheduleId);
    ev.set(scheduleId, scheduleId);
    ev.set(`${scheduleId}_start`, String(now - 7 * 24 * 3600 * 1000));
    ev.set(`${scheduleId}_end`, String(now + 28 * 24 * 3600 * 1000));
    ev.set(`${scheduleId}_view`, "agendaWeek");
    ev.set("form", "form");
    ev.set("form:offsetFuseauNavigateur", "-7200000");
    ev.set("javax.faces.ViewState", parseViewState(planning.body));
    const eventsRes = await session.client.post(planningUrl, {
        body: ev.toString(),
        responseType: "text",
    });
    const eventsJson = eventsRes.body.match(/\[\{"id"[\s\S]*?\}\]/)?.[0];
    const events: Array<{ id: string; title: string }> = eventsJson
        ? JSON.parse(eventsJson)
        : [];
    if (!events.length) throw new Error("aucun événement dans la fenêtre");
    // Partial responses hand back a refreshed ViewState — the eventSelect
    // must use it, not the one the planning page was loaded with.
    const viewState =
        parsePartialViewState(eventsRes.body) || parseViewState(planning.body);

    /** Course signature: course, type, teacher — anchored on the time range. */
    const signature = (event: { title: string }) => {
        const lines = event.title
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
        const timeIndex = lines.findIndex((l) =>
            /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/.test(l)
        );
        if (timeIndex < 2) return lines.join(" | ");
        return [
            lines[timeIndex - 2] ?? "",
            lines[timeIndex - 1] ?? "",
            lines[timeIndex + 1] ?? "",
        ].join(" | ");
    };

    // One representative per distinct course, most frequent first.
    const freq = new Map<string, number>();
    const byCourse = new Map<string, { id: string; title: string }>();
    for (const event of events) {
        if (typeof event?.id !== "string") continue;
        const sig = signature(event);
        freq.set(sig, (freq.get(sig) ?? 0) + 1);
        if (!byCourse.has(sig)) byCourse.set(sig, event);
    }
    const courses = [...byCourse.entries()].sort(
        (a, b) => (freq.get(b[0]) ?? 0) - (freq.get(a[0]) ?? 0)
    );
    console.log(
        `${events.length} événements, ${courses.length} cours distincts — ` +
            `un clic par cours, plus fréquent d'abord`
    );

    /** Rows of the Apprenants DataTable of an eventSelect response. */
    const parseParticipants = (partial: string) => {
        const tbody = partial.match(
            /<tbody id="form:onglets:apprenantsTable_data"[^>]*>([\s\S]*?)<\/tbody>/
        )?.[1];
        if (!tbody || tbody.includes("ui-datatable-empty-message")) return [];
        const students: Array<[string, string]> = [];
        for (const m of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
            const cells = [...(m[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
                .map((c) => c[1] ?? "")
                .map((c) =>
                    c
                        .replace(/<[^>]*>/g, "")
                        .replace(/&amp;/g, "&")
                        .replace(/&nbsp;/g, " ")
                        .trim()
                );
            if (cells.length < 2) continue;
            if (cells[0] && cells[1]) students.push([cells[0], cells[1]]);
        }
        return students;
    };

    /** Group codes of the event dialog's "Groupes" tab. */
    const parseGroups = (partial: string) => {
        const tbody = partial.match(
            /<tbody id="form:onglets:j_idt212_data"[^>]*>([\s\S]*?)<\/tbody>/
        )?.[1];
        if (!tbody || tbody.includes("ui-datatable-empty-message")) return [];
        const codes: string[] = [];
        for (const m of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
            const code = (m[1] ?? "")
                .match(/<td[^>]*>([\s\S]*?)<\/td>/)?.[1];
            const clean = (code ?? "")
                .replace(/<[^>]*>/g, "")
                .replace(/&amp;/g, "&")
                .trim();
            if (clean) codes.push(clean);
        }
        return codes;
    };

    const seen = new Set<string>();
    let state = viewState;
    let union = 0;
    for (const [index, [sig, rep]] of courses.entries()) {
        const body = formFields(planning.body);
        body.set("javax.faces.partial.ajax", "true");
        body.set("javax.faces.source", scheduleId);
        body.set("javax.faces.partial.execute", scheduleId);
        body.set("javax.faces.partial.render", "form:modaleDetail form:confirmerSuppression");
        body.set("javax.faces.behavior.event", "eventSelect");
        body.set("javax.faces.partial.event", "eventSelect");
        body.set(`${scheduleId}_selectedEventId`, rep.id);
        body.set("form", "form");
        body.set("form:offsetFuseauNavigateur", "-7200000");
        body.set("javax.faces.ViewState", state);

        const res = await session.client.post(planningUrl, {
            body: body.toString(),
            responseType: "text",
        });
        const error = res.body.match(/<error-name>([^<]+)/)?.[1];
        if (error) {
            console.log(`${index + 1}. ${sig} → erreur: ${error}`);
            continue;
        }
        const students = parseParticipants(res.body);
        const groups = parseGroups(res.body);
        const fresh = students.filter(
            (s) => !seen.has(`${s[0]}|${s[1]}`)
        );
        for (const s of fresh) seen.add(`${s[0]}|${s[1]}`);
        union += fresh.length;
        console.log(
            `${index + 1}. ${sig} — roster ${students.length}, +${fresh.length} → union ${union}` +
                ` | groupes: ${groups.join(", ") || "(aucun)"}`
        );
        state = parsePartialViewState(res.body) || state;
        await sleep(DELAY_MS);
    }
    console.log(`union finale: ${union} étudiant(s)`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
