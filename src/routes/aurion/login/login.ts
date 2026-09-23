import { SessionManager } from "../utils/session-manager";

export class AurionLogin {
    private sessionManager: SessionManager;

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }

    async login(email: string, password: string): Promise<void> {
        // This route exists to verify the credentials themselves, so it
        // always logs in for real — and refreshes the session cache with the
        // result. Warm the home-page tokens in the background so the first
        // feature fetches after login skip the slow JSF rendering.
        await this.sessionManager.login(email, password, { force: true });
        void this.sessionManager.fetchHomePageState().catch(() => {
            // Best effort: on failure the next request loads the tokens.
        });
    }
}
