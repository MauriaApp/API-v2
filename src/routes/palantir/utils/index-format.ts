/**
 * The Palantir index format: the one serializable shape the external
 * harvester produces and API-v2 consumes.
 *
 * The index used to be built in the API's own process, with the first
 * visitor's Aurion login — the traffic got Junia's firewall to ban the API's
 * egress IP twice (2026-09-23/24). It is now harvested weekly by a dedicated
 * machine outside the API, which publishes it through /palantir/publish.
 * Both sides share this module so the payload cannot drift.
 */

import {
    PalantirGroup,
    PalantirLesson,
    PalantirPlanningNode,
} from "../../../types/palantir";
import type { HarvestWindow } from "./harvester";

/** Weeks of lessons pulled in one pass, starting a week in the past. */
export const WEEKS_BEHIND = 1;
export const WEEKS_AHEAD = 8;

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
export function nextSundayMidnight(from: number): number {
    const wall = new Date(from + parisOffsetMs(from));
    const day = wall.getUTCDay();
    return parisMidnight(from, day === 0 ? 7 : 7 - day);
}

export function harvestWindow(now: number): HarvestWindow {
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

/**
 * Teacher out of an Aurion title — the line right after the time range,
 * the only reliable anchor. "Monsieur BELLEUDY", "HOUSEZ"… empty when the
 * slot has none (supervision, free study).
 */
export function readTitleTeacher(title: string): string {
    const lines = title.split("\n").map((l) => l.trim());
    const timeIndex = lines.findIndex((line) => timeRange.test(line));
    if (timeIndex === -1) return "";
    return lines[timeIndex + 1] ?? "";
}

/** Aurion rooms read "IC2 A412 - salle de TP - Campus …"; keep the room itself. */
const shortRoom = (location: string) =>
    location.split(" - ")[0]!.replace(/\s+/g, " ").trim();

export const normalize = (value: string) =>
    value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        // Aurion writes IC1 rooms with an underscore ("IC1_017 amphi") that
        // nobody types; fold it into a space so "ic1 017" matches.
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim();

/* ---------------------------------------------------------------- format -- */

export interface RoomEntry {
    label: string;
    detail: string;
    lessonIds: string[];
}

/** A room and its indexed lessons, once loaded from the serialized form. */
export interface RoomBucket {
    label: string;
    detail: string;
    lessonIds: Set<string>;
}

/**
 * What travels between the harvester and the API — JSON over one POST. The
 * room key is not serialized: it is `normalize(label)`, recomputed on load.
 */
export interface SerializedPalantirIndex {
    builtAt: number;
    expiresAt: number;
    window: { start: number; end: number };
    lessons: PalantirLesson[];
    rooms: RoomEntry[];
    groups: PalantirGroup[];
    nodes: PalantirPlanningNode[];
    failed: string[];
}

/** The index once loaded: same as the serialized form, with live Maps. */
export interface IndexData {
    builtAt: number;
    expiresAt: number;
    window: HarvestWindow;
    lessons: Map<string, PalantirLesson>;
    rooms: Map<string, RoomBucket>;
    groups: PalantirGroup[];
    nodes: PalantirPlanningNode[];
    failed: string[];
}

/**
 * Fold harvested plannings into an index, in memory. The same lesson can
 * surface under two classes, so lessons are deduplicated on their Aurion id.
 */
export function buildIndexData(
    window: HarvestWindow,
    entries: Array<{
        node: PalantirPlanningNode;
        result: { groups: PalantirGroup[]; lessons: PalantirLesson[] };
    }>
): IndexData {
    const lessons = new Map<string, PalantirLesson>();
    const rooms = new Map<string, RoomBucket>();
    const groups: PalantirGroup[] = [];
    const nodes: PalantirPlanningNode[] = [];

    const addToRooms = (key: string, label: string, detail: string, id: string) => {
        const existing = rooms.get(key);
        if (existing) {
            existing.lessonIds.add(id);
            return;
        }
        rooms.set(key, { label, detail, lessonIds: new Set([id]) });
    };

    for (const { node, result } of entries) {
        nodes.push(node);
        // Only classes are index entities. Their subgroups (languages, TP,
        // half-groups…) are still ticked at harvest time so their lessons
        // feed the index, but each is covered by the class it belongs to
        // and must not surface as a searchable entity.
        groups.push(
            ...result.groups.filter((group) => group.type === "Promotion")
        );
        for (const lesson of result.lessons) {
            if (lessons.has(lesson.id)) continue;
            lessons.set(lesson.id, lesson);

            const room = readTitleRoom(lesson.title);
            const shortened = shortRoom(room);
            if (shortened) {
                addToRooms(
                    normalize(shortened),
                    shortened,
                    room === shortened ? "" : room,
                    lesson.id
                );
            }
        }
    }

    const now = Date.now();
    return {
        builtAt: now,
        expiresAt: nextSundayMidnight(now),
        window,
        lessons,
        rooms,
        groups,
        nodes,
        failed: [],
    };
}

export function serializeIndex(data: IndexData): SerializedPalantirIndex {
    return {
        builtAt: data.builtAt,
        expiresAt: data.expiresAt,
        window: data.window,
        lessons: [...data.lessons.values()],
        rooms: [...data.rooms.values()].map((room) => ({
            label: room.label,
            detail: room.detail,
            lessonIds: [...room.lessonIds],
        })),
        groups: data.groups,
        nodes: data.nodes,
        failed: data.failed,
    };
}

/** Recompute the Maps of a serialized index. Throws on a malformed payload. */
export function deserializeIndex(
    payload: SerializedPalantirIndex
): IndexData {
    if (
        typeof payload.builtAt !== "number" ||
        typeof payload.expiresAt !== "number" ||
        !Array.isArray(payload.lessons) ||
        !Array.isArray(payload.rooms) ||
        !Array.isArray(payload.groups) ||
        !Array.isArray(payload.nodes)
    ) {
        throw new Error("payload d'index Palantir malformé");
    }

    const lessons = new Map<string, PalantirLesson>();
    for (const lesson of payload.lessons) {
        if (typeof lesson?.id !== "string") continue;
        lessons.set(lesson.id, lesson);
    }

    const rooms = new Map<string, RoomBucket>();
    for (const room of payload.rooms) {
        if (typeof room?.label !== "string") continue;
        rooms.set(normalize(room.label), {
            label: room.label,
            detail: room.detail ?? "",
            lessonIds: new Set(
                (room.lessonIds ?? []).filter((id) => lessons.has(id)),
            ),
        });
    }

    return {
        builtAt: payload.builtAt,
        expiresAt: payload.expiresAt,
        window: payload.window,
        lessons,
        rooms,
        // Old persisted payloads still carry subgroups; they are gone from
        // freshly built indexes, but loading filters them the same way so
        // the API drops them before the next weekly publish.
        groups: payload.groups.filter(
            (group) => group?.type === "Promotion"
        ),
        nodes: payload.nodes,
        failed: Array.isArray(payload.failed) ? payload.failed : [],
    };
}
