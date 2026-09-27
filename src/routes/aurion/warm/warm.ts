import { SessionManager } from "../utils/session-manager";

export class AurionWarm {
    private sessionManager: SessionManager;

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }

    /**
     * Ensures a session is logged in and its home-page tokens are cached,
     * without fetching any feature data. `SessionManager.run` reuses a
     * cached session when one exists, and `fetchHomePageState` returns the
     * cached tokens instantly when they're already warm — so this is a fast
     * no-op when the session is already warm, and pays the login/home cost
     * only once when it isn't.
     */
    async warm(email: string, password: string): Promise<void> {
        await this.sessionManager.run(email, password, () =>
            this.sessionManager.fetchHomePageState()
        );
    }
}
