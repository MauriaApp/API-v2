/**
 * In-memory cache of authenticated Aurion sessions, keyed by email.
 *
 * A login plus a home-page load costs several seconds on Aurion's side, so
 * authenticated sessions (the cookie jars Aurion hands back, plus the tokens
 * parsed from the home page) are reused across requests for a few minutes
 * instead of being rebuilt from scratch every time.
 *
 * Only cookies and page tokens are cached — never the email or password.
 * The cache is never persisted: a restart or redeploy empties it, and every
 * request simply falls back to a fresh login.
 */

import { CookieJar } from "tough-cookie";

/** Tokens parsed from the Aurion home page, needed by every feature flow. */
export type HomeState = {
    viewState: string;
    formId: string;
    idInit: string;
};

type SessionEntry = {
    /**
     * The jar is shared, not copied: Aurion responses received while serving
     * other requests keep the cached cookies up to date.
     */
    cookieJar: CookieJar;
    homeState?: HomeState;
    /**
     * In-flight home-page load: concurrent misses for the same session join
     * it instead of each paying the several-seconds JSF rendering (stampede
     * guard). Only set on the entry whose jar the loader uses.
     */
    homeStatePromise?: Promise<HomeState> | undefined;
    expiresAt: number;
};

/** Sliding TTL: every cache hit pushes the expiry one window further. */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function ttlMs(): number {
    const parsed = Number(process.env.AURION_SESSION_TTL_MS);
    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_TTL_MS;
}

const cache = new Map<string, SessionEntry>();

function purgeExpired(now: number): void {
    for (const [email, entry] of cache) {
        if (entry.expiresAt <= now) {
            cache.delete(email);
        }
    }
}

/** The cached entry for `email`, or null. Slides the TTL on hit. */
export function getCachedSession(email: string): SessionEntry | null {
    const now = Date.now();
    purgeExpired(now);
    const entry = cache.get(email);
    if (!entry || entry.expiresAt <= now) {
        if (entry) {
            cache.delete(email);
        }
        return null;
    }
    entry.expiresAt = now + ttlMs();
    return entry;
}

export function storeSession(email: string, cookieJar: CookieJar): void {
    cache.set(email, {
        cookieJar,
        expiresAt: Date.now() + ttlMs(),
    });
}

export function storeHomeState(
    email: string,
    homeState: HomeState,
    cookieJar: CookieJar
): void {
    const entry = cache.get(email);
    // Home-page tokens are session-bound: only the session that owns the
    // cached jar may store its tokens on the entry. A request on an orphaned
    // jar (its entry was replaced by a newer login) just doesn't cache.
    if (!entry || entry.cookieJar !== cookieJar) {
        return;
    }
    entry.homeState = homeState;
}

/** The in-flight home-page load for `email`, if one is running. */
export function getHomeStatePromise(
    email: string
): Promise<HomeState> | null {
    return cache.get(email)?.homeStatePromise ?? null;
}

/** Publish an in-flight home-page load. Jar-mismatched loaders are ignored. */
export function setHomeStatePromise(
    email: string,
    promise: Promise<HomeState>,
    cookieJar: CookieJar
): void {
    const entry = cache.get(email);
    if (!entry || entry.cookieJar !== cookieJar) {
        return;
    }
    entry.homeStatePromise = promise;
}

/** Clear an in-flight load, without touching one published by someone else. */
export function clearHomeStatePromise(
    email: string,
    promise: Promise<HomeState>
): void {
    const entry = cache.get(email);
    if (entry?.homeStatePromise !== promise) {
        return;
    }
    entry.homeStatePromise = undefined;
}

export function invalidateSession(email: string): void {
    cache.delete(email);
}
