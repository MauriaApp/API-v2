import { FastifyInstance } from "fastify";
import { SessionManager } from "../../aurion/utils/session-manager";
import {
    PalantirPeopleRequest,
    PalantirStudentResult,
} from "../../../types/palantir";
import { isAdminEmail } from "../utils/admin";
import { searchPeople } from "../utils/palantir-index";
import { getSupabaseAdmin } from "../../supa-data/utils/supabase";

type CollesStudentRow = {
    class: string;
    group_name: string;
    first_name: string;
    last_name: string;
};

const normalizeName = (value: string) =>
    value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z]/g, "");

// Compound given names ("Mourad Olatodou Kpego Unix") keep only their
// first word in one roster or the other: compare on it.
const givenName = (value: string) => normalizeName(value.split(" ")[0] ?? "");

// Aurion class labels are long ("2ème année CPGE filière MPI du lycée
// OZANAM - …"), the colles roster carries the filière alone ("MPI"): the
// filière is the only shared token.
const classTokens = (value: string) =>
    new Set(
        value
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean)
    );

/**
 * The student's khôlles group off the private roster (colles_students,
 * behind RLS) — the roster itself never leaves the server, only the
 * group name travels, on this admin-only route. The class token must
 * match (a HEI homonym must not receive a prépa's khôlles), and
 * anything still ambiguous answers null rather than a guess.
 */
function collesGroupOf(
    student: PalantirStudentResult,
    rows: CollesStudentRow[]
): string | null {
    const first = givenName(student.firstName);
    const last = normalizeName(student.lastName);
    if (!first || !last) return null;

    const tokens = classTokens(student.className);
    const inClass = rows.filter(
        (row) =>
            tokens.has(row.class.toLowerCase()) &&
            givenName(row.first_name) === first &&
            normalizeName(row.last_name) === last
    );
    const groups = new Set(inClass.map((row) => row.group_name));
    return groups.size === 1 ? [...groups][0] ?? null : null;
}

/**
 * Attach each student's khôlles group. Fails soft: without the roster
 * (Supabase unreachable, table missing) students just get null groups —
 * the people search itself must never break over colles.
 */
async function withCollesGroups(
    students: PalantirStudentResult[]
): Promise<PalantirStudentResult[]> {
    if (!students.length) return students;

    const supabaseAdmin = getSupabaseAdmin();
    if (!supabaseAdmin) {
        return students.map((student) => ({ ...student, collesGroup: null }));
    }

    const { data: rows } = await supabaseAdmin
        .from("colles_students")
        .select("class, group_name, first_name, last_name");
    const roster = (rows ?? []) as CollesStudentRow[];

    return students.map((student) => ({
        ...student,
        collesGroup: collesGroupOf(student, roster),
    }));
}

export async function palantirPeopleRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: PalantirPeopleRequest }>(
        "/palantir/people",
        {
            schema: {
                // Hidden from the Swagger UI: this endpoint must not be
                // advertised, and non-admins must not learn it exists.
                hide: true,
                body: {
                    type: "object",
                    properties: {
                        email: { type: "string" },
                        password: { type: "string" },
                        q: { type: "string" },
                        limit: { type: "number", default: 20 },
                    },
                    required: ["email", "password", "q"],
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            data: {
                                type: "object",
                                properties: {
                                    teachers: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                name: { type: "string" },
                                                lessons: { type: "number" },
                                            },
                                            required: ["name", "lessons"],
                                        },
                                    },
                                    students: {
                                        type: "array",
                                        items: {
                                            type: "object",
                                            properties: {
                                                firstName: { type: "string" },
                                                lastName: { type: "string" },
                                                className: { type: "string" },
                                                groupId: { type: "string" },
                                                collesGroup: {
                                                    type: [
                                                        "string",
                                                        "null",
                                                    ],
                                                    description:
                                                        "Groupe de khôlles de l'étudiant, résolu côté serveur sur le roster privé. Null si aucun match non ambigu.",
                                                },
                                            },
                                            required: [
                                                "firstName",
                                                "lastName",
                                                "className",
                                                "groupId",
                                                "collesGroup",
                                            ],
                                        },
                                    },
                                },
                                required: ["teachers", "students"],
                            },
                        },
                        required: ["success", "data"],
                    },
                },
            },
        },
        async (request, reply) => {
            const { email, password, q, limit } = request.body;

            // For anyone else this route answers exactly like an unknown
            // one — a 403 would reveal both its existence and who its
            // users are. Bad credentials answer the same way.
            if (!(await isAdminEmail(email))) {
                return reply.callNotFound();
            }
            const session = new SessionManager();
            try {
                // Cache-allowed login, the same posture as /palantir/planning:
                // a live Aurion session for this email implies the password
                // was verified when it was created.
                await session.login(email, password);
            } catch {
                return reply.callNotFound();
            }

            const results = searchPeople(
                q,
                Math.min(Math.max(limit ?? 20, 1), 100)
            );
            return {
                success: true,
                data: {
                    teachers: results.teachers,
                    students: await withCollesGroups(results.students),
                },
            };
        }
    );
}
