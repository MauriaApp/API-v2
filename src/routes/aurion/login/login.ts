import { SessionManager } from "../utils/session-manager";

export class AurionLogin {
    private sessionManager: SessionManager;

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }

    async login(email: string, password: string): Promise<void> {
        await this.sessionManager.login(email, password);
    }
}
