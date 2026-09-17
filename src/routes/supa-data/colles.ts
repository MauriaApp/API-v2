import { FastifyInstance } from "fastify";
import { supabaseAdmin } from "./utils/supabase";

type ColleStudentRow = {
    class: string;
    group_name: string;
    first_name: string;
    last_name: string;
};

const MIN_PREFIX_LENGTH = 3;

const normalize = (value: string) =>
    value
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z]/g, "");

// Aurion logins look like "prenom.nom@ecole.com". The surname half is
// sometimes shortened, so it is only ever compared as a prefix.
const splitEmail = (email: string) => {
    const local = email.split("@")[0] ?? "";
    const parts = local
        .split(/[._-]+/)
        .map(normalize)
        .filter(Boolean);
    return { firstName: parts[0] ?? "", lastName: parts.slice(1).join("") };
};

const isPrefixOf = (value: string, prefix: string) =>
    prefix.length >= MIN_PREFIX_LENGTH && value.startsWith(prefix);

const matches = (rosterName: string, emailName: string) =>
    rosterName === emailName ||
    isPrefixOf(rosterName, emailName) ||
    isPrefixOf(emailName, rosterName);

// Compound given names ("Mourad Olatodou Kpego Unix") only keep their first
// word in the email address.
const givenName = (row: ColleStudentRow) =>
    normalize(row.first_name.split(" ")[0] ?? "");

// Same matching as the old client-side findColleStudent (Webapp
// src/lib/utils/colles.ts before this moved server-side): given name first,
// surname prefix to break ties, exact surname to break ties on ties. The
// roster never leaves this function — only the resulting class/group does.
function findColleStudent(email: string, rows: ColleStudentRow[]) {
    const { firstName, lastName } = splitEmail(email);
    if (!firstName) return null;
    // Too short to tell anyone apart (e.g. "louis.s2026@…"): given name only.
    const useSurname = lastName.length >= MIN_PREFIX_LENGTH;

    // All classes are searched as one roster: homonyms span them (two Louis,
    // two Thomas, two Théophile…), so stopping at the first class with a
    // single candidate would hand a student someone else's colles.
    const candidates = rows.filter(
        (row) =>
            matches(givenName(row), firstName) &&
            (!useSurname || matches(normalize(row.last_name), lastName))
    );
    if (candidates.length === 1 && candidates[0]) return candidates[0];

    // Still ambiguous: an exact surname beats a mere prefix.
    const exactSurname = candidates.filter(
        (row) => normalize(row.last_name) === lastName
    );
    if (exactSurname.length === 1 && exactSurname[0]) return exactSurname[0];

    return null;
}

export async function collesGroupRoute(fastify: FastifyInstance) {
    fastify.post<{ Body: { email: string } }>(
        "/colles/group",
        {
            schema: {
                description:
                    "Resolves the caller's khôlles class and group from their Aurion " +
                    "email, without ever shipping the student roster to the client.",
                body: {
                    type: "object",
                    properties: { email: { type: "string" } },
                    required: ["email"],
                },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            class: { type: "string", nullable: true },
                            group: { type: "string", nullable: true },
                        },
                        required: ["class", "group"],
                    },
                    500: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            error: { type: "string" },
                        },
                        required: ["success", "error"],
                    },
                },
            },
        },
        async (request, reply) => {
            try {
                if (!supabaseAdmin) {
                    throw new Error(
                        "SUPABASE_SERVICE_KEY is not configured — colles_students sits behind RLS and can't be read with the anon key"
                    );
                }
                const { data, error } = await supabaseAdmin
                    .from("colles_students")
                    .select("class, group_name, first_name, last_name");
                if (error) throw error;

                const match = findColleStudent(
                    request.body.email,
                    (data ?? []) as ColleStudentRow[]
                );

                return {
                    class: match?.class ?? null,
                    group: match?.group_name ?? null,
                };
            } catch (error) {
                return reply.status(500).send({
                    success: false,
                    error:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                });
            }
        }
    );
}
