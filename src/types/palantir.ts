/** What a Palantir search result points at. */
export type PalantirEntityKind = "room" | "group";

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
     * one of its subgroups. Empty for rooms.
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

/** A student of a promotion, read off the event dialog's Apprenants tab. */
export interface PalantirStudent {
    /** Family name, uppercase as Aurion writes it. */
    lastName: string;
    firstName: string;
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
    /**
     * The promotion's students, harvested once a week off the planning's
     * event dialog. Only Promotion rows get one, and it never surfaces in
     * /palantir/search — the roster is indexed for internal use only.
     */
    students?: PalantirStudent[];
    /**
     * The promotion's own lessons over the harvest window, read by the same
     * roster pass (it already opens each class's planning alone). Lets
     * /palantir/planning serve a class instantly from the index instead of
     * a ~15s live Aurion fetch; the live fetch stays as a fallback for
     * indexes built before this existed.
     */
    lessonIds?: string[];
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

/** One teacher of the index, with how many of its lessons they teach. */
export interface PalantirTeacher {
    /** As Aurion writes it, e.g. "Monsieur BELLEUDY" or "HOUSEZ". */
    name: string;
    lessons: number;
}

/** One student of a promotion roster, with their class. */
export interface PalantirStudentResult {
    firstName: string;
    lastName: string;
    className: string;
    /** The class as a Palantir entity id, so a click can open its planning. */
    groupId: string;
}

/** The answer of /palantir/people — admin-only, never in /palantir/search. */
export interface PalantirPersonResult {
    teachers: PalantirTeacher[];
    students: PalantirStudentResult[];
}

export interface PalantirPeopleRequest {
    email: string;
    password: string;
    q: string;
    limit?: number;
}
