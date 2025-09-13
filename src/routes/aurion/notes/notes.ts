import { SessionManager } from "../utils/session-manager";
import { PageParser } from "../utils/page-parser";

export class AurionNotes {
    private sessionManager: SessionManager;

    private viewState = "";
    private formId = "";
    private menuid = "";
    private idInit = "";
    private formIdNote = "";

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
        this.formId = PageParser.parseFormId(body);
        this.idInit = PageParser.parseIdInit(body);
    }

    async postMainMenu() {
        const postData = new URLSearchParams({
            "javax.faces.partial.ajax": "true",
            "javax.faces.source": this.formId,
            "javax.faces.partial.execute": this.formId,
            "javax.faces.partial.render": "form:sidebar",
            [this.formId]: this.formId,
            "webscolaapp.Sidebar.ID_SUBMENU": "submenu_44413",
            form: "form",
            "form:largeurDivCenter": "885",
            "form:idInit": this.idInit,
            "form:sauvegarde": "",
            "form:j_idt773_focus": "",
            "form:j_idt773_input": "44323",
            "javax.faces.ViewState": this.viewState,
        }).toString();

        const res = await this.sessionManager.client.post(
            "https://aurion.junia.com/faces/MainMenuPage.xhtml",
            {
                body: postData,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            }
        );
        this.menuid = PageParser.parseMenuId(res.body);
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
            "https://aurion.junia.com/faces/ChoixIndividu.xhtml",
            {
                headers: {
                    Referer:
                        "https://aurion.junia.com/faces/ChoixIndividu.xhtml",
                    Connection: "keep-alive",
                },
                responseType: "text",
            }
        );

        this.viewState = PageParser.parseViewState(getRes.body);
        this.idInit = PageParser.parseIdInit(getRes.body);
        this.formIdNote = PageParser.parseFormIdNote(getRes.body);
    }

    async postNote(): Promise<any[]> {
        const postData = new URLSearchParams({
            "javax.faces.partial.ajax": "true",
            "javax.faces.source": `form:${this.formIdNote}`,
            "javax.faces.partial.execute": `form:${this.formIdNote}`,
            "javax.faces.partial.render": `form:${this.formIdNote}`,
            [`form:${this.formIdNote}`]: `form:${this.formIdNote}`,
            [`form:${this.formIdNote}_pagination`]: "true",
            [`form:${this.formIdNote}_first`]: "0",
            [`form:${this.formIdNote}_rows`]: "20000",
            [`form:${this.formIdNote}_skipChildren`]: "true",
            [`form:${this.formIdNote}_encodeFeature`]: "true",
            form: "form",
            "form:largeurDivCenter": "1620",
            "form:messagesRubriqueInaccessible": "",
            "form:search-texte": "",
            "form:search-texte-avancer": "",
            "form:input-expression-exacte": "",
            "form:input-un-des-mots": "",
            "form:input-aucun-des-mots": "",
            "form:input-nombre-debut": "",
            "form:input-nombre-fin": "",
            "form:calendarDebut_input": "",
            "form:calendarFin_input": "",
            [`form:${this.formIdNote}_reflowDD`]: "0_0",
            [`form:${this.formIdNote}:j_idt273:filter`]: "",
            [`form:${this.formIdNote}:j_idt275:filter`]: "",
            [`form:${this.formIdNote}:j_idt277:filter`]: "",
            [`form:${this.formIdNote}:j_idt279:filter`]: "",
            [`form:${this.formIdNote}:j_idt281:filter`]: "",
            [`form:${this.formIdNote}:j_idt283:filter`]: "",
            "form:j_idt258_focus": "",
            "form:j_idt258_input": "44323",
            "javax.faces.ViewState": this.viewState,
        }).toString();

        const res = await this.sessionManager.client.post(
            "https://aurion.junia.com/faces/ChoixIndividu.xhtml",
            {
                body: postData,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                responseType: "text",
            }
        );

        return PageParser.parseNotes(res.body);
    }

    async getAllNotes(email: string, password: string): Promise<any[]> {
        await this.sessionManager.login(email, password);
        await this.initializeSession();
        await this.postMainMenu();
        await this.postMainSidebar();
        return this.postNote();
    }
}
