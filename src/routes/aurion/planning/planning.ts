import { PageParser } from "../utils/page-parser";
import { SessionManager } from "../utils/session-manager";
import type { EventDetails } from "../../../types/aurion";

export class AurionPlanning {
    private sessionManager: SessionManager;

    private viewState = "";
    private menuid = "";
    private idInit = "";
    private formIdPlanning = "";

    constructor(sessionManager: SessionManager) {
        this.sessionManager = sessionManager;
    }

    async initializeSession() {
        const homeState = await this.sessionManager.fetchHomePageState();
        this.viewState = homeState.viewState;
        this.idInit = homeState.idInit;
    }

    async postMainSidebar() {
        const getSidebarMenuId = await this.sessionManager.client.get(
            "https://aurion.junia.com/faces/MainMenuPage.xhtml",
            {
                headers: {
                    Referer: "https://aurion.junia.com/",
                    Connection: "keep-alive",
                },
                responseType: "text",
            }
        );

        this.menuid = PageParser.parseSidebarMenuIdForMonPlanning(
            getSidebarMenuId.body
        );

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
        return this.sessionManager.run(email, password, async () => {
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

            return this.postPlan(start, end, today, week, year);
        });
    }

    /**
     * Clicks an event the way the browser does (PrimeFaces `eventSelect`
     * behavior) and parses the detail dialog Aurion renders in answer.
     * Teachers, learners and groups all come back in that one response.
     */
    async postEventSelect(
        eventId: string,
        start: number
    ): Promise<EventDetails> {
        const date = new Date(start);
        const f = this.formIdPlanning;
        const postData = new URLSearchParams({
            "javax.faces.partial.ajax": "true",
            "javax.faces.source": f,
            "javax.faces.partial.execute": f,
            "javax.faces.partial.render":
                "form:modaleDetail form:confirmerSuppression",
            "javax.faces.behavior.event": "eventSelect",
            "javax.faces.partial.event": "eventSelect",
            [`${f}_selectedEventId`]: eventId,
            form: "form",
            "form:largeurDivCenter": "",
            "form:idInit": this.idInit,
            "form:date_input": date.toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
            }),
            "form:week": `${String(getWeekNumber(date)).padStart(2, "0")}-${date.getFullYear()}`,
            [`${f}_view`]: "agendaWeek",
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
                    "Faces-Request": "partial/ajax",
                    "X-Requested-With": "XMLHttpRequest",
                },
                responseType: "text",
            }
        );

        return PageParser.parseEventDetails(res.body);
    }

    /**
     * Event ids are regenerated on every schedule load, so the id the client
     * got from /aurion/planning means nothing to this session. The week is
     * reloaded here and the event is found again by its start, end and title.
     */
    async getEventDetails(
        email: string,
        password: string,
        event: { title: string; start: string; end: string }
    ): Promise<EventDetails> {
        return this.sessionManager.run(email, password, async () => {
            await this.initializeSession();
            await this.postMainSidebar();
            const startMs = toTimestamp(event.start);
            if (Number.isNaN(startMs)) {
                throw new Error("Date de début invalide");
            }
            const date = new Date(startMs);
            const events: {
                id: string;
                title: string;
                start: string;
                end: string;
            }[] = await this.postPlan(
                startMs - 86400000,
                startMs + 6 * 86400000,
                date.toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                }),
                String(getWeekNumber(date)).padStart(2, "0"),
                String(date.getFullYear())
            );
            // The client may hand back reformatted dates (FullCalendar turns
            // "+0100" into "+01:00") and a stretched end ("tiers temps"), so
            // compare instants, and use the end only to break ties.
            const sameStart = events.filter(
                (e) =>
                    e.title === event.title && toTimestamp(e.start) === startMs
            );
            const endMs = toTimestamp(event.end);
            const fresh =
                sameStart.find((e) => toTimestamp(e.end) === endMs) ??
                sameStart[0];
            if (!fresh) {
                throw new Error("Événement introuvable dans le planning");
            }
            return this.postEventSelect(fresh.id, startMs);
        });
    }
}

function getWeekNumber(date: Date): number {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear =
        (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

/** Aurion writes offsets as "+0100": normalize to "+01:00" before parsing. */
function toTimestamp(iso: string): number {
    return new Date(iso.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")).getTime();
}
