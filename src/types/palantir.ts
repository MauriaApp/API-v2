/** What a Palantir search result points at. */
export type PalantirEntityKind = "room" | "teacher" | "group";

export interface PalantirEntity {
    kind: PalantirEntityKind;
    /** Opaque key handed back to /palantir/planning to get the schedule. */
    id: string;
    /** Primary line in the result list. */
    label: string;
    /** Secondary line: the promotion for a group, the campus for a room. */
    detail: string;
    /**
     * Aurion's own kind for a group — "Promotion" for a class, "Planning" for
     * one of its subgroups. Empty for rooms and teachers.
     */
    type: string;
    /**
     * Indexed lessons behind the entity, used to rank results. Groups are
     * fetched live rather than indexed, so theirs is 0.
     */
    count: number;
}

/** A lesson as Aurion's Schedule widget returns it, plus what we read off it. */
export interface PalantirLesson {
    id: string;
    title: string;
    start: string;
    end: string;
    allDay: boolean;
    editable: boolean;
    className: string;
}

/** One entry of "Plannings Groupés par Promotion". */
export interface PalantirPlanningNode {
    /** Sidebar menuid of the leaf, e.g. "5_0_9_1". */
    menuid: string;
    /** Leaf label, e.g. "Planning ISEN CPG2". */
    label: string;
    /** Parent submenu id, needed to re-expand the menu before opening it. */
    filiereId: string;
    /** Parent label, e.g. "Planning ISEN CPG". */
    filiere: string;
}

/** A row of a planning's group-selection DataTable. */
export interface PalantirGroup {
    /** Aurion row key, used to tick the row when asking for its schedule. */
    rowKey: string;
    /** e.g. "2627_ISEN_CPG2_MPI_D1". */
    code: string;
    /** e.g. "CPG2 - MPI - D1". */
    label: string;
    /** Aurion's own kind column: "Promotion" for a class, "Planning" for a subgroup. */
    type: string;
    /** menuid of the planning the row belongs to. */
    menuid: string;
    /** Label of that planning, e.g. "Planning ISEN CPG2". */
    planningLabel: string;
}

export type PalantirIndexState = "empty" | "building" | "ready";

export interface PalantirIndexStatus {
    state: PalantirIndexState;
    /** Which pass is running, when state is "building". */
    phase: "plannings" | "events" | null;
    /** Completed units of the current pass. */
    done: number;
    /** Total units of the current pass, 0 while unknown. */
    total: number;
    /** Time the running build has been going for, 0 when idle. */
    elapsedMs: number;
    /** Epoch ms of the last successful build. */
    builtAt: number | null;
    /** Epoch ms at which the index goes stale (next Sunday 00:00, Paris). */
    expiresAt: number | null;
    /** Window the indexed lessons cover. */
    windowStart: number | null;
    windowEnd: number | null;
    /** True when the index is past expiresAt but still served while rebuilding. */
    stale: boolean;
    /** Message of the last failed build, null when the last one succeeded. */
    error: string | null;
    /** Plannings that failed to harvest, by label. */
    failed: string[];
    counts: {
        lessons: number;
        rooms: number;
        teachers: number;
        groups: number;
    };
}

export interface PalantirSearchRequest {
    email: string;
    password: string;
    q: string;
    kinds?: PalantirEntityKind[];
    limit?: number;
}

export interface PalantirPlanningRequest {
    email: string;
    password: string;
    kind: PalantirEntityKind;
    id: string;
    startTimestamp?: number;
    endTimestamp?: number;
}
