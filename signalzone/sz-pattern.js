// Waddey Signal Zone: pengesan corak candle & corak chart (berjalan dalam browser, percuma)
// Input: hasil WaddeySZ.compute (R). Semua keputusan dibuat pada candle yang sudah tutup.
(function (g) {
'use strict';
const P = {
  MSTAR: { n: 'Morning Star', s: '★M', d: 1, m: '3 candle: jatuh kuat, ragu-ragu, kemudian naik kuat. Tanda pusingan naik.' },
  ESTAR: { n: 'Evening Star', s: '★E', d: -1, m: '3 candle: naik kuat, ragu-ragu, kemudian jatuh kuat. Tanda pusingan turun.' },
  BENG: { n: 'Bullish Engulfing', s: 'ENG▲', d: 1, m: 'Candle hijau menelan candle merah sebelumnya. Pembeli ambil alih.' },
  SENG: { n: 'Bearish Engulfing', s: 'ENG▼', d: -1, m: 'Candle merah menelan candle hijau sebelumnya. Penjual ambil alih.' },
  HAM: { n: 'Hammer / Pin Bar BUY', s: 'PIN▲', d: 1, m: 'Ekor bawah panjang: harga rendah ditolak, pembeli masuk.' },
  SHO: { n: 'Shooting Star / Pin Bar SELL', s: 'PIN▼', d: -1, m: 'Ekor atas panjang: harga tinggi ditolak, penjual masuk.' },
  TWB: { n: 'Tweezer Bottom', s: 'TWZ▲', d: 1, m: '2 candle dengan low yang sama: lantai harga dipertahankan.' },
  TWT: { n: 'Tweezer Top', s: 'TWZ▼', d: -1, m: '2 candle dengan high yang sama: siling harga dipertahankan.' },
  MBU: { n: 'Marubozu Bullish', s: 'MARU▲', d: 1, m: 'Candle hijau besar tanpa ekor: pembeli kawal sepenuhnya.' },
  MBE: { n: 'Marubozu Bearish', s: 'MARU▼', d: -1, m: 'Candle merah besar tanpa ekor: penjual kawal sepenuhnya.' },
  IB: { n: 'Inside Bar', s: 'IB', d: 0, m: 'Candle di dalam julat candle sebelumnya: pasaran berehat, tunggu pecah keluar.' },
  DOJI: { n: 'Doji', s: 'DOJI', d: 0, m: 'Buka = tutup: pembeli dan penjual seimbang, pasaran ragu-ragu.' }
};
const ORDER = ['MSTAR', 'ESTAR', 'BENG', 'SENG', 'HAM', 'SHO', 'TWB', 'TWT', 'MBU', 'MBE', 'IB', 'DOJI'];

// ---- corak candle bagi setiap bar
function candles(R, opt) {
  opt = opt || {};
  const { O, H, L, C, A, T, UP, LO, E50 } = R, N = C.length, fw = opt.fwdBars || 30, from = Math.max(R.S || 0, 3);
  const b = x => Math.abs(C[x] - O[x]), rg = x => H[x] - L[x], up = x => H[x] - Math.max(O[x], C[x]), lw = x => Math.min(O[x], C[x]) - L[x];
  const bull = x => C[x] > O[x], bear = x => C[x] < O[x];
  const out = [];
  for (let k = from; k < N; k++) {
    const a = A[k]; if (!(a > 0)) continue;
    const r0 = rg(k), f = [];
    if (bear(k - 2) && b(k - 2) >= 0.6 * a && b(k - 1) <= 0.35 * b(k - 2) && bull(k) && b(k) >= 0.4 * a && C[k] > (O[k - 2] + C[k - 2]) / 2) f.push('MSTAR');
    if (bull(k - 2) && b(k - 2) >= 0.6 * a && b(k - 1) <= 0.35 * b(k - 2) && bear(k) && b(k) >= 0.4 * a && C[k] < (O[k - 2] + C[k - 2]) / 2) f.push('ESTAR');
    if (bear(k - 1) && bull(k) && O[k] <= C[k - 1] + 0.05 * a && C[k] >= O[k - 1] && b(k) > b(k - 1) && b(k) >= 0.4 * a) f.push('BENG');
    if (bull(k - 1) && bear(k) && O[k] >= C[k - 1] - 0.05 * a && C[k] <= O[k - 1] && b(k) > b(k - 1) && b(k) >= 0.4 * a) f.push('SENG');
    if (r0 >= 0.6 * a && lw(k) >= 2 * Math.max(b(k), 0.05 * r0) && up(k) <= 0.25 * r0 && lw(k) >= 0.55 * r0) f.push('HAM');
    if (r0 >= 0.6 * a && up(k) >= 2 * Math.max(b(k), 0.05 * r0) && lw(k) <= 0.25 * r0 && up(k) >= 0.55 * r0) f.push('SHO');
    if (Math.abs(L[k] - L[k - 1]) <= 0.06 * a && bear(k - 1) && bull(k) && rg(k - 1) >= 0.5 * a) f.push('TWB');
    if (Math.abs(H[k] - H[k - 1]) <= 0.06 * a && bull(k - 1) && bear(k) && rg(k - 1) >= 0.5 * a) f.push('TWT');
    if (r0 >= 1.2 * a && b(k) >= 0.85 * r0) f.push(bull(k) ? 'MBU' : 'MBE');
    if (H[k] < H[k - 1] && L[k] > L[k - 1] && rg(k - 1) >= 0.8 * a) f.push('IB');
    if (r0 >= 0.3 * a && b(k) <= 0.1 * r0 && !f.includes('HAM') && !f.includes('SHO')) f.push('DOJI');
    if (!f.length) continue;
    f.sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));
    const key = f[0], d = P[key].d;
    // lokasi: tepi BB / searah EMA50
    const atLow = L[k] <= LO[k] + 0.15 * a || L[k - 1] <= LO[k - 1] + 0.15 * a;
    const atHigh = H[k] >= UP[k] - 0.15 * a || H[k - 1] >= UP[k - 1] - 0.15 * a;
    const goodLoc = d > 0 ? atLow : d < 0 ? atHigh : false;
    const withTrend = d > 0 ? C[k] > E50[k] : d < 0 ? C[k] < E50[k] : false;
    // keputusan ke depan (statistik sahaja): entry tutup candle, SL 1 ATR, TP 1 ATR
    let res = null;
    if (d !== 0) {
      const e = C[k];
      for (let j = k + 1; j < N && j <= k + fw; j++) {
        if (d > 0 ? L[j] <= e - a : H[j] >= e + a) { res = -1; break; }
        if (d > 0 ? H[j] >= e + a : L[j] <= e - a) { res = 1; break; }
      }
      if (res === null && k + fw < N) res = 0;
    }
    out.push({ k, t: T[k], key, list: f, d, name: P[key].n, short: P[key].s, res, goodLoc, withTrend });
  }
  return out;
}

// ---- statistik kadar menang setiap corak
function stats(list) {
  const s = {};
  list.forEach(x => {
    if (x.d === 0 || x.res == null || x.res === 0) return;
    const o = s[x.key] = s[x.key] || { all: [0, 0], loc: [0, 0], trend: [0, 0] };
    o.all[1]++; if (x.res === 1) o.all[0]++;
    if (x.goodLoc) { o.loc[1]++; if (x.res === 1) o.loc[0]++; }
    if (x.withTrend) { o.trend[1]++; if (x.res === 1) o.trend[0]++; }
  });
  return s;
}

// ---- corak chart (paparan semasa sahaja)
function pivots(R, p, lookback) {
  const { H, L } = R, N = H.length, ph = [], pl = [];
  for (let k = Math.max((R.S || 0) + p, N - lookback); k < N - p; k++) {
    let isH = true, isL = true;
    for (let j = k - p; j <= k + p; j++) {
      if (j === k) continue;
      if (H[j] > H[k] || (j < k && H[j] === H[k])) isH = false;
      if (L[j] < L[k] || (j < k && L[j] === L[k])) isL = false;
    }
    if (isH) ph.push({ k, v: H[k] });
    if (isL) pl.push({ k, v: L[k] });
  }
  return { ph, pl };
}
function chartPats(R, opt) {
  opt = opt || {};
  const { T, H, L, C, A } = R, N = C.length, k = N - 1, a = A[k], out = [];
  if (N < 60 || !(a > 0)) return out;
  const pv = pivots(R, opt.piv || 5, opt.look || 160), ph = pv.ph, pl = pv.pl;
  const firstClose = (from, test) => { for (let j = from; j < N; j++) if (test(j)) return j; return -1; };
  const line = (k1, p1, k2, p2, col, dash) => ({ t1: T[k1], p1, t2: T[k2], p2, col, dash: !!dash });

  // Double Top / Double Bottom
  const dbl = (arr, top) => {
    if (arr.length < 2) return;
    const p2 = arr[arr.length - 1], p1 = arr[arr.length - 2];
    if (k - p2.k > 60 || p2.k - p1.k < 6 || Math.abs(p1.v - p2.v) > 0.5 * a) return;
    let neck = top ? Infinity : -Infinity, nk = p1.k;
    for (let j = p1.k; j <= p2.k; j++) { if (top ? L[j] < neck : H[j] > neck) { neck = top ? L[j] : H[j]; nk = j; } }
    const ext = top ? Math.max(p1.v, p2.v) : Math.min(p1.v, p2.v), depth = Math.abs(ext - neck);
    if (depth < 1.0 * a) return;
    for (let j = p2.k + 1; j < N; j++) if (top ? C[j] > ext + 0.2 * a : C[j] < ext - 0.2 * a) return;   // batal: harga lepasi puncak
    const kb = firstClose(p2.k + 1, j => top ? C[j] < neck : C[j] > neck);
    if (kb >= 0 && k - kb > 30) return;
    const target = top ? neck - depth : neck + depth;
    const ok = kb >= 0;
    out.push({
      type: top ? 'DT' : 'DB', name: top ? 'Double Top' : 'Double Bottom', d: top ? -1 : 1,
      status: ok ? 'disahkan (pecah neckline)' : 'sedang terbentuk',
      msg: (top ? 'Double Top: dua puncak hampir sama tinggi di ' : 'Double Bottom: dua lantai hampir sama rendah di ') + 'sekitar ' + ext.toFixed(2) + '. Neckline ' + neck.toFixed(2) + '. ' +
        (ok ? (top ? 'Neckline dah pecah ke bawah: tanda turun, sasaran sekitar ' : 'Neckline dah pecah ke atas: tanda naik, sasaran sekitar ') + target.toFixed(2) + '.'
            : (top ? 'Belum sah. Jadi tanda SELL bila candle tutup bawah neckline.' : 'Belum sah. Jadi tanda BUY bila candle tutup atas neckline.')),
      level: neck, target, confirmed: ok,
      lines: [line(p1.k, p1.v, p2.k, p2.v, top ? '#f97316' : '#3b82f6'), line(Math.min(p1.k, nk), neck, k, neck, '#facc15', true)],
      label: { t: T[p2.k], p: p2.v, txt: (top ? 'Double Top' : 'Double Bottom') + (ok ? ' ✓' : '') }
    });
  };
  dbl(ph, true); dbl(pl, false);

  // Triangle
  if (ph.length >= 2 && pl.length >= 2) {
    const h2 = ph[ph.length - 1], h1 = ph[ph.length - 2], l2 = pl[pl.length - 1], l1 = pl[pl.length - 2];
    const recent = k - Math.min(h1.k, l1.k) <= 90 && h2.k - h1.k >= 5 && l2.k - l1.k >= 5;
    if (recent) {
      const sH = (h2.v - h1.v) / (h2.k - h1.k), sL = (l2.v - l1.v) / (l2.k - l1.k);
      const flatH = Math.abs(h2.v - h1.v) <= 0.4 * a, flatL = Math.abs(l2.v - l1.v) <= 0.4 * a;
      const fallH = h2.v < h1.v - 0.4 * a, riseL = l2.v > l1.v + 0.4 * a;
      let kind = null, bias = 0;
      if (flatH && riseL) { kind = 'Ascending Triangle'; bias = 1; }
      else if (fallH && flatL) { kind = 'Descending Triangle'; bias = -1; }
      else if (fallH && riseL) { kind = 'Symmetrical Triangle'; bias = 0; }
      if (kind) {
        const hAt = j => flatH ? (h1.v + h2.v) / 2 : h2.v + sH * (j - h2.k), lAt = j => flatL ? (l1.v + l2.v) / 2 : l2.v + sL * (j - l2.k);
        if (hAt(k) > lAt(k)) {
          const st = Math.max(h2.k, l2.k) + 1;
          const kb = firstClose(st, j => C[j] > hAt(j) + 0.1 * a || C[j] < lAt(j) - 0.1 * a);
          if (kb < 0 || k - kb <= 12) {
            const brk = kb >= 0 ? (C[kb] > hAt(kb) ? 1 : -1) : 0, d = brk || bias;
            out.push({
              type: 'TRI', name: kind, d, status: brk ? (brk > 0 ? 'pecah ke atas' : 'pecah ke bawah') : 'masih dalam triangle',
              msg: kind + ': harga makin mengecil antara garis atas ' + hAt(k).toFixed(2) + ' dan garis bawah ' + lAt(k).toFixed(2) + '. ' +
                (brk ? (brk > 0 ? 'Dah pecah ke ATAS: tanda naik.' : 'Dah pecah ke BAWAH: tanda turun.')
                     : (bias > 0 ? 'Biasanya pecah ke atas, tapi tunggu candle tutup luar garis.' : bias < 0 ? 'Biasanya pecah ke bawah, tapi tunggu candle tutup luar garis.' : 'Arah pecah belum tentu: tunggu candle tutup luar garis.')),
              level: brk > 0 ? hAt(k) : brk < 0 ? lAt(k) : null, confirmed: !!brk,
              lines: [line(h1.k, h1.v, k, hAt(k), '#f472b6'), line(l1.k, l1.v, k, lAt(k), '#14b8a6')],
              label: { t: T[k], p: hAt(k), txt: kind.replace(' Triangle', ' △') + (brk ? (brk > 0 ? ' ↑' : ' ↓') : '') }
            });
          }
        }
      }
    }
  }

  // Break & Retest paras pivot terakhir
  const bnr = (arr, up) => {
    if (!arr.length) return;
    const pv0 = arr[arr.length - 1], lv = pv0.v;
    const kb = firstClose(pv0.k + 1, j => up ? C[j] > lv + 0.1 * a : C[j] < lv - 0.1 * a);
    if (kb < 0 || k - kb > 20) return;
    for (let j = kb + 1; j < N; j++) if (up ? C[j] < lv - 0.2 * a : C[j] > lv + 0.2 * a) return;   // gagal: tutup balik ke dalam
    let kr = -1;
    for (let j = kb + 1; j < N; j++) if (up ? (L[j] <= lv + 0.25 * a && C[j] > lv) : (H[j] >= lv - 0.25 * a && C[j] < lv)) { kr = j; }
    out.push({
      type: up ? 'BRB' : 'BRS', name: up ? 'Break & Retest BUY' : 'Break & Retest SELL', d: up ? 1 : -1,
      status: kr >= 0 ? 'retest berlaku' : 'pecah, menunggu retest',
      msg: (up ? 'Resistance ' : 'Support ') + lv.toFixed(2) + (up ? ' dah pecah ke atas' : ' dah pecah ke bawah') + '. ' +
        (kr >= 0 ? (up ? 'Harga dah uji semula paras itu dari atas dan bertahan: tanda BUY.' : 'Harga dah uji semula paras itu dari bawah dan bertahan: tanda SELL.')
                 : 'Tunggu harga uji semula paras itu (retest) sebelum masuk.'),
      level: lv, confirmed: kr >= 0,
      lines: [line(pv0.k, lv, k, lv, up ? '#22c55e' : '#ef4444', true)],
      label: { t: T[kr >= 0 ? kr : kb], p: lv, txt: up ? 'B&R ▲' : 'B&R ▼' }
    });
  };
  bnr(ph, true); bnr(pl, false);
  return out;
}

g.WaddeyPat = { candles, stats, chartPats, NAMES: P, ORDER };
})(typeof window !== 'undefined' ? window : globalThis);
