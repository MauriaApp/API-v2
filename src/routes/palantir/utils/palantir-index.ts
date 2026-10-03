/**
 * The Palantir index: one in-memory catalogue of Junia's promotion plannings.
 *
 * The API no longer harvests Aurion itself — that traffic is what got Junia's
 * firewall to ban its egress IP (2026-09-23/24). A dedicated harvester running
 * outside the API builds the index weekly and publishes it through
 * /palantir/publish; it is persisted in Supabase (table palantir_index) and
 * loaded back here at boot, so a deploy or restart never costs a harvest.
 *
 * It still holds no credentials: user requests are served from this index,
 * and only a group's live planning is fetched with the caller's own session.
 */

import {
    PalantirEntity,
    PalantirEntityKind,
    PalantirGroup,
    PalantirIndexStatus,
    PalantirLesson,
    PalantirPlanningNode,
} from "../../../types/palantir";
import { getSupabaseAdmin } from "../../supa-data/utils/supabase";
import {
    IndexData,
    RoomBucket,
    SerializedPalantirIndex,
    deserializeIndex,
    harvestWindow,
    normalize,
} from "./index-format";
import type { HarvestWindow } from "./harvester";

/** Table rows kept per build: the current index and the one before it. */
const KEPT_VERSIONS = 2;

let data: IndexData | null = null;

/** Why the last load or publish failed, surfaced through /palantir/status. */
let lastError: string | null = null;

const emptyCounts = { lessons: 0, rooms: 0, groups: 0 };

/**
 * Kill switch, kept from the maintenance period. The harvest traffic moved
 * off the API, so it defaults to enabled; set PALANTIR_ENABLED=false (a Fly
 * secret is enough, no deploy) to answer empty results again.
 */
export const PALANTIR_ENABLED = process.env.PALANTIR_ENABLED !== "false";

export function isStale(at: number = Date.now()): boolean {
    return !data || at >= data.expiresAt;
}

export function getStatus(): PalantirIndexStatus {
    return {
        state: data ? "ready" : "empty",
        phase: null,
        done: 0,
        total: 0,
        elapsedMs: 0,
        builtAt: data?.builtAt ?? null,
        expiresAt: data?.expiresAt ?? null,
        windowStart: data?.window.start ?? null,
        windowEnd: data?.window.end ?? null,
        stale: Boolean(data) && isStale(),
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

/* ---------------------------------------------------------- persistence -- */

/**
 * Load the newest persisted index at boot. Fails soft: an unreachable
 * Supabase or a missing table leaves the API serving empty results, never
 * a broken boot.
 */
export async function loadPersistedIndex(): Promise<boolean> {
    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
        lastError =
            "SUPABASE_SERVICE_KEY is not configured — palantir_index sits behind RLS";
        console.warn(`[palantir] ${lastError}`);
        return false;
    }

    const { data: row, error } = await supabaseAdmin
        .from("palantir_index")
        .select("id, payload")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error || !row) {
        lastError = error ? `Supabase: ${error.message}` : "aucun index persisté";
        console.warn(`[palantir] no persisted index (${lastError})`);
        return false;
    }

    try {
        data = deserializeIndex(row.payload as SerializedPalantirIndex);
    } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn(`[palantir] persisted index unreadable: ${lastError}`);
        return false;
    }

    lastError = null;
    console.log(
        `[palantir] index loaded from Supabase (row ${row.id}): ` +
            `${data.lessons.size} lessons, ${data.rooms.size} rooms, ` +
            `${data.groups.length} groups`
    );
    return true;
}

/**
 * Validate and persist a freshly harvested index (see /palantir/publish),
 * then serve it. The previous version stays in the table until this one is
 * safely written, so a crash never leaves the API indexless.
 */
export async function publishIndex(
    payload: SerializedPalantirIndex
): Promise<void> {
    const supabaseAdmin = getSupabaseAdmin();
    const fresh = deserializeIndex(payload);
    if (fresh.expiresAt <= Date.now()) {
        throw new Error("index déjà expiré, refusé");
    }
    if (!fresh.nodes.length) {
        throw new Error("index sans plannings, refusé");
    }

    if (!supabaseAdmin) {
        throw new Error(
            "SUPABASE_SERVICE_KEY is not configured — cannot persist the index"
        );
    }

    const { data: inserted, error } = await supabaseAdmin
        .from("palantir_index")
        .insert({
            built_at: fresh.builtAt,
            expires_at: fresh.expiresAt,
            window_start: fresh.window.start,
            window_end: fresh.window.end,
            payload,
        })
        .select("id")
        .single();

    if (error || !inserted) {
        throw new Error(
            error ? `Supabase: ${error.message}` : "insertion sans résultat"
        );
    }

    const keepIds = await supabaseAdmin
        .from("palantir_index")
        .select("id")
        .order("id", { ascending: false })
        .limit(KEPT_VERSIONS);
    const keepList = (keepIds.data ?? [])
        .map((row) => row.id)
        .filter((id) => id !== inserted.id);
    if (keepList.length) {
        const { error: pruneError } = await supabaseAdmin
            .from("palantir_index")
            .delete()
            .not("id", "in", `(${[inserted.id, ...keepList].join(",")})`);
        if (pruneError) {
            console.warn(`[palantir] prune failed: ${pruneError.message}`);
        }
    }

    data = fresh;
    lastError = null;
    console.log(
        `[palantir] index published (row ${inserted.id}): ` +
            `${fresh.lessons.size} lessons, ${fresh.rooms.size} rooms, ` +
            `${fresh.groups.length} groups, expires ${new Date(fresh.expiresAt).toISOString()}`
    );
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
    if (!PALANTIR_ENABLED || !data) return [];
    const needle = normalize(query);
    if (!needle) return [];

    const scored: Array<{ score: number; entity: PalantirEntity }> = [];

    const pushBucket = (map: Map<string, RoomBucket>, kind: "room") => {
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
    if (!PALANTIR_ENABLED || !data) return [];
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
    if (!PALANTIR_ENABLED || !data) return null;
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
