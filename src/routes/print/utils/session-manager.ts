import got from "got";
import { CookieJar } from "tough-cookie";

export const PRINT_BASE = "https://print.junia.com/end-user/ui";

export class PrintSessionManager {
    private cookieJar = new CookieJar();

    public client = got.extend({
        cookieJar: this.cookieJar,
        https: { rejectUnauthorized: false },
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0",
            Connection: "keep-alive",
        },
        followRedirect: false,
        throwHttpErrors: false,
    });

    async login(email: string, password: string): Promise<void> {
        const page = await this.client.get(`${PRINT_BASE}/login`);
        const csrf = page.body.match(/name="_csrf"[^>]*value="([^"]+)"/)?.[1];
        if (!csrf) {
            throw new Error("Token CSRF de connexion introuvable");
        }

        const response = await this.client.post(
            `${PRINT_BASE}/j_spring_security_check`,
            {
                body: new URLSearchParams({
                    username: email,
                    password,
                    _csrf: csrf,
                }).toString(),
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            }
        );

        if (response.statusCode !== 302) {
            throw new Error(`Login échoué, code HTTP ${response.statusCode}`);
        }

        const setCookie = response.headers["set-cookie"];
        if (!setCookie || !setCookie.length) {
            throw new Error("Aucun cookie de session reçu");
        }
    }
}
