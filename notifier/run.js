// Notifier Waddey FX: dijalankan oleh GitHub Actions setiap ~5 minit.
// Ambil data Deriv, jalankan analisis yang sama dengan dashboard, hantar notifikasi bila ada signal baru.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const A = require('../analysis.js');

const VAPID_PUBLIC = 'BHCXo1QEsFGjJK7op_zETF-Cka01bDyWWbR5DpLn9a6V7JVqfBf3pgU_1xOicefPT2PuFi8KqDHCyibleRO4CtY';
const SUBJECT = 'https://github.com/';
const SYMBOL = (process.env.SYMBOL || '').trim() || 'frxXAUUSD';
const OFFSET = parseFloat(process.env.BROKER_OFFSET || '0') || 0;
const MAX_AGE_MIN = 30;
const STATE_FILE = path.join(__dirname, 'state.json');
const ENDPOINTS = ['wss://api.derivws.com/trading/v1/options/ws/public', 'wss://ws.derivws.com/websockets/v3?app_id=1089'];
const COUNTS = { D1: 400, H4: 300, H1: 400, M15: 800, M5: 1500 };
const LABEL = { frxXAUUSD: 'XAUUSD', frxXAGUSD: 'XAGUSD', frxEURUSD: 'EURUSD', R_100: 'Volatility 100', '1HZ100V': 'Volatility 100 (1s)' };

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; } };
const writeState = s => fs.writeFileSync(STATE_FILE, JSON.stringify(s));
const dp = p => p < 20 ? 5 : p < 1000 ? 3 : 2;
const fmt = (v, ref) => Number(v).toFixed(dp(ref));

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
      if (e.statusCode === 404 || e.statusCode === 410) console.log('Kunci notifikasi sudah tamat. Aktifkan semula dalam app dan kemas kini secret PUSH_SUB.');
      else console.log('Gagal hantar:', e.statusCode || '', e.body || e.message);
    }
  }
  console.log(`Notifikasi dihantar: ${ok}/${subs.length}`);
}

async function main() {
  if (!process.env.VAPID_PRIVATE || !process.env.PUSH_SUB) { console.log('Secret VAPID_PRIVATE atau PUSH_SUB belum diisi.'); process.exitCode = 1; return; }
  webpush.setVapidDetails(SUBJECT, VAPID_PUBLIC, process.env.VAPID_PRIVATE.trim());
  let subs = JSON.parse(process.env.PUSH_SUB); if (!Array.isArray(subs)) subs = [subs];
  const state = readState(); writeState(state);

  if (String(process.env.TEST) === 'true') {
    await sendAll(subs, { title: 'Waddey FX', body: 'Ujian berjaya. Signal ' + (LABEL[SYMBOL] || SYMBOL) + ' akan dihantar ke sini.', tag: 'waddeyfx-test' });
    return;
  }

  let ws = null;
  for (const u of ENDPOINTS) { try { ws = await connect(u); break; } catch (e) { console.log(e.message); } }
  if (!ws) throw new Error('Tidak dapat sambung ke Deriv');
  const send = client(ws);
  let now = Date.now() / 1000;
  try { const r = await send({ time: 1 }); if (r.time) now = r.time; } catch (e) {}
  const D = {};
  for (const tf of ['D1', 'H4', 'H1', 'M15', 'M5']) {
    const r = await send({ ticks_history: SYMBOL, end: 'latest', style: 'candles', granularity: A_TF(tf), count: COUNTS[tf], adjust_start_time: 1 });
    const arr = (r.candles || []).map(b => ({ t: +b.epoch, o: +b.open, h: +b.high, l: +b.low, c: +b.close }));
    D[tf] = tf === 'D1' ? arr : arr.filter(b => b.t + A_TF(tf) <= now + 1);
  }
  try { ws.close(); } catch (e) {}
  if (D.M5.length < 400) { console.log('Data M5 tidak mencukupi'); return; }
  if (now - D.M5[D.M5.length - 1].t > 3600) { console.log('Pasaran tutup, tiada semakan'); return; }

  const AN = A.analyze(D, now), E = A.eaSim(D.M5, D.M15), L = E.latest;
  if (!L) { console.log('Tiada signal'); return; }
  const key = `${SYMBOL}:${L.t}:${L.dir}`, ageMin = (now - (L.t + 300)) / 60;
  console.log(`Signal terkini ${L.dir > 0 ? 'BUY' : 'SELL'} [${L.trig}] ${ageMin.toFixed(1)} minit lalu`);
  if (key === state.lastKey) { console.log('Sudah dihantar sebelum ini'); return; }
  const flip = state.lastDir && state.lastDir !== L.dir;
  state.lastKey = key; state.lastDir = L.dir; writeState(state);
  if (ageMin > MAX_AGE_MIN) { console.log('Signal terlalu lama, tidak dihantar'); return; }

  const P = L.plan, ref = AN.price, d = L.dir > 0 ? 'BUY' : 'SELL', o = OFFSET;
  const smc = (L.dir > 0 ? AN.buy : AN.sell).score;
  await sendAll(subs, {
    title: `Waddey FX · ${flip ? 'PUSING ARAH → ' : ''}${d} ${LABEL[SYMBOL] || SYMBOL}`,
    body: `[${L.trig}] Entry ${fmt(P.entry + o, ref)} · SL ${fmt(P.sl + o, ref)}\nTP1 ${fmt(P.tp1 + o, ref)} · TP2 ${fmt(P.tp2 + o, ref)}${o ? ' (harga broker)' : ''}\nSelari SMC ${smc}/6 · ${Math.round(ageMin)} minit lalu`,
    tag: 'waddeyfx-signal'
  });
}
const A_TF = tf => A.TFSEC[tf];
main().catch(e => { console.log('Ralat:', e.message); process.exitCode = 1; });
