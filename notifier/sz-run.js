// Notifier Waddey Signal Zone + BBMA: dijalankan oleh GitHub Actions setiap ~5 minit.
// Kira signal guna enjin yang SAMA dengan dashboard (signalzone/sz-engine.js) dan hantar push ke phone
// bila ada signal BUY/SELL baru, TP kena atau SL kena. Juga amaran berita USD impak tinggi.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
require('../signalzone/sz-engine.js');
const SZ = globalThis.WaddeySZ;

const VAPID_PUBLIC = 'BHCXo1QEsFGjJK7op_zETF-Cka01bDyWWbR5DpLn9a6V7JVqfBf3pgU_1xOicefPT2PuFi8KqDHCyibleRO4CtY';
const SUBJECT = 'https://github.com/';
const env = (k, d) => { const v = (process.env[k] || '').trim(); return v === '' ? d : v; };
const SYMBOL = env('SZ_SYMBOL', 'frxXAUUSD');
const TFLIST = env('SZ_TFS', 'M5,M15,H1').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const OFFSET = parseFloat(env('BROKER_OFFSET', '0')) || 0;
const CFG = {
  requireZone: env('SZ_REQUIRE_ZONE', 'false') === 'true',
  requireBBMA: env('SZ_REQUIRE_BBMA', 'false') === 'true',
  asiaFilter: env('SZ_ASIA_FILTER', 'false') === 'true',
  slStruct: env('SZ_SL_STRUCT', 'false') === 'true',
  requireHTF: env('SZ_REQUIRE_HTF', 'false') === 'true',
  beR: parseFloat(env('SZ_BE_R', '0')) || 0,
  roomFilter: env('SZ_ROOM', 'false') === 'true',
  pullback: env('SZ_PULLBACK', 'false') === 'true',
  sessLN: env('SZ_SESS_LN', 'false') === 'true',
  extFilter: env('SZ_EXT', 'false') === 'true',
  bbwFilter: env('SZ_BBW', 'false') === 'true',
  entrySrc: env('SZ_ENTRY_SRC', 'ema'),
  minGrade: parseInt(env('SZ_MIN_GRADE', '1'), 10) || 1,
  newsFilter: env('SZ_NEWS_FILTER', 'true') === 'true',
  lateConfirm: parseInt(env('SZ_LATE', '2'), 10) || 0,
  reEntry: env('SZ_REENTRY', 'true') === 'true',
  rr: parseFloat(env('SZ_RR', '3')) || 3
};
const ALERT_TPSL = env('SZ_ALERT_TPSL', 'true') === 'true';
const ALERT_NEWS = env('SZ_ALERT_NEWS', 'true') === 'true';
const SETUP_ALERT = env('SZ_SETUP_ALERT', 'off');   // off | re3 | lengkap | all3 | all
const TFS = { M5: 300, M15: 900, H1: 3600, H4: 14400, D1: 86400 };
const HTF = { M5: 'H1', M15: 'H1', H1: 'H4', H4: 'D1', D1: 'D1' };
const LABEL = { frxXAUUSD: 'XAUUSD', frxXAGUSD: 'XAGUSD', frxEURUSD: 'EURUSD', frxGBPUSD: 'GBPUSD', frxUSDJPY: 'USDJPY' };
const STATE_FILE = path.join(__dirname, 'sz-state.json');
const NEWS_FILE = path.join(__dirname, '..', 'signalzone', 'news.json');
const ENDPOINTS = ['wss://api.derivws.com/trading/v1/options/ws/public', 'wss://ws.derivws.com/websockets/v3?app_id=1089'];

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; } };
const writeState = s => fs.writeFileSync(STATE_FILE, JSON.stringify(s));
const dp = p => p < 20 ? 5 : p < 1000 ? 3 : 2;
const fmt = (v, ref) => Number(v + OFFSET).toFixed(dp(ref));
const sym = LABEL[SYMBOL] || SYMBOL;

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => { try { ws.close(); } catch (e) {} reject(new Error('timeout ' + url)); }, 15000);
    ws.onopen = () => { clearTimeout(t); resolve(ws); };
    ws.onerror = () => { clearTimeout(t); reject(new Error('gagal sambung ' + url)); };
  });
}
function client(ws) {
  let id = 1; const pend = new Map();
  ws.onmessage = ev => { let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString()); } catch (e) { return; }
    const p = pend.get(m.req_id); if (!p) return; pend.delete(m.req_id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m); };
  return obj => new Promise((resolve, reject) => {
    const rid = id++; obj.req_id = rid; pend.set(rid, { resolve, reject });
    setTimeout(() => { if (pend.has(rid)) { pend.delete(rid); reject(new Error('tiada jawapan')); } }, 20000);
    ws.send(JSON.stringify(obj));
  });
}
async function sendAll(subs, payload) {
  let ok = 0;
  for (const s of subs) {
    try { await webpush.sendNotification(s, JSON.stringify(payload), { TTL: 1800, urgency: 'high' }); ok++; }
    catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) console.log('Kod notifikasi sudah tamat. Aktifkan semula dalam app dan kemas kini secret PUSH_SUB_SZ.');
      else console.log('Gagal hantar:', e.statusCode || '', e.body || e.message);
    }
  }
  console.log(`Dihantar: ${ok}/${subs.length} · ${payload.title}`);
}

async function main() {
  if (!process.env.VAPID_PRIVATE || !process.env.PUSH_SUB_SZ) { console.log('Secret VAPID_PRIVATE atau PUSH_SUB_SZ belum diisi.'); process.exitCode = 1; return; }
  webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC, process.env.VAPID_PRIVATE.trim());
  let subs = JSON.parse(process.env.PUSH_SUB_SZ); if (!Array.isArray(subs)) subs = [subs];
  const state = readState(); writeState(state);

  if (String(process.env.TEST) === 'true') {
    await sendAll(subs, { title: 'Waddey Signal Zone', body: `Ujian berjaya ✅ Signal ${sym} (${TFLIST.join(', ')}) akan dihantar ke sini.`, tag: 'wsz-test' });
    return;
  }

  // --- amaran berita (dari signalzone/news.json yang dikemas kini oleh workflow berita)
  let now = Date.now() / 1000;
  if (ALERT_NEWS) {
    try {
      const news = JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8')).events || [];
      state.news = state.news || {};
      for (const n of news) {
        if (n.impact !== 'High') continue;
        const mins = (n.t - now) / 60;
        const key = n.t + '|' + n.title;
        if (mins > 0 && mins <= 30 && !state.news[key]) {
          state.news[key] = 1; writeState(state);
          const hm = new Date(n.t * 1000).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kuala_Lumpur' });
          await sendAll(subs, { title: `⚠️ Berita ${n.country} dalam ${Math.round(mins)} minit`, body: `${n.title} (${hm} MYT). Emas boleh bergerak kuat — elak buka trade baru, ketatkan SL.`, tag: 'wsz-news' });
        }
      }
      for (const k of Object.keys(state.news)) if (+k.split('|')[0] < now - 86400) delete state.news[k];
    } catch (e) { console.log('Tiada fail berita:', e.message); }
  }

  let ws = null;
  for (const u of ENDPOINTS) { try { ws = await connect(u); break; } catch (e) { console.log(e.message); } }
  if (!ws) throw new Error('Tidak dapat sambung ke Deriv');
  const send = client(ws);
  try { const r = await send({ time: 1 }); if (r.time) now = r.time; } catch (e) {}

  // waktu berita USD impak tinggi untuk tapis berita
  try { CFG.newsT = (JSON.parse(fs.readFileSync(NEWS_FILE, 'utf8')).events || []).filter(n => n.impact === 'High' && String(n.country).toUpperCase() === 'USD').map(n => n.t); } catch (e) { CFG.newsT = []; }
  state.tf = state.tf || {};
  for (const tf of TFLIST) {
    const sec = TFS[tf]; if (!sec) continue;
    let bars;
    try {
      const r = await send({ ticks_history: SYMBOL, end: 'latest', style: 'candles', granularity: sec, count: 1600, adjust_start_time: 1 });
      bars = (r.candles || []).map(b => ({ t: +b.epoch, o: +b.open, h: +b.high, l: +b.low, c: +b.close })).filter(b => b.t + sec <= now + 1);
    } catch (e) { console.log(tf, 'gagal ambil data:', e.message); continue; }
    if (bars.length < 200) { console.log(tf, 'data tak cukup'); continue; }
    const lastT = bars[bars.length - 1].t;
    if (now - (lastT + sec) > Math.max(3600, sec * 2)) { console.log(tf, 'pasaran tutup'); continue; }
    let htf = null;
    if (HTF[tf] !== tf) {   // sentiasa ambil TF besar: perlu untuk gred setup BBMA
      try {
        const hs = TFS[HTF[tf]];
        const hr = await send({ ticks_history: SYMBOL, end: 'latest', style: 'candles', granularity: hs, count: 1600, adjust_start_time: 1 });
        const a5 = 2 / 6, a13 = 2 / 14; let e5 = null, e13 = null; htf = [];
        (hr.candles || []).map(b => ({ t: +b.epoch, c: +b.close })).filter(b => b.t + hs <= now + 1).forEach(b => {
          e5 = e5 == null ? b.c : b.c * a5 + e5 * (1 - a5); e13 = e13 == null ? b.c : b.c * a13 + e13 * (1 - a13);
          htf.push({ t: b.t + hs, d: e5 > e13 ? 1 : e5 < e13 ? -1 : 0 });
        });
      } catch (e) { console.log(tf, 'gagal ambil TF besar:', e.message); }
    }
    const R = SZ.compute(bars, Object.assign({}, CFG, { tfSec: sec, htf }), 1500);
    const st = state.tf[tf] = state.tf[tf] || {};
    // peristiwa baru sejak candle terakhir yang disemak. GitHub selalunya jalankan workflow ~sekali sejam
    // (bukan setiap 5 minit), jadi semak semua candle sejak run lepas, maksimum 3 jam ke belakang.
    const since = Math.max(st.lastBar || (lastT - sec * 2), lastT - 3 * 3600);
    const fresh = R.marks.filter(m => m.t > since && (['buy', 'sell', 'tp', 'sl', 'be', 'inv'].includes(m.type) || SZ.setupMatch(m, SETUP_ALERT)));
    st.lastBar = lastT;
    const ref = bars[bars.length - 1].c;
    const age = m => { const mn = Math.round((now - (m.t + sec)) / 60); return mn >= 10 ? ` (${mn >= 60 ? Math.floor(mn / 60) + ' jam ' + (mn % 60) + ' minit' : mn + ' minit'} lalu)` : ''; };
    // gabung: setup BBMA yang searah dengan signal BUY/SELL pada candle yang sama masuk ke dalam notifikasi signal
    for (const m of fresh) {
      if (m.type === 'buy' || m.type === 'sell') {
        const d = m.type === 'buy' ? 'BUY' : 'SELL';
        const KIND = ['Sah lewat', 'Masuk semula'], kind = m.tags.find(t => KIND.includes(t)), tg = m.tags.filter(t => !KIND.includes(t));
        const sup = (kind ? kind + ' · ' : '') + (tg.length ? tg.join(' · ') : 'EMA sahaja');
        const stars = tg.length >= 2 ? '⭐⭐⭐' : tg.length === 1 ? '⭐⭐' : '⭐';
        const st = fresh.find(x => x.k === m.k && x.type === (m.type === 'buy' ? 'bbB' : 'bbS'));
        const stTxt = st ? `\n${st.lengkap ? '⭐ Setup BBMA lengkap' : 'Setup BBMA'}: ${st.list.join(' · ')} ${'⭐'.repeat(st.grade)}` : '';
        await sendAll(subs, { title: `${m.type === 'buy' ? '🟢' : '🔴'} ${d} ${sym} ${tf} ${stars}${st && st.lengkap ? ' + BBMA lengkap' : ''}${age(m)}`,
          body: `Entry ${fmt(m.price, ref)} · SL ${fmt(m.sl, ref)} · TP ${fmt(m.tp, ref)}\nSokongan: ${sup}${stTxt}${OFFSET ? '\n(harga broker)' : ''}`, tag: 'wsz-' + tf + '-' + m.t });
      } else if (m.type === 'bbB' || m.type === 'bbS') {
        if (fresh.some(x => x.k === m.k && x.type === (m.type === 'bbB' ? 'buy' : 'sell'))) continue;   // sudah digabung dalam notifikasi signal
        const d = m.type === 'bbB' ? 'BUY' : 'SELL', w = m.why || {};
        const why = [w.htf ? 'TF besar searah' : '', w.zone ? (m.type === 'bbB' ? 'di Demand' : 'di Supply') : '', w.near ? 'dekat EMA50' : ''].filter(Boolean).join(' · ') || 'tiada sokongan tambahan';
        await sendAll(subs, { title: `${m.lengkap ? '⭐ Setup BBMA lengkap' : '📐 Setup BBMA'} ${d} ${sym} ${tf} ${'⭐'.repeat(m.grade)}${age(m)}`,
          body: `${m.list.join(' · ')} @ ${fmt(bars[m.k].c, ref)}\nSokongan: ${why}\nIni amaran setup, bukan signal entry. Semak chart dulu.`, tag: 'wsz-bb-' + tf + '-' + m.t });
      } else if (ALERT_TPSL) {
        const t = m.type === 'tp' ? `✅ TP kena · ${sym} ${tf}` : m.type === 'sl' ? `❌ SL kena · ${sym} ${tf}` : m.type === 'be' ? `⚪ Breakeven · ${sym} ${tf}` : `⚠️ ${m.txt} · ${sym} ${tf}`;
        const b = m.type === 'tp' ? `Sasaran ${CFG.rr}R tercapai. Trade selesai dengan untung.` : m.type === 'sl' ? 'Stop loss kena. Trade selesai -1R. Tunggu setup seterusnya.' : m.type === 'be' ? 'Harga kembali ke Entry selepas SL dialih. Trade selesai 0R (tiada rugi).' : 'Signal lama dibatalkan kerana signal arah lawan keluar.';
        await sendAll(subs, { title: t + age(m), body: b, tag: 'wsz-res-' + tf + '-' + m.t });
      }
    }
    console.log(tf, `semak OK · ${fresh.length} peristiwa baru`);
  }
  writeState(state);
  try { ws.close(); } catch (e) {}
}
main().catch(e => { console.log('Ralat:', e.message); process.exitCode = 1; });
