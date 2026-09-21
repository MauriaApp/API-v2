/**
 * The Palantir index: one in-memory catalogue of Junia's promotion plannings,
 * rebuilt at most once a week.
 *
 * It holds no credentials. The rebuild is triggered by whoever searches first
 * after the index goes stale and runs with *their* Aurion login, which keeps
 * API-v2 as stateless about credentials as the rest of the app.
 */

import {
    PalantirEntity,
    PalantirEntityKind,
    PalantirGroup,
    PalantirIndexStatus,
    PalantirLesson,
    PalantirPlanningNode,
} from "../../../types/palantir";
import { newSession } from "./aurion-menu";
import {
    HarvestWindow,
    discoverPlannings,
    harvestAll,
} from "./harvester";

/** Weeks of lessons pulled in one pass, starting a week in the past. */
const WEEKS_BEHIND = 1;
const WEEKS_AHEAD = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

/* ------------------------------------------------------------------ time -- */

/** Paris wall clock minus UTC at a given instant, DST included. */
function parisOffsetMs(at: number): number {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Paris",
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).formatToParts(new Date(at));
    const get = (type: string) =>
        Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(
        get("year"),
        get("month") - 1,
        get("day"),
        get("hour"),
        get("minute"),
        get("second")
    );
    return asUtc - Math.floor(at / 1000) * 1000;
}

/** Midnight (Paris) of a day offset from `from`, as an epoch. */
function parisMidnight(from: number, dayOffset: number): number {
    const offset = parisOffsetMs(from);
    const wall = new Date(from + offset);
    const utcMidnight = Date.UTC(
        wall.getUTCFullYear(),
        wall.getUTCMonth(),
        wall.getUTCDate() + dayOffset
    );
    // The offset can differ at the target instant (DST), so re-measure there.
    return utcMidnight - parisOffsetMs(utcMidnight - offset);
}

/** Monday 00:00 (Paris) of the week containing `from`. */
function mondayOfWeek(from: number): number {
    const wall = new Date(from + parisOffsetMs(from));
    const day = wall.getUTCDay(); // 0 = Sunday
    return parisMidnight(from, -((day + 6) % 7));
}

/**
 * The index is anchored, not sliding: it always expires on the night from
 * Saturday to Sunday, so every client flips to a fresh index at the same
 * moment whatever time the last build happened to run.
 */
function nextSundayMidnight(from: number): number {
    const wall = new Date(from + parisOffsetMs(from));
    const day = wall.getUTCDay();
    return parisMidnight(from, day === 0 ? 7 : 7 - day);
}

function harvestWindow(now: number): HarvestWindow {
    const monday = mondayOfWeek(now);
    return {
        start: monday - WEEKS_BEHIND * 7 * DAY_MS,
        end: monday + WEEKS_AHEAD * 7 * DAY_MS,
    };
}

/* ----------------------------------------------------------- title fields -- */

const timeRange = /^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$/;

/**
 * Room out of an Aurion title.
 *
 * Mirrors parseFromTitle in the Webapp (src/lib/utils/home.ts), deliberately:
 * the fields are fixed but a lesson can carry a free-text note that pushes
 * everything after it down, so they are counted from the time range — the only
 * reliable anchor — and never from the top.
 */
export function readTitleRoom(title: string): string {
    const lines = title.split("\n").map((l) => l.trim());
    const timeIndex = lines.findIndex((line) => timeRange.test(line));
    const typeIndex = timeIndex === -1 ? lines.length - 2 : timeIndex - 1;

    if (typeIndex < 2) {
        return lines.filter(Boolean)[0] ?? "";
    }
    return lines[0] ?? "";
}

/** Aurion rooms read "IC2 A412 - salle de TP - Campus …"; keep the room itself. */
const shortRoom = (location: string) =>
    location.split(" - ")[0]!.replace(/\s+/g, " ").trim();

export const normalize = (value: string) =>
    value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

/* ---------------------------------------------------------------- store --- */

interface Bucket {
    label: string;
    detail: string;
    lessonIds: Set<string>;
}

interface IndexData {
    builtAt: number;
    expiresAt: number;
    window: HarvestWindow;
    lessons: Map<string, PalantirLesson>;
    rooms: Map<string, Bucket>;
    groups: PalantirGroup[];
    nodes: PalantirPlanningNode[];
    failed: string[];
}

let data: IndexData | null = null;
let building: Promise<void> | null = null;
let progress: {
    phase: "plannings" | "events";
    done: number;
    total: number;
    startedAt: number;
} = { phase: "plannings", done: 0, total: 0, startedAt: 0 };

/** Why the last build failed, surfaced so a broken harvest is visible. */
let lastError: string | null = null;

const emptyCounts = { lessons: 0, rooms: 0, groups: 0 };

export function isStale(at: number = Date.now()): boolean {
    return !data || at >= data.expiresAt;
}

export function getStatus(): PalantirIndexStatus {
    const stale = isStale();
    return {
        state: building ? "building" : data ? "ready" : "empty",
        phase: building ? progress.phase : null,
        done: building ? progress.done : 0,
        total: building ? progress.total : 0,
        elapsedMs: building ? Date.now() - progress.startedAt : 0,
        builtAt: data?.builtAt ?? null,
        expiresAt: data?.expiresAt ?? null,
        windowStart: data?.window.start ?? null,
        windowEnd: data?.window.end ?? null,
        stale: Boolean(data) && stale,
        error: lastError,
        failed: data?.failed ?? [],
        counts: data
            ? {
                  lessons: data.lessons.size,
                  rooms: data.rooms.size,
                  groups: data.groups.length,
              }
            : emptyCounts,
    };
}

function addToBucket(
    map: Map<string, Bucket>,
    key: string,
    label: string,
    detail: string,
    lessonId: string
) {
    const existing = map.get(key);
    if (existing) {
        existing.lessonIds.add(lessonId);
        return;
    }
    map.set(key, { label, detail, lessonIds: new Set([lessonId]) });
}

/**
 * Rebuild the whole index. Concurrent callers join the build already in
 * flight instead of starting a second harvest, and the previous index keeps
 * being served until the new one is complete.
 */
export function ensureIndex(email: string, password: string): Promise<void> {
    if (building) return building;
    if (!isStale()) return Promise.resolve();

    building = build(email, password)
        .then(() => {
            lastError = null;
        })
        .catch((error: unknown) => {
            lastError =
                error instanceof Error ? error.message : String(error);
            throw error;
        })
        .finally(() => {
            building = null;
        });
    return building;
}

async function build(email: string, password: string): Promise<void> {
    const now = Date.now();
    const window = harvestWindow(now);

    progress = { phase: "plannings", done: 0, total: 0, startedAt: now };
    const scout = newSession();
    await scout.login(email, password);
    const nodes = await discoverPlannings(scout);

    progress = { ...progress, phase: "events", done: 0, total: nodes.length };

    const lessons = new Map<string, PalantirLesson>();
    const rooms = new Map<string, Bucket>();
    const groups: PalantirGroup[] = [];
    const failed: string[] = [];

    await harvestAll(email, password, nodes, window, (node, result, error) => {
        progress = { ...progress, done: progress.done + 1 };
        if (error || !result) {
            failed.push(node.label);
            return;
        }
        groups.push(...result.groups);
        for (const lesson of result.lessons) {
            // The same lesson can surface under two classes.
            if (lessons.has(lesson.id)) continue;
            lessons.set(lesson.id, lesson);

            const room = readTitleRoom(lesson.title);
            const shortened = shortRoom(room);
            if (shortened) {
                addToBucket(
                    rooms,
                    normalize(shortened),
                    shortened,
                    room === shortened ? "" : room,
                    lesson.id
                );
            }
        }
    });

    // A run where every planning failed is a broken session or a changed
    // Aurion, not an empty week: keep the previous index rather than wipe it.
    if (nodes.length && failed.length === nodes.length) {
        throw new Error(
            `indexation échouée sur les ${nodes.length} plannings (Aurion a peut-être changé)`
        );
    }

    data = {
        builtAt: Date.now(),
        expiresAt: nextSundayMidnight(Date.now()),
        window,
        lessons,
        rooms,
        groups,
        nodes,
        failed,
    };
}

/* --------------------------------------------------------------- queries -- */

/** Exact hit first, then prefix, then substring; ties broken by lesson count. */
function scoreOf(haystack: string, needle: string): number {
    if (haystack === needle) return 3;
    if (haystack.startsWith(needle)) return 2;
    return haystack.includes(needle) ? 1 : 0;
}

export function search(
    query: string,
    kinds: PalantirEntityKind[],
    limit: number
): PalantirEntity[] {
    if (!data) return [];
    const needle = normalize(query);
    if (!needle) return [];

    const scored: Array<{ score: number; entity: PalantirEntity }> = [];

    const pushBucket = (map: Map<string, Bucket>, kind: "room") => {
        for (const [key, bucket] of map) {
            const score = scoreOf(key, needle);
            if (!score) continue;
            scored.push({
                score,
                entity: {
                    kind,
                    id: bucket.label,
                    label: bucket.label,
                    detail: bucket.detail,
                    type: "",
                    count: bucket.lessonIds.size,
                },
            });
        }
    };

    if (kinds.includes("room")) pushBucket(data.rooms, "room");

    if (kinds.includes("group")) {
        for (const group of data.groups) {
            const score = Math.max(
                scoreOf(normalize(group.label), needle),
                scoreOf(normalize(group.code), needle)
            );
            if (!score) continue;
            scored.push({
                score,
                entity: {
                    kind: "group",
                    id: `${group.menuid}:${group.rowKey}`,
                    label: group.label || group.code,
                    detail: group.planningLabel,
                    type: group.type,
                    // A class is what most people mean; float it above
                    // its own subgroups, which share most of its name.
                    count: group.type === "Promotion" ? 1 : 0,
                },
            });
        }
    }

    return scored
        .sort(
            (a, b) =>
                b.score - a.score ||
                b.entity.count - a.entity.count ||
                a.entity.label.localeCompare(b.entity.label)
        )
        .slice(0, limit)
        .map((s) => s.entity);
}

/** Indexed lessons of a room, clipped to an optional range. */
export function lessonsFor(
    kind: "room",
    id: string,
    start?: number,
    end?: number
): PalantirLesson[] {
    if (!data) return [];
    const bucket = data.rooms.get(normalize(id));
    if (!bucket) return [];

    const lessons: PalantirLesson[] = [];
    for (const lessonId of bucket.lessonIds) {
        const lesson = data.lessons.get(lessonId);
        if (!lesson) continue;
        if (start !== undefined || end !== undefined) {
            const at = new Date(
                lesson.start.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
            ).getTime();
            if (start !== undefined && at < start) continue;
            if (end !== undefined && at > end) continue;
        }
        lessons.push(lesson);
    }
    return lessons.sort((a, b) => a.start.localeCompare(b.start));
}

/** The planning node and row key behind a group entity id. */
export function resolveGroup(
    id: string
): { node: PalantirPlanningNode; group: PalantirGroup } | null {
    if (!data) return null;
    const separator = id.indexOf(":");
    if (separator === -1) return null;
    const menuid = id.slice(0, separator);
    const rowKey = id.slice(separator + 1);

    const group = data.groups.find(
        (g) => g.menuid === menuid && g.rowKey === rowKey
    );
    const node = data.nodes.find((n) => n.menuid === menuid);
    return group && node ? { node, group } : null;
}

export const currentWindow = (): HarvestWindow =>
    data?.window ?? harvestWindow(Date.now());

/**
 * Start a rebuild without waiting for it. Requests answer immediately — with
 * the previous index when there is one — and the client polls /palantir/status
 * for the progress bar.
 */
export function kickBuild(
    email: string,
    password: string,
    onError: (error: unknown) => void
): void {
    if (building || !isStale()) return;
    void ensureIndex(email, password).catch(onError);
}
