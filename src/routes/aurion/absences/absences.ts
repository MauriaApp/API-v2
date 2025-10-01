import { PageParser } from '../utils/page-parser';
import { SessionManager } from '../utils/session-manager';

export class AurionAbsences {
  private sessionManager: SessionManager;
  private viewState = '';
  private formId = '';
  private menuid = '';
  private idInit = '';

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager;
  }

  async initializeSession() {
    const res = await this.sessionManager.client.get(
      'https://aurion.junia.com/',
      { responseType: 'text' }
    );
    const body = res.body;
    this.viewState = PageParser.parseViewState(body);
    this.formId = PageParser.parseFormId(body);
    this.idInit = PageParser.parseIdInit(body);
  }

  async postMainMenu() {
    const postData = new URLSearchParams({
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': this.formId,
      'javax.faces.partial.execute': this.formId,
      'javax.faces.partial.render': 'form:sidebar',
      [this.formId]: this.formId,
      'webscolaapp.Sidebar.ID_SUBMENU': 'submenu_44413', // à adapter si besoin
      form: 'form',
      'form:largeurDivCenter': '885',
      'form:idInit': this.idInit,
      'form:sauvegarde': '',
      'form:j_idt773_focus': '',
      'form:j_idt773_input': '44323',
      'javax.faces.ViewState': this.viewState,
    }).toString();

    const res = await this.sessionManager.client.post(
      'https://aurion.junia.com/faces/MainMenuPage.xhtml',
      {
        body: postData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        responseType: 'text',
      }
    );

    this.menuid = PageParser.parseMenuId(res.body, 'Mes absences</span>');
  }

  async postMainSidebar() {
    const postData = new URLSearchParams({
      form: 'form',
      'form:largeurDivCenter': '885',
      'form:idInit': this.idInit,
      'form:sauvegarde': '',
      'form:j_idt773_focus': '',
      'form:j_idt773_input': '44323',
      'javax.faces.ViewState': this.viewState,
      'form:sidebar': 'form:sidebar',
      'form:sidebar_menuid': this.menuid,
    }).toString();

    await this.sessionManager.client.post(
      'https://aurion.junia.com/faces/MainMenuPage.xhtml',
      {
        body: postData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        responseType: 'text',
      }
    );

    const absPage = await this.sessionManager.client.get(
      'https://aurion.junia.com/faces/MesAbsences.xhtml',
      {
        headers: {
          Referer: 'https://aurion.junia.com/faces/MesAbsences.xhtml',
          Connection: 'keep-alive',
        },
        responseType: 'text',
      }
    );

    const body = absPage.body;
    this.viewState = PageParser.parseViewState(body);
    this.idInit = PageParser.parseIdInit(body);
  }

  async postAbsences(): Promise<any[]> {
    const postData = new URLSearchParams({
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': 'form:table',
      'javax.faces.partial.execute': 'form:table',
      'javax.faces.partial.render': 'form:table',
      'form:table': 'form:table',
      'form:table_pagination': 'true',
      'form:table_first': '0',
      'form:table_rows': '20000',
      'form:table_skipChildren': 'true',
      'form:table_encodeFeature': 'true',
      form: 'form',
      'form:largeurDivCenter': '885',
      'form:idInit': this.idInit,
      'form:search-texte': '',
      'form:search-texte-avancer': '',
      'form:input-expression-exacte': '',
      'form:input-un-des-mots': '',
      'form:input-aucun-des-mots': '',
      'form:input-nombre-debut': '',
      'form:input-nombre-fin': '',
      'form:calendarDebut_input': '',
      'form:calendarFin_input': '',
      'form:table_reflowDD': '0_0',
      'form:table_selection': '',
      'form:j_idt191_focus': '',
      'form:j_idt191_input': '44323',
      'javax.faces.ViewState': this.viewState,
    }).toString();

    const res = await this.sessionManager.client.post(
      'https://aurion.junia.com/faces/MesAbsences.xhtml',
      {
        body: postData,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        responseType: 'text',
      }
    );

    return PageParser.parseAbsences(res.body);
  }

  async getAllAbsences(email: string, password: string): Promise<any[]> {
    await this.sessionManager.login(email, password);
    await this.initializeSession();
    await this.postMainMenu();
    await this.postMainSidebar();
    return this.postAbsences();
  }
}
