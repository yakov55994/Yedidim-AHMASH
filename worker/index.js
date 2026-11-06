// יד ביד: שרת קטן שמגיש את האתר ושומר את הרשימה המשותפת ב-D1.
// קוד צוות הוא אופציונלי: אם מוגדר הסוד TEAM_CODE, כל בקשה ל-/api/* דורשת עוגיית כניסה.
// בלי TEAM_CODE האפליקציה פתוחה לכל מי שיש לו את הקישור.
import { SEED } from './seed.js';

const COOKIE = 'yb';
const MAX_BODY = 512 * 1024;
const enc = new TextEncoder();

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

// קוד מנורמל: בלי רווחים ומקפים, אותיות קטנות
const normalize = (code) => String(code || '').toLowerCase().replace(/[\s-]/g, '');

async function tokenFor(code) {
  const key = await crypto.subtle.importKey('raw', enc.encode(normalize(code)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('yad-beyad/v1'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(req, name) {
  const header = req.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

async function currentState(env) {
  return env.DB.prepare('SELECT data, version FROM state WHERE id = 1').first();
}

function validData(data) {
  return data && typeof data === 'object' && Array.isArray(data.roster) && Array.isArray(data.managers);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    const locked = Boolean(env.TEAM_CODE);
    const good = locked ? await tokenFor(env.TEAM_CODE) : '';

    if (url.pathname === '/api/login' && req.method === 'POST') {
      if (!locked) return json({ ok: true });
      let code = '';
      try { code = (await req.json()).code; } catch {}
      if (!normalize(code) || !safeEqual(await tokenFor(code), good)) {
        await new Promise((r) => setTimeout(r, 700)); // מאט ניחושים
        return json({ error: 'bad_code' }, 401);
      }
      return json({ ok: true }, 200, {
        'set-cookie': `${COOKIE}=${good}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
      });
    }

    if (url.pathname === '/api/logout' && req.method === 'POST') {
      return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
    }

    if (locked && !safeEqual(readCookie(req, COOKIE), good)) return json({ error: 'auth' }, 401);

    if (url.pathname === '/api/state') {
      if (req.method === 'GET') {
        const row = await currentState(env);
        if (!row) return json({ data: null, version: 0, seed: SEED });
        return json({ data: JSON.parse(row.data), version: row.version });
      }

      if (req.method === 'PUT') {
        const raw = await req.text();
        if (raw.length > MAX_BODY) return json({ error: 'too_large' }, 413);
        let body;
        try { body = JSON.parse(raw); } catch { return json({ error: 'bad_json' }, 400); }
        const { data, version } = body || {};
        if (!validData(data) || !Number.isInteger(version)) return json({ error: 'bad_data' }, 400);

        const text = JSON.stringify(data);
        const now = Date.now();
        // שמירה רק אם אף אחד לא שמר בינתיים (השוואת גרסה), כדי לא לדרוס עבודה של אחמ"ש אחר
        const result = version === 0
          ? await env.DB.prepare('INSERT OR IGNORE INTO state (id, data, version, updated_at) VALUES (1, ?, 1, ?)').bind(text, now).run()
          : await env.DB.prepare('UPDATE state SET data = ?, version = version + 1, updated_at = ? WHERE id = 1 AND version = ?').bind(text, now, version).run();

        if (!result.meta.changes) {
          const row = await currentState(env);
          return json({ error: 'conflict', data: row ? JSON.parse(row.data) : null, version: row ? row.version : 0 }, 409);
        }
        return json({ ok: true, version: version + 1 });
      }
    }

    return json({ error: 'not_found' }, 404);
  },
};
