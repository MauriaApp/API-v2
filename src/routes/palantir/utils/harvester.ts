/**
 * Harvesting primitives for Palantir: enumerate the promotion plannings, read
 * their group-selection tables, and pull lessons out of the Schedule widget.
 *
 * Aurion is a shared production server and its session state lives server
 * side, so a single session is strictly sequential. Concurrency is obtained
 * by running several independent SessionManagers instead (see runPool).
 */

import {
    BASE,
    MenuPage,
    ROOT_CHAIN,
    Session,
    expand,
    formFields,
    newSession,
    openLeaf,
    openMenu,
    parsePartialViewState,
    parseSidebarEntries,
    parseViewState,
    sleep,
} from "./aurion-menu";
import {
    PalantirGroup,
    PalantirLesson,
    PalantirPlanningNode,
    PalantirStudent,
} from "../../../types/palantir";

/**
 * Politeness delay between two calls of the same worker. Overridable so the
 * external harvester can slow down further without a code change.
 */
export const DELAY_MS = Number(process.env.PALANTIR_DELAY_MS ?? 400);

/**
 * Independent Aurion sessions used to harvest in parallel. The API itself no
 * longer harvests — the weekly build runs on a dedicated machine outside Fly,
 * one planning after the other, precisely because parallel harvests are what
 * got Junia's firewall to ban the API's egress IP (2026-09-23/24).
 */
export const WORKERS = Number(process.env.PALANTIR_WORKERS ?? 1);

export interface HarvestWindow {
    start: number;
    end: number;
}

/**
 * Walk the promotion tree and list every planning leaf. The sidebar is
 * stateful, so each filière is expanded from a freshly loaded menu and the
 * entries already present before the expansion are subtracted out.
 */
export async function discoverPlannings(
    session: Session
): Promise<PalantirPlanningNode[]> {
    const menu = await openMenu(session);
    const before = new Set(
        parseSidebarEntries(menu.body).map((e) => `${e.kind}:${e.id}`)
    );
    const root = await expand(session, menu, ROOT_CHAIN, DELAY_MS);
    const filieres = parseSidebarEntries(root.body).filter(
        (e) =>
            e.kind === "submenu" &&
            !before.has(`${e.kind}:${e.id}`) &&
            // Expanding the root lists the root itself among its children.
            !ROOT_CHAIN.includes(e.id)
    );

    const nodes: PalantirPlanningNode[] = [];
    for (const filiere of filieres) {
        const fresh = await openMenu(session);
        const seen = new Set(
            parseSidebarEntries(fresh.body).map((e) => `${e.kind}:${e.id}`)
        );
        const opened = await expand(
            session,
            fresh,
            [...ROOT_CHAIN, filiere.id],
            DELAY_MS
        );
        for (const leaf of parseSidebarEntries(opened.body)) {
            if (leaf.kind !== "item") continue;
            if (seen.has(`${leaf.kind}:${leaf.id}`)) continue;
            nodes.push({
                menuid: leaf.id,
                label: leaf.label,
                filiereId: filiere.id,
                filiere: filiere.label,
            });
        }
        await sleep(DELAY_MS);
    }

    return nodes;
}

/**
 * A worker's cached menu page: which filière it can open leaves of, with the
 * ViewState those leaf posts reuse. Verified live (scripts/palantir-menu-reuse.ts):
 * a leaf post neither consumes the ViewState nor disturbs the server-side
 * expansion, so the openMenu+expand preamble is paid once per worker and
 * filière instead of once per planning.
 */
export interface MenuContext {
    menu: MenuPage;
    viewState: string;
    filiereId: string;
}

/** The selection screen is the DataTable with its "Voir planning" button. */
const isChoiceScreen = (body: string) =>
    body.includes('PrimeFaces.cw("DataTable"') &&
    body.includes("Voir planning") &&
    !body.includes("<error-name>");

/** The menu preamble — 5 requests — or the cached one when it still matches. */
async function ensureMenu(
    session: Session,
    ctx: MenuContext | null,
    node: PalantirPlanningNode
): Promise<MenuContext> {
    if (ctx && ctx.filiereId === node.filiereId) return ctx;
    const menu = await openMenu(session);
    const opened = await expand(
        session,
        menu,
        [...ROOT_CHAIN, node.filiereId],
        DELAY_MS
    );
    return { menu, viewState: opened.viewState, filiereId: node.filiereId };
}

/**
 * Open a planning's selection screen through a cached menu context. If the
 * reused page turns out not to work after all (session recycled, Aurion
 * restarted…), pay the preamble again and retry once before giving up.
 */
async function openChoice(
    session: Session,
    ctx: MenuContext,
    node: PalantirPlanningNode
): Promise<{ url: string; body: string; ctx: MenuContext }> {
    const leaf = await openLeaf(session, ctx.menu, ctx.viewState, node.menuid);
    if (isChoiceScreen(leaf.body)) {
        return { url: leaf.url, body: leaf.body, ctx };
    }
    const fresh = await ensureMenu(session, null, node);
    const retry = await openLeaf(
        session,
        fresh.menu,
        fresh.viewState,
        node.menuid
    );
    if (!isChoiceScreen(retry.body)) {
        throw new Error("écran de sélection introuvable");
    }
    return { url: retry.url, body: retry.body, ctx: fresh };
}

const stripTags = (html: string) =>
    html
        .replace(/<[^>]*>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .trim();

/**
 * Rows of the selection DataTable. Columns are, in order: selection checkbox,
 * code, libellé, fin de validité, and the kind Aurion itself assigns —
 * "Promotion" for a class, "Planning" for one of its subgroups.
 */
function parseGroupRows(
    body: string,
    node: PalantirPlanningNode
): PalantirGroup[] {
    const rows: PalantirGroup[] = [];
    for (const m of body.matchAll(
        /<tr[^>]*data-rk="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g
    )) {
        const rowKey = m[1];
        const cells = [...(m[2] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
            .map((c) => stripTags(c[1] ?? ""));
        if (!rowKey) continue;
        rows.push({
            rowKey,
            code: cells[1] ?? "",
            label: cells[2] ?? "",
            type: cells[4] ?? "",
            menuid: node.menuid,
            planningLabel: node.label,
        });
    }
    return rows;
}

/** Follow the DataTable paginator when the promotion has more rows than a page. */
async function readAllGroups(
    session: Session,
    url: string,
    body: string,
    tableId: string,
    node: PalantirPlanningNode
): Promise<PalantirGroup[]> {
    const groups = parseGroupRows(body, node);
    const widget = body.match(
        /PrimeFaces\.cw\("DataTable","[^"]+",\{id:"[^"]+",paginator:\{[^}]*rows:(\d+),rowCount:(\d+)/
    );
    const rows = Number(widget?.[1] ?? 0);
    const rowCount = Number(widget?.[2] ?? groups.length);
    if (!rows || rowCount <= groups.length) return groups;

    for (let first = groups.length; first < rowCount; first += rows) {
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
        const page = parseGroupRows(res.body, node);
        if (!page.length) break;
        groups.push(...page);
        await sleep(DELAY_MS);
    }

    const seen = new Set<string>();
    return groups.filter((g) =>
        seen.has(g.rowKey) ? false : (seen.add(g.rowKey), true)
    );
}

/** A planning page opened by ticking `rowKeys` on the selection screen. */
interface GroupPlanning {
    url: string;
    body: string;
    scheduleId: string;
}

/**
 * Tick `rowKeys`, land on the Schedule, and return the live planning page.
 */
async function openGroupPlanning(
    session: Session,
    choiceUrl: string,
    choiceBody: string,
    tableId: string,
    submitId: string,
    rowKeys: string[]
): Promise<GroupPlanning> {
    const fields = formFields(choiceBody);
    fields.set("form", "form");
    fields.set(`${tableId}_selection`, rowKeys.join(","));
    fields.set(submitId, submitId);
    fields.set("javax.faces.ViewState", parseViewState(choiceBody));

    const shown = await session.client.post(choiceUrl, {
        body: fields.toString(),
        responseType: "text",
    });
    const url = shown.headers.location
        ? new URL(shown.headers.location, BASE).toString()
        : `${BASE}/faces/Planning.xhtml`;
    const planning = await session.client.get(url, {
        headers: { Referer: choiceUrl },
        responseType: "text",
    });
    await sleep(DELAY_MS);

    const scheduleId = planning.body.match(
        /PrimeFaces\.cw\("Schedule","[^"]+",\{id:"([^"]+)"/
    )?.[1];
    if (!scheduleId) throw new Error("widget Schedule introuvable");
    return { url, body: planning.body, scheduleId };
}

/**
 * Ask the Schedule widget for the events of `window` — a single pass can
 * cover several weeks. Also hands back the refreshed ViewState the next
 * partial request on this page must use.
 */
async function requestEvents(
    session: Session,
    page: GroupPlanning,
    window: HarvestWindow
): Promise<{ events: PalantirLesson[]; viewState: string }> {
    const ev = formFields(page.body);
    ev.set("javax.faces.partial.ajax", "true");
    ev.set("javax.faces.source", page.scheduleId);
    ev.set("javax.faces.partial.execute", page.scheduleId);
    ev.set("javax.faces.partial.render", page.scheduleId);
    ev.set(page.scheduleId, page.scheduleId);
    ev.set(`${page.scheduleId}_start`, String(window.start));
    ev.set(`${page.scheduleId}_end`, String(window.end));
    ev.set(`${page.scheduleId}_view`, "agendaWeek");
    ev.set("form", "form");
    ev.set("form:offsetFuseauNavigateur", "-7200000");
    ev.set("javax.faces.ViewState", parseViewState(page.body));

    const res = await session.client.post(page.url, {
        body: ev.toString(),
        responseType: "text",
    });
    const json = res.body.match(/\[\{"id"[\s\S]*?\}\]/)?.[0];
    return {
        events: json ? (JSON.parse(json) as PalantirLesson[]) : [],
        viewState:
            parsePartialViewState(res.body) || parseViewState(page.body),
    };
}

/**
 * The lessons of one set of rows, read in one pass over `window`.
 */
async function readLessons(
    session: Session,
    choiceUrl: string,
    choiceBody: string,
    tableId: string,
    submitId: string,
    rowKeys: string[],
    window: HarvestWindow
): Promise<PalantirLesson[]> {
    const page = await openGroupPlanning(
        session,
        choiceUrl,
        choiceBody,
        tableId,
        submitId,
        rowKeys
    );
    const { events } = await requestEvents(session, page, window);
    return events;
}

/** Rows of the event dialog's Apprenants DataTable — Nom, then Prénom. */
function parseParticipants(partial: string): PalantirStudent[] {
    const tbody = partial.match(
        /<tbody id="form:onglets:apprenantsTable_data"[^>]*>([\s\S]*?)<\/tbody>/
    )?.[1];
    if (!tbody || tbody.includes("ui-datatable-empty-message")) return [];

    const students: PalantirStudent[] = [];
    for (const m of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const cells = [...(m[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
            .map((c) => stripTags(c[1] ?? ""));
        const [lastName, firstName] = cells;
        if (!lastName || !firstName) continue;
        students.push({ lastName, firstName });
    }
    return students;
}

/**
 * The labels of the groups an event is attached to, off its "Groupes" tab.
 * The tab is found through its nav link rather than its j_idt id, which is
 * only stable as long as Aurion's template is.
 */
function parseGroupLabels(partial: string): string[] {
    const panelId = partial.match(
        /href="#(form:onglets:[^"]+)"[^>]*>\s*Groupes\s*</
    )?.[1];
    if (!panelId) return [];
    // The tab panel and the DataTable it holds have different j_idt ids;
    // the table is the first DataTable inside the panel's own div.
    const panelStart = partial.indexOf(`id="${panelId}"`);
    if (panelStart === -1) return [];
    const chunk = partial.slice(panelStart, panelStart + 30_000);
    const tbody = chunk.match(
        /<tbody id="form:onglets:[^"]+_data"[^>]*>([\s\S]*?)<\/tbody>/
    )?.[1];
    if (!tbody || tbody.includes("ui-datatable-empty-message")) return [];

    const labels: string[] = [];
    for (const m of tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const cells = [...(m[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
            .map((c) => stripTags(c[1] ?? ""));
        const label = cells[1] ?? "";
        if (label) labels.push(label);
    }
    return labels;
}

/** Promotion labels end with the school year; course groups do not. */
const isPromotionLabel = (label: string) => / - 20\d{2}\/20\d{2}$/.test(label);

/**
 * Open one event's detail dialog and read its Apprenants tab. The eventSelect
 * is a JSF behavior: primefaces.js sends javax.faces.behavior.event and
 * javax.faces.partial.event, and schedule.js adds `${id}_selectedEventId` —
 * without the behavior params Aurion merely re-renders an empty dialog.
 */
async function requestParticipants(
    session: Session,
    page: GroupPlanning,
    viewState: string,
    eventId: string
): Promise<{
    students: PalantirStudent[];
    groupLabels: string[];
    viewState: string;
}> {
    const body = formFields(page.body);
    body.set("javax.faces.partial.ajax", "true");
    body.set("javax.faces.source", page.scheduleId);
    body.set("javax.faces.partial.execute", page.scheduleId);
    body.set(
        "javax.faces.partial.render",
        "form:modaleDetail form:confirmerSuppression"
    );
    body.set("javax.faces.behavior.event", "eventSelect");
    body.set("javax.faces.partial.event", "eventSelect");
    body.set(`${page.scheduleId}_selectedEventId`, eventId);
    body.set("form", "form");
    body.set("form:offsetFuseauNavigateur", "-7200000");
    body.set("javax.faces.ViewState", viewState);

    const res = await session.client.post(page.url, {
        body: body.toString(),
        responseType: "text",
    });
    if (res.body.includes("<error-name>")) {
        throw new Error("dialogue d'événement refusé par Aurion");
    }
    return {
        students: parseParticipants(res.body),
        groupLabels: parseGroupLabels(res.body),
        viewState: parsePartialViewState(res.body) || viewState,
    };
}

/** How many distinct courses of a promotion are opened for its roster. */
const ROSTER_COURSES = 6;

/** The time range is the only reliable anchor of an Aurion title. */
const timeRangeLine = /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/;

/** Course, type and teacher out of a lesson title, counted from the time range. */
function readCourseFields(title: string): {
    course: string;
    type: string;
    teacher: string;
} {
    const lines = title.split("\n").map((l) => l.trim()).filter(Boolean);
    const timeIndex = lines.findIndex((line) => timeRangeLine.test(line));
    if (timeIndex < 2) {
        return { course: lines.join(" "), type: "", teacher: "" };
    }
    return {
        course: lines[timeIndex - 2] ?? "",
        type: lines[timeIndex - 1] ?? "",
        teacher: lines[timeIndex + 1] ?? "",
    };
}

/**
 * A promotion's students, and its own lessons over the window. The
 * whole-class courses (a CI, a COURS_TD) list every student of the
 * class, so their roster contains every TD/TP subgroup roster — the
 * class set is the one the other candidate sets are subsets of.
 * Candidates listing another promotion in their Groupes tab are
 * skipped outright (a shared M&T module, a joint ADIMAKER A1+A2
 * visit: their participants mix several classes — live on
 * 2026-10-04, 6 strangers into CPG2-MPI's roster, 126 students on
 * ADIMAKER A1's single event). A union would be wrong, and so is a
 * count-based mode (CIR1's two TPs share the same 15 students and
 * would outvote its CI of 36). Roster failures are the caller's to
 * swallow: students are a bonus, never worth failing a planning over.
 */
async function fetchGroupRoster(
    session: Session,
    ctx: MenuContext,
    node: PalantirPlanningNode,
    promotion: PalantirGroup,
    window: HarvestWindow
): Promise<{ students: PalantirStudent[]; lessons: PalantirLesson[] }> {
    const promotionLabel = promotion.label;
    const choice = await openChoice(session, ctx, node);
    const { tableId, submitId } = parseChoiceIds(choice.body);
    const page = await openGroupPlanning(
        session,
        choice.url,
        choice.body,
        tableId,
        submitId,
        [promotion.rowKey]
    );

    // One pass over the full harvest window: the same events feed the roster
    // candidates AND the promotion's own lesson list (see the return). The
    // whole-class courses dominate the frequency ranking over the window
    // just like over a single week.
    const fetched = await requestEvents(session, page, window);
    const events = fetched.events;
    let viewState = fetched.viewState;
    const ownLessons = events.filter(
        (e): e is PalantirLesson => typeof e?.id === "string"
    );

    // One representative per distinct course, the most frequent first —
    // the whole-class courses repeat several times a week, a shared module
    // once, so frequency keeps the strangers out of the candidate list.
    const byCourse = new Map<
        string,
        { representative: PalantirLesson; frequency: number }
    >();
    for (const event of events) {
        if (typeof event?.id !== "string") continue;
        const { course, type, teacher } = readCourseFields(event.title);
        const signature = `${course}|${type}|${teacher}`;
        const existing = byCourse.get(signature);
        if (existing) {
            existing.frequency += 1;
            continue;
        }
        byCourse.set(signature, { representative: event, frequency: 1 });
    }
    const candidates = [...byCourse.values()]
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, ROSTER_COURSES);

    const sets = new Map<string, { students: PalantirStudent[]; count: number }>();
    for (const candidate of candidates) {
        const res = await requestParticipants(
            session,
            page,
            viewState,
            candidate.representative.id
        );
        viewState = res.viewState;
        // Keep only the promotion's own events: a course listing another
        // promotion (a shared module, a joint ADIMAKER A1+A2 visit) brings
        // strangers in — better no roster at all than a wrong one. Events
        // not listing this promotion at all are subgroup-only courses.
        const foreign = res.groupLabels.some(
            (label) =>
                isPromotionLabel(label) && label !== promotionLabel
        );
        const ours = res.groupLabels.includes(promotionLabel);
        if (res.students.length && ours && !foreign) {
            const key = res.students
                .map((s) => `${s.lastName}|${s.firstName}`)
                .sort()
                .join("\n");
            const bucket = sets.get(key);
            if (bucket) bucket.count += 1;
            else sets.set(key, { students: res.students, count: 1 });
        }
        await sleep(DELAY_MS);
    }

    // The class roster is the set that contains the others: a whole-class
    // course lists everyone, so every TD/TP subgroup roster is a subset of
    // it. A count-based mode would pick a TP group whose members share
    // several courses (CIR1's two TPs, same 15 students, outweighed its CI
    // of 36), and a union would leak cross-promotion modules in.
    let best: { students: PalantirStudent[]; score: number } | null = null;
    for (const [key, { students, count }] of sets) {
        const mine = new Set(key.split("\n"));
        let score = count - 1;
        for (const other of sets.keys()) {
            if (other === key) continue;
            if (other.split("\n").every((student) => mine.has(student))) {
                score += 1;
            }
        }
        const wins =
            !best ||
            score > best.score ||
            (score === best.score && students.length > best.students.length);
        if (wins) best = { students, score };
    }
    return { students: best?.students ?? [], lessons: ownLessons };
}

/** Ids of the selection DataTable and of its "Voir planning" button. */
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

/**
 * One planning, every group ticked at once: the groups feed the searchable
 * catalogue, the lessons feed the room index. Returns the possibly-refreshed
 * menu context, for the caller to keep chaining leaves with.
 */
export async function harvestPlanning(
    session: Session,
    ctx: MenuContext,
    node: PalantirPlanningNode,
    window: HarvestWindow
): Promise<{
    groups: PalantirGroup[];
    lessons: PalantirLesson[];
    ctx: MenuContext;
}> {
    const choice = await openChoice(session, ctx, node);
    const { tableId, submitId } = parseChoiceIds(choice.body);
    const groups = await readAllGroups(
        session,
        choice.url,
        choice.body,
        tableId,
        node
    );
    if (!groups.length) return { groups: [], lessons: [], ctx: choice.ctx };

    const lessons = await readLessons(
        session,
        choice.url,
        choice.body,
        tableId,
        submitId,
        groups.map((g) => g.rowKey),
        window
    );

    // The roster pass opens one planning per Promotion row: on the merged
    // planning above, an event's participants cannot be told apart between
    // the ticked classes. A failed pass is swallowed — students and the
    // class's own lessons are a bonus, never worth failing the planning
    // over.
    const knownIds = new Set(lessons.map((lesson) => lesson.id));
    for (const promotion of groups.filter((g) => g.type === "Promotion")) {
        try {
            const { students, lessons: ownLessons } = await fetchGroupRoster(
                session,
                choice.ctx,
                node,
                promotion,
                window
            );
            if (students.length) promotion.students = students;
            // The class's own planning: lets /palantir/planning serve it
            // from the index instead of a live ~15s fetch. A solo view can
            // carry an event the bulk pass missed — index it too.
            promotion.lessonIds = ownLessons.map((lesson) => lesson.id);
            for (const lesson of ownLessons) {
                if (knownIds.has(lesson.id)) continue;
                knownIds.add(lesson.id);
                lessons.push(lesson);
            }
        } catch {
            // Left without students and lesson ids; the next weekly
            // harvest retries.
        }
        await sleep(DELAY_MS);
    }

    return { groups, lessons, ctx: choice.ctx };
}

/**
 * A single group's schedule, fetched live. The bulk harvest ticks every group
 * at once and Aurion does not say which group a lesson belongs to, so a group
 * planning cannot be filtered out of the index — it has to be asked for.
 */
export async function fetchGroupLessons(
    session: Session,
    node: PalantirPlanningNode,
    rowKey: string,
    window: HarvestWindow
): Promise<PalantirLesson[]> {
    const ctx = await ensureMenu(session, null, node);
    const choice = await openChoice(session, ctx, node);
    const { tableId, submitId } = parseChoiceIds(choice.body);
    return readLessons(
        session,
        choice.url,
        choice.body,
        tableId,
        submitId,
        [rowKey],
        window
    );
}

/**
 * Harvest every planning on `workers` independent Aurion sessions. Aurion
 * accepts several concurrent sessions for the same account, and a worker that
 * fails on one planning keeps going with the next.
 *
 * Plannings are handed out as contiguous filière buckets, not one by one: the
 * menu context a worker caches is only good for one filière, so a worker that
 * jumped between filières on every item would pay the preamble again
 * each time and the reuse would be worth nothing. A failed planning drops the
 * context — the next one rebuilds it from a fresh menu.
 */
export async function harvestAll(
    email: string,
    password: string,
    nodes: PalantirPlanningNode[],
    window: HarvestWindow,
    onPlanning: (
        node: PalantirPlanningNode,
        result: { groups: PalantirGroup[]; lessons: PalantirLesson[] } | null,
        error: unknown
    ) => void
): Promise<void> {
    const buckets: PalantirPlanningNode[][] = [];
    for (const node of nodes) {
        const current = buckets[buckets.length - 1];
        if (current?.[0]?.filiereId === node.filiereId) {
            current.push(node);
        } else {
            buckets.push([node]);
        }
    }

    let cursor = 0;
    const run = async () => {
        const session = newSession();
        // Each worker needs an independent, strictly sequential session —
        // never the shared cached one.
        await session.login(email, password, { noCache: true });
        let ctx: MenuContext | null = null;
        for (
            let index = cursor++;
            index < buckets.length;
            index = cursor++
        ) {
            const bucket = buckets[index];
            if (!bucket) continue;
            for (const node of bucket) {
                try {
                    const menu = await ensureMenu(session, ctx, node);
                    const result = await harvestPlanning(
                        session,
                        menu,
                        node,
                        window
                    );
                    ctx = result.ctx;
                    onPlanning(node, result, null);
                } catch (error) {
                    ctx = null;
                    onPlanning(node, null, error);
                }
                await sleep(DELAY_MS);
            }
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(WORKERS, buckets.length) }, () => run())
    );
}
