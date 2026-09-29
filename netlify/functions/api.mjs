import { getStore } from "@netlify/blobs";

const PASSWORD = "050582"; // باسورد لوحة التحكم (يتحقق منه السيرفر فقط)
const DAY7 = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TITLE = "رابط مميز لك";
// أي زيارة من هذه الأنظمة (معاينة الواتساب وغيره) لا تحسب كزيارة شخص
const BOT = /bot|crawl|spider|whatsapp|facebookexternalhit|facebot|telegram|twitter|slack|discord|preview|curl|wget|python|okhttp|headless/i;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isHttp = (u) => { try { const p = new URL(u).protocol; return p === "http:" || p === "https:"; } catch { return false; } };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newCode = () => {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(6))].map((x) => abc[x % abc.length]).join("");
};
const sha = async (s) => {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
};

const GONE = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>الرابط منتهي</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@600;700&display=swap" rel="stylesheet">
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(ellipse 700px 400px at 50% 0,rgba(255,15,43,.22),transparent 60%),#09090a;color:#f6f6f8;font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;text-align:center">
<div><h1 style="font-size:2rem;margin:0 0 8px">انتهت صلاحية الرابط</h1><p style="color:#93949c;margin:0">هذا الرابط لم يعد متاحاً.</p></div></body></html>`;
const gone = (s) => new Response(GONE, { status: s, headers: { "content-type": "text/html;charset=utf-8" } });

export default async (req, context) => {
  const url = new URL(req.url);
  const path = url.pathname;
  const store = getStore({ name: "links", consistency: "strong" });

  /* ============ واجهة لوحة التحكم (محمية بالباسورد) ============ */
  if (path.startsWith("/api/")) {
    if (path === "/api/login" && req.method === "POST") {
      let d = {};
      try { d = await req.json(); } catch {}
      if (d.password === PASSWORD) return json({ ok: true });
      await sleep(700);
      return json({ error: "الباسورد غلط" }, 401);
    }
    if (req.headers.get("x-pw") !== PASSWORD) { await sleep(700); return json({ error: "الباسورد غلط" }, 401); }

    if (path === "/api/links" && req.method === "GET") {
      const { blobs } = await store.list();
      const now = Date.now();
      const items = (await Promise.all(blobs.map(async (b) => {
        const v = await store.get(b.key, { type: "json" });
        if (!v) return null;
        if (v.expires < now) { await store.delete(b.key); return null; }
        return {
          code: b.key, short: `${url.origin}/${b.key}`, target: v.target, title: v.title, image: v.image,
          created: v.created || v.expires - DAY7, expires: v.expires, clicks: v.clicks || 0,
          unique: (v.visitors || []).length, last: v.last || null,
          countries: v.countries || {}, devices: v.devices || {}, log: v.log || [],
        };
      }))).filter(Boolean);
      return json({ links: items, now });
    }

    let d = {};
    if (req.method === "POST") { try { d = await req.json(); } catch { return json({ error: "طلب غير صالح" }, 400); } }

    if (path === "/api/shorten" && req.method === "POST") {
      const target = (d.url || "").trim();
      if (!isHttp(target)) return json({ error: "الرابط لازم يبدأ بـ http أو https" }, 400);
      if (new URL(target).host === url.host) return json({ error: "ما ينفع تختصر رابط من نفس الموقع" }, 400);
      const image = d.image && isHttp(d.image) ? d.image.trim() : url.origin + "/1.png";
      const title = (d.title || "").trim().slice(0, 70) || DEFAULT_TITLE;
      let code = newCode();
      for (let i = 0; i < 5 && (await store.get(code)); i++) code = newCode();
      const created = Date.now();
      await store.setJSON(code, { target, title, image, created, expires: created + DAY7, clicks: 0, visitors: [], countries: {}, devices: {}, log: [] });
      return json({ short: `${url.origin}/${code}`, code });
    }

    if (path === "/api/delete" && req.method === "POST") {
      if (/^[a-z0-9]{6}$/.test(d.code || "")) await store.delete(d.code);
      return json({ ok: true });
    }

    if (path === "/api/renew" && req.method === "POST") {
      const v = /^[a-z0-9]{6}$/.test(d.code || "") ? await store.get(d.code, { type: "json" }) : null;
      if (!v) return json({ error: "الرابط غير موجود" }, 404);
      v.created = Date.now();
      v.expires = v.created + DAY7;
      await store.setJSON(d.code, v);
      return json({ ok: true });
    }

    return json({ error: "غير موجود" }, 404);
  }

  /* ============ الرابط القصير (مفتوح للجميع بدون باسورد) ============ */
  const code = path.slice(1);
  if (/^[a-z0-9]{6}$/.test(code)) {
    const v = await store.get(code, { type: "json" });
    if (!v) return gone(404);
    if (v.expires < Date.now()) { await store.delete(code); return gone(410); }

    const ua = req.headers.get("user-agent") || "";
    if (req.method === "GET" && !BOT.test(ua)) {
      try {
        const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || "";
        const h = await sha(ip + ua);
        v.clicks = (v.clicks || 0) + 1;
        v.visitors = v.visitors || [];
        if (!v.visitors.includes(h) && v.visitors.length < 1000) v.visitors.push(h);
        const cc = context?.geo?.country?.code || "??";
        const dev = /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop";
        v.countries = v.countries || {}; v.countries[cc] = (v.countries[cc] || 0) + 1;
        v.devices = v.devices || {}; v.devices[dev] = (v.devices[dev] || 0) + 1;
        v.last = Date.now();
        v.log = [{ t: v.last, c: cc, d: dev }, ...(v.log || [])].slice(0, 30);
        await store.setJSON(code, v);
      } catch {}
    }

    const html = `<!doctype html><html lang="ar"><head><meta charset="utf-8">
<title>${esc(v.title)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(v.title)}">
<meta property="og:image" content="${esc(v.image)}">
<meta property="og:url" content="${esc(url.href)}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0;url=${esc(v.target)}">
</head><body><script>location.replace(${JSON.stringify(v.target).replace(/</g, "\\u003c")})</script></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store" } });
  }
  return gone(404);
};

export const config = { path: ["/api/*", "/*"], preferStatic: true };
