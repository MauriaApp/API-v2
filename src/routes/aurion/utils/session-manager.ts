// SessionManager.ts (méthode login améliorée avec got)

import got from 'got';
import { CookieJar } from 'tough-cookie';

export class SessionManager {
  private cookieJar = new CookieJar();

  public client = got.extend({
    cookieJar: this.cookieJar,
    https: { rejectUnauthorized: false },
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
      'Content-Type': 'application/x-www-form-urlencoded',
      Connection: 'keep-alive',
    },
    followRedirect: false,
    throwHttpErrors: false,
  });

  async login(email: string, password: string): Promise<void> {
    const payload = new URLSearchParams({
      username: email,
      password,
      j_idt28: '',
    }).toString();

    const response = await this.client.post('https://aurion.junia.com/login', {
      body: payload,
    });

    if (response.statusCode !== 302) {
      throw new Error(`Login échoué, code HTTP ${response.statusCode}`);
    }

    const setCookie = response.headers['set-cookie'];
    if (!setCookie || !setCookie.length) {
      throw new Error('Aucun cookie de session reçu');
    }
  }
}
