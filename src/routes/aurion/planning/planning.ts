import { PageParser } from "../utils/page-parser";
import { SessionManager } from "../utils/session-manager";

export class AurionPlanning {
    private sessionManager: SessionManager;

    private viewState = "";
    private menuid = "0";
    private idInit = "";
    private formIdPlanning = "";

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }

    async initializeSession() {
        const res = await this.sessionManager.client.get(
            "https://aurion.junia.com/",
            {
                responseType: "text",
            }
        );
        const body = res.body;
        this.viewState = PageParser.parseViewState(body);
        this.idInit = PageParser.parseIdInit(body);
    }

    async postMainSidebar() {
        const postData = new URLSearchParams({
            form: "form",
            "form:largeurDivCenter": "885",
            "form:idInit": this.idInit,
            "form:sauvegarde": "",
            "form:j_idt773_focus": "",
            "form:j_idt773_input": "44323",
            "javax.faces.ViewState": this.viewState,
            "form:sidebar": "form:sidebar",
            "form:sidebar_menuid": this.menuid,
        }).toString();

        await this.sessionManager.client.post(
            "https://aurion.junia.com/faces/MainMenuPage.xhtml",
            {
                body: postData,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                responseType: "text",
            }
        );

        const getRes = await this.sessionManager.client.get(
            "https://aurion.junia.com/faces/Planning.xhtml",
            {
                headers: {
                    Referer:
                        "https://aurion.junia.com/faces/MainMenuPage.xhtml",
                    Connection: "keep-alive",
                },
                responseType: "text",
            }
        );

        this.viewState = PageParser.parseViewState(getRes.body);
        this.formIdPlanning = PageParser.parseFormIdPlanning(getRes.body);
    }

    async postPlan(
        start: number,
        end: number,
        today: string,
        week: string,
        year: string
    ) {
        const postData = new URLSearchParams({
            "javax.faces.partial.ajax": "true",
            "javax.faces.source": this.formIdPlanning,
            "javax.faces.partial.execute": this.formIdPlanning,
            "javax.faces.partial.render": this.formIdPlanning,
            [this.formIdPlanning]: this.formIdPlanning,
            [`${this.formIdPlanning}_start`]: String(start),
            [`${this.formIdPlanning}_end`]: String(end),
            form: "form",
            "form:largeurDivCenter": "",
            "form:idInit": this.idInit,
            "form:date_input": today,
            "form:week": `${week}-${year}`,
            [`${this.formIdPlanning}_view`]: "agendaWeek",
            "form:offsetFuseauNavigateur": "-7200000",
            "form:onglets_activeIndex": "0",
            "form:onglets_scrollState": "0",
            "form:j_idt244_focus": "",
            "form:j_idt244_input": "44323",
            "javax.faces.ViewState": this.viewState,
        }).toString();

        const res = await this.sessionManager.client.post(
            "https://aurion.junia.com/faces/Planning.xhtml",
            {
                body: postData,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                responseType: "text",
            }
        );

        const match = res.body.match(/\[\{"id"(.*?)]]/);
        if (!match) {
            throw new Error("Planning data not found in response");
        }
        const data = match[0].slice(0, -3);
        return JSON.parse(data);
    }

    async getPlanning(
        email: string,
        password: string,
        start: number,
        end: number
    ) {
        await this.sessionManager.login(email, password);
        await this.initializeSession();
        await this.postMainSidebar();
        const now = new Date(start);
        const today = now.toLocaleDateString("fr-FR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        });
        const week = String(getWeekNumber(now)).padStart(2, "0");
        const year = String(now.getFullYear());

        const planningData = await this.postPlan(start, end, today, week, year);
        return planningData;
    }
}

function getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear =
        (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}
