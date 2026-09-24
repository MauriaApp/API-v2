// SessionManager.ts (méthode login améliorée avec got)

import got from "got";
import type { Got } from "got";
import { CookieJar } from "tough-cookie";
import { PageParser } from "./page-parser";
import {
    HomeState,
    clearHomeStatePromise,
    getCachedSession,
    getHomeStatePromise,
    invalidateSession,
    setHomeStatePromise,
    storeHomeState,
    storeSession,
} from "./session-cache";

const BASE_URL = "https://aurion.junia.com";

export type LoginOptions = {
    /**
     * Always log in for real even when a cached session exists, and refresh
     * the cache with the result. Used by the /aurion/login route, whose job
     * is to verify the credentials themselves.
     */
    force?: boolean;
    /**
     * Skip the cache entirely — neither reuse nor store a session. Used by
     * Palantir, whose harvests need independent, strictly sequential Aurion
     * sessions (see routes/palantir/utils/aurion-menu.ts).
     */
    noCache?: boolean;
};

export class SessionManager {
    private email = "";
    private cookieJar = new CookieJar();
    private _client?: Got | undefined;

    /**
     * In-flight logins, keyed by email. Concurrent cold requests for the same
     * user (the welcome page prefetches three Aurion features at once) share
     * one Aurion login instead of creating three sessions with three jars —
     * diverging jars would defeat the home-page single-flight. The entry is
     * dropped as soon as the login settles; the password lives only in the
     * closure for the duration of that login and is never stored anywhere.
     */
    private static readonly inFlightLogins = new Map<
        string,
        Promise<CookieJar>
    >();

    /**
     * Built lazily so login() can bind the client to the right cookie jar
     * (fresh or cached) before the first request is made. The setter keeps
     * `session.client = session.client.extend({...})` working for callers
     * that wrap the client with their own options.
     */
    public get client(): Got {
        this._client ??= got.extend({
            cookieJar: this.cookieJar,
            https: { rejectUnauthorized: false },
            headers: {
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
                "Content-Type": "application/x-www-form-urlencoded",
                Connection: "keep-alive",
            },
            followRedirect: false,
            throwHttpErrors: false,
        });
        return this._client;
    }

    public set client(value: Got) {
        this._client = value;
    }

    /**
     * Log in to Aurion, or adopt the cached session for this email when one
     * is still valid. Returns true when a cached session was reused — the
     * password is then not sent to Aurion at all.
     */
    async login(
        email: string,
        password: string,
        options?: LoginOptions
    ): Promise<boolean> {
        this.email = email;

        if (options?.noCache) {
            // Keep whatever jar the client is already bound to: callers that
            // wrap the client before logging in rely on it.
            await this.postLogin(email, password);
            return false;
        }

        if (!options?.force) {
            const cached = getCachedSession(email);
            if (cached) {
                this.adoptJar(cached.cookieJar);
                console.log(`[aurion-session] cache hit (${email})`);
                return true;
            }
            // Join a concurrent login for the same email instead of stacking
            // a second one — the requests all carry the same credentials.
            const inFlight = SessionManager.inFlightLogins.get(email);
            if (inFlight) {
                this.adoptJar(await inFlight);
                console.log(
                    `[aurion-session] joined an in-flight login (${email})`
                );
                return true;
            }
        }

        const login = this.freshLogin(email, password);
        SessionManager.inFlightLogins.set(email, login);
        try {
            await login;
            return false;
        } finally {
            SessionManager.inFlightLogins.delete(email);
        }
    }

    /** Create a fresh Aurion session and cache its jar. */
    private async freshLogin(
        email: string,
        password: string
    ): Promise<CookieJar> {
        this.adoptJar(new CookieJar());
        await this.postLogin(email, password);
        storeSession(email, this.cookieJar);
        console.log(`[aurion-session] cache miss, fresh login (${email})`);
        return this.cookieJar;
    }

    /**
     * Run a feature flow against Aurion, retrying once from a fresh login if
     * a cached session turns out to be stale (Aurion restart, revoked
     * session, expired ViewState…). A stale session makes Aurion answer with
     * the login page or error pages, which surfaces as an error inside the
     * flow — so any error on a cached session is worth one fresh retry.
     */
    async run<T>(
        email: string,
        password: string,
        flow: () => Promise<T>
    ): Promise<T> {
        const fromCache = await this.login(email, password);
        try {
            return await flow();
        } catch (error) {
            if (!fromCache) {
                throw error;
            }
            console.warn(
                `[aurion-session] cached session failed (${email}), retrying with a fresh login`
            );
            invalidateSession(email);
            await this.login(email, password, { force: true });
            return await flow();
        }
    }

    /**
     * The tokens of the Aurion home page, from the session cache when
     * available, otherwise fetched and cached. The home page is the slow part
     * of every flow (several seconds of JSF rendering), and its tokens stay
     * valid for later requests on the same session. Concurrent flows on the
     * same session (the welcome page prefetches everything at once) share a
     * single load instead of each paying the rendering.
     */
    async fetchHomePageState(): Promise<HomeState> {
        const entry = getCachedSession(this.email);
        if (entry && entry.cookieJar === this.cookieJar) {
            if (entry.homeState) {
                return entry.homeState;
            }
            const inFlight = getHomeStatePromise(this.email);
            if (inFlight) {
                return inFlight;
            }
        }
        const load = this.loadHomePageState();
        setHomeStatePromise(this.email, load, this.cookieJar);
        try {
            return await load;
        } finally {
            clearHomeStatePromise(this.email, load);
        }
    }

    private async loadHomePageState(): Promise<HomeState> {
        const res = await this.client.get(`${BASE_URL}/`, {
            responseType: "text",
        });
        // PageParser throws when the page is not the expected one — a stale
        // session gets the login page here, and `run` retries with a fresh
        // login.
        const homeState: HomeState = {
            viewState: PageParser.parseViewState(res.body),
            formId: PageParser.parseFormId(res.body),
            idInit: PageParser.parseIdInit(res.body),
        };
        storeHomeState(this.email, homeState, this.cookieJar);
        return homeState;
    }

    /** Point the client at `cookieJar` and drop the current got instance. */
    private adoptJar(cookieJar: CookieJar): void {
        this.cookieJar = cookieJar;
        this._client = undefined;
    }

    private async postLogin(email: string, password: string): Promise<void> {
        const payload = new URLSearchParams({
            username: email,
            password,
            j_idt28: "",
        }).toString();

        const response = await this.client.post(`${BASE_URL}/login`, {
            body: payload,
        });

        if (response.statusCode !== 302) {
            throw new Error(`Login échoué, code HTTP ${response.statusCode}`);
        }

        const setCookie = response.headers["set-cookie"];
        if (!setCookie || !setCookie.length) {
            throw new Error("Aucun cookie de session reçu");
        }
    }
}
