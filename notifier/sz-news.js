// Ambil kalendar ekonomi minggu ini (ForexFactory JSON) dan simpan ke signalzone/news.json
// supaya dashboard & notifier boleh beri amaran berita impak tinggi.
const fs = require('fs');
const path = require('path');
const URL_FF = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const OUT = path.join(__dirname, '..', 'signalzone', 'news.json');
const KEEP = (process.env.SZ_NEWS_CCY || 'USD').split(',').map(s => s.trim().toUpperCase());

(async () => {
  const r = await fetch(URL_FF, { headers: { 'User-Agent': 'waddey-signal-zone' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const raw = await r.json();
  const events = raw.filter(e => KEEP.includes(String(e.country).toUpperCase()) && (e.impact === 'High' || e.impact === 'Medium'))
    .map(e => ({ t: Math.floor(new Date(e.date).getTime() / 1000), title: e.title, country: e.country, impact: e.impact, forecast: e.forecast || '', previous: e.previous || '' }))
    .filter(e => isFinite(e.t)).sort((a, b) => a.t - b.t);
  const body = JSON.stringify({ events }, null, 0);
  let old = ''; try { old = JSON.stringify({ events: JSON.parse(fs.readFileSync(OUT, 'utf8')).events }); } catch (e) {}
  if (old === body) { console.log('Tiada perubahan berita'); return; }
  fs.writeFileSync(OUT, JSON.stringify({ updated: Math.floor(Date.now() / 1000), events }));
  console.log('Berita dikemas kini:', events.length, 'peristiwa');
})().catch(e => { console.log('Ralat berita:', e.message); process.exitCode = 1; });
