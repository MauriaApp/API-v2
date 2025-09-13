import https from "node:https";

export interface LoginRequest {
    email: string;
    password: string;
}

export interface LoginResponse {
    sessionId: string;
    statusCode: number;
}

export async function aurionLogin(
    email: string,
    password: string
): Promise<LoginResponse> {
    const encodedEmail = encodeURIComponent(email);
    const encodedPassword = encodeURIComponent(password);

    const payload = `username=${encodedEmail}&password=${encodedPassword}&j_idt28=`;

    const options: https.RequestOptions = {
        hostname: "aurion.junia.com",
        path: "/login",
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Connection: "keep-alive",
        },
    };

    return new Promise<LoginResponse>((resolve, reject) => {
        const req = https.request(options, (res) => {
            if (!res.statusCode) {
                return reject(new Error("No status code received"));
            }

            const setCookieHeader = res.headers["set-cookie"];
            if (!setCookieHeader || !setCookieHeader[0]) {
                return reject(new Error("No session cookie received"));
            }

            const cookiePart = setCookieHeader[0].split(";")[0];
            const sessionIdPart = cookiePart?.split("=")[1];
            if (!sessionIdPart) {
                return reject(new Error("Invalid session cookie format"));
            }
            const sessionId = sessionIdPart;

            resolve({
                sessionId,
                statusCode: res.statusCode,
            });
        });

        req.on("error", (error) => {
            reject(error);
        });

        req.write(payload);
        req.end();
    });
}
