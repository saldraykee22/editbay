import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { shell } from 'electron';

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

interface ActiveFlow {
  cancel: (reason: Error) => void;
}

/**
 * Only one loopback server may wait for a browser callback at a time. Starting
 * a new sign-in closes the previous flow instead of leaving it bound until its
 * timeout expires.
 */
let activeFlow: ActiveFlow | null = null;

function callbackPage(message: string): string {
  return `<!doctype html><html><body style="background:#060807;color:#e3ece6;font-family:system-ui;display:grid;place-items:center;height:100vh;margin:0">
        <div style="text-align:center"><div style="font-size:18px;letter-spacing:.02em">Editbay</div>
        <p style="color:#96aa9e">${message}</p></div>
        </body></html>`;
}

/**
 * OpenRouter OAuth (PKCE, no client secret).
 * Opens the system browser, waits for the loopback callback, exchanges the
 * code for a permanent key and returns it. The key is stored encrypted by the
 * caller; it never touches the renderer.
 */
export async function runOpenRouterOAuth(timeoutMs = 5 * 60 * 1000): Promise<string> {
  activeFlow?.cancel(new Error('Superseded by a new OpenRouter sign-in'));

  const { verifier, challenge } = pkcePair();
  const state = base64Url(randomBytes(12));

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let flow: ActiveFlow | null = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      server.close();
    };

    const settle = (error: Error | null, key?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (activeFlow === flow) activeFlow = null;
      if (error) reject(error);
      else resolve(key ?? '');
    };

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');

      if (!code || returnedState !== state) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(callbackPage('Authorization failed. Return to Editbay and try again.'));
        settle(new Error('OpenRouter authorization was cancelled or returned an invalid state'));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(callbackPage('Connected. You can close this tab and return to the app.'));
      void exchange(code, verifier).then(
        (key) => settle(null, key),
        (error: unknown) => settle(error instanceof Error ? error : new Error(String(error))),
      );
    });

    flow = { cancel: (reason: Error) => settle(reason) };
    activeFlow = flow;

    server.on('error', (error) => {
      settle(error);
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        settle(new Error('Could not open a loopback port for OpenRouter'));
        return;
      }
      const callback = `http://127.0.0.1:${address.port}/callback`;
      const authorize = new URL('https://openrouter.ai/auth');
      authorize.searchParams.set('callback_url', callback);
      authorize.searchParams.set('code_challenge', challenge);
      authorize.searchParams.set('code_challenge_method', 'S256');
      authorize.searchParams.set('state', state);
      void shell.openExternal(authorize.toString());
      timer = setTimeout(() => {
        settle(new Error('OpenRouter authorization timed out'));
      }, timeoutMs);
    });
  });
}

async function exchange(code: string, verifier: string): Promise<string> {
  const response = await fetch('https://openrouter.ai/api/v1/auth/keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`OpenRouter key exchange failed (${response.status}) ${text.slice(0, 200)}`);
  }
  const data = (await response.json()) as { key?: string };
  if (!data.key) throw new Error('OpenRouter returned no key');
  return data.key;
}
