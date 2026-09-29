import { getStore } from "@netlify/blobs";

const DAY7 = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TITLE = "رابط مميز لك";
const DEFAULT_IMAGE = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRGJH3_ZQvwa5B3NQSWzlxJPW_nlS0eTQtv74M7FtxNAQ&s=10"; // غيّرها لصورتك

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isHttp = (u) => { try { const p = new URL(u).protocol; return p === "http:" || p === "https:"; } catch { return false; } };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
const newCode = () => {
  const abc = "abcdefghjkmnpqrstuvwxyz23456789";
  return [...crypto.getRandomValues(new Uint8Array(6))].map((x) => abc[x % abc.length]).join("");
};

const GONE = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>الرابط منتهي</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0e0b1f;color:#f4f1ff;font-family:system-ui,sans-serif;text-align:center">
<div><h1 style="font-size:2rem">انتهت صلاحية الرابط</h1><p style="opacity:.7">الروابط هنا تنحذف بعد 7 أيام.</p><a href="/" style="color:#3df5c0">اختصر رابط جديد</a></div></body></html>`;
const gone = (s) => new Response(GONE, { status: s, headers: { "content-type": "text/html;charset=utf-8" } });

export default async (req) => {
  const url = new URL(req.url);
  const store = getStore("links");

  if (req.method === "POST" && url.pathname === "/api/shorten") {
    let d;
    try { d = await req.json(); } catch { return json({ error: "طلب غير صالح" }, 400); }
    const target = (d.url || "").trim();
    if (!isHttp(target)) return json({ error: "الرابط لازم يبدأ بـ http أو https" }, 400);
    if (new URL(target).host === url.host) return json({ error: "ما ينفع تختصر رابط من نفس الموقع" }, 400);
    const image = d.image && isHttp(d.image) ? d.image.trim() : DEFAULT_IMAGE;
    const title = (d.title || "").trim().slice(0, 70) || DEFAULT_TITLE;

    // تنظيف الروابط المنتهية (دفعة صغيرة في كل مرة)
    try {
      const { blobs } = await store.list();
      for (const b of blobs.slice(0, 20)) {
        const v = await store.get(b.key, { type: "json" });
        if (!v || v.expires < Date.now()) await store.delete(b.key);
      }
    } catch {}

    let code = newCode();
    for (let i = 0; i < 5 && (await store.get(code)); i++) code = newCode();
    const expires = Date.now() + DAY7;
    await store.setJSON(code, { target, title, image, expires });
    return json({ short: `${url.origin}/${code}`, expires });
  }

  const code = url.pathname.slice(1);
  if (/^[a-z0-9]{6}$/.test(code)) {
    const v = await store.get(code, { type: "json" });
    if (!v) return gone(404);
    if (v.expires < Date.now()) { await store.delete(code); return gone(410); }
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

export const config = { path: ["/api/shorten", "/*"], preferStatic: true };
