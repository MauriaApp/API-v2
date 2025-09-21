// futur fichier api.ts pour les appels API

import fetch from "isomorphic-fetch";
import { MauriaGradeType } from "../../types/grade";

const API_URL =
    process.env.NODE_ENV === "production"
        ? "https://mauriaapi.fly.dev"
        : "http://localhost:3000";

function setLocalStorage<T>(key: string, data: T) {
    localStorage.setItem(key, JSON.stringify(data));
}

function getLocalStorage<T>(key: string): T | null {
    const item = localStorage.getItem(key);
    return item ? (JSON.parse(item) as T) : null;
}

async function postRequest<T>(
    path: string,
    body?: any
): Promise<{ success: boolean; data?: T; error?: string }> {
    const email = getLocalStorage<string>("email");
    const password = getLocalStorage<string>("password");
    if (!email || !password) throw new Error("Utilisateur non connecté");

    const payload = { email, password, ...body };

    const response = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        return { success: false, error: `HTTP error ${response.status}` };
    }

    const json = await response.json();
    return json;
}

export async function login(email: string, password: string): Promise<boolean> {
    try {
        const response = await fetch(`${API_URL}/aurion/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
        });
        if (!response.ok) return false;
        setLocalStorage("email", email);
        setLocalStorage("password", password);
        await fetchFirstName();
        return true;
    } catch {
        return false;
    }
}

export async function fetchPlanning() {
    const result = await postRequest<any[]>("/aurion/planning");
    if (result.success && result.data) {
        setLocalStorage("planning", result.data);
        setLocalStorage("lastPlanningUpdate", new Date().toISOString());
        return result.data;
    }
    return null;
}

export async function fetchGrades(): Promise<{
    data: MauriaGradeType[] | null;
}> {
    const oldGrades = getLocalStorage<MauriaGradeType[]>("grades") || [];
    const result = await postRequest<MauriaGradeType[]>("/aurion/grades");
    if (result.success && result.data) {
        const newGrades = result.data.filter(
            (grade) => !oldGrades.some((old) => old.code === grade.code)
        );
        setLocalStorage("newGrades", newGrades);
        setLocalStorage("grades", result.data);
        return { data: result.data };
    }
    setLocalStorage("grades", []);
    return { data: null };
}

export async function fetchAbsences() {
    const result = await postRequest<any[]>("/aurion/absences");
    if (result.success && result.data) {
        setLocalStorage("absences", result.data);
        return result.data;
    }
    return null;
}

export async function fetchAssos() {
    try {
        const response = await fetch(`${API_URL}/associations`);
        if (!response.ok) throw new Error();
        const data = await response.json();
        setLocalStorage("associations", data);
        return data;
    } catch {
        return getLocalStorage<any[]>("associations") || null;
    }
}

export async function fetchImportantMessage() {
    try {
        const response = await fetch(`${API_URL}/messages`);
        if (!response.ok) throw new Error();
        return await response.json();
    } catch {
        return {
            title: "Erreur",
            message: "Une erreur est survenue, rechargez la page plus tard",
        };
    }
}

export async function fetchUpdates() {
    try {
        const response = await fetch(`${API_URL}/updates`);
        if (!response.ok) throw new Error();
        const data = await response.json();
        setLocalStorage("updates-log", data);
        return data;
    } catch {
        setLocalStorage("updates-log", []);
        return null;
    }
}

export async function fetchToolsQuery() {
    try {
        const response = await fetch(`${API_URL}/tools`);
        if (!response.ok) throw new Error();
        const data = await response.json();
        setLocalStorage("tools", data);
        return data;
    } catch {
        return getLocalStorage<any[]>("tools") || [];
    }
}

export async function fetchFirstName(): Promise<string | null> {
    const email = getLocalStorage<string>("email");
    if (!email) {
        setLocalStorage("name", "");
        return null;
    }
    const match = email.match(/^([\w+-]*)([.-])/);
    const firstName = match
        ? match[1]
              .split(/[-.]/)
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
              .join("-")
        : "";
    setLocalStorage("name", firstName);
    return firstName;
}

export function getFirstName(): string | null {
    return getLocalStorage<string>("name");
}
