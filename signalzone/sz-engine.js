// Waddey Signal Zone + BBMA - enjin kiraan (port terus dari Waddey_Signal_Zone.mq5)
// bars: [{t,o,h,l,c,v}] candle yang SUDAH TUTUP, lama -> baru.
(function (g) {
const DEF = {
  emaFast: 5, emaSlow: 13, atrLen: 14, slMult: 0.5, rr: 3.0, confirm: true,
  zoneBars: 3, requireZone: false,
  pivL: 4, pivR: 4, baseBars: 10, zoneMode: 0 /*0 kedua,1 supply,2 demand*/, zh: 2 /*0 wick,1 body,2 hybrid*/,
  minZH: 0.42, maxZH: 1.15, volMa: 20, useVolFilter: false, minVolMult: 0.70, volW: 0.62, reactW: 0.38,
  strong: 1.35, mid: 1.05, showSupply: true, showDemand: true, maxSupply: 3, maxDemand: 3,
  deleteBroken: true, conflict: true, mergeATR: 0.38, conflictATR: 0.22, fadeFar: true, nearATR: 5.0,
  bbLen: 20, bbDev: 2.0, maFast: 5, maSlow: 10, bbEma: 50, reCooldown: 3, requireBBMA: false,
  showExt: true, showMom: true, showCsa: true, showRe: true, showMhv: true,
  entrySrc: 'ema' /*ema | re | csa_ext | ema_re | lengkap*/, minGrade: 1, seqBars: 60, mhvATR: 0.3, nearE50: 3.0, fwdBars: 30,
  newsFilter: false, newsT: null, newsMin: 30,   // tapis berita: tiada trade baru +/- newsMin minit dari berita impak tinggi (newsT = [epoch saat])
  slStruct: false, structBars: 10, structBuf: 0.2, minSLATR: 0.5, maxSLATR: 4.0, // SL ikut struktur (swing / zon)
  beR: 0,
  roomFilter: false, pullback: false, pbBars: 3, sessLN: false, extFilter: false, extCandleATR: 2.0, extEmaATR: 3.0, bbwFilter: false,   // breakeven: alih SL ke entry selepas untung X R (0 = tiada)
  requireHTF: false, htf: null,   // htf: [{t: masa tutup candle TF besar, d: 1/-1}] untuk penapis TF besar
  asiaFilter: false, tfSec: 300   // asiaFilter: sembunyi signal BUY/SELL 00:00-07:00 UTC (08:00-15:00 MYT) untuk TF H1 ke bawah
};

function compute(bars, cfgIn, startBars) {
  const P = Object.assign({}, DEF, cfgIn || {});
  const N = bars.length;
  const O = bars.map(b => b.o), H = bars.map(b => b.h), L = bars.map(b => b.l), C = bars.map(b => b.c), T = bars.map(b => b.t);
  const V = bars.map(b => b.v != null ? b.v : 1);
  // EMA, ATR (RMA), volume MA
  const EF = [], ES = [], A = [], VM = []; const af = 2 / (P.emaFast + 1), as = 2 / (P.emaSlow + 1);
  let atr = 0, vs = 0;
  for (let i = 0; i < N; i++) {
    EF[i] = i ? C[i] * af + EF[i - 1] * (1 - af) : C[i];
    ES[i] = i ? C[i] * as + ES[i - 1] * (1 - as) : C[i];
    const tr = i ? Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])) : H[i] - L[i];
    if (i < P.atrLen) { atr += tr; A[i] = atr / (i + 1); } else A[i] = (A[i - 1] * (P.atrLen - 1) + tr) / P.atrLen;
    vs += V[i]; if (i >= P.volMa) vs -= V[i - P.volMa];
    VM[i] = i >= P.volMa - 1 ? vs / P.volMa : 0;
  }
  // BBMA
  const lw = (x, i, n) => { const m = Math.min(n, i + 1); let a = 0, d = 0; for (let j = 0; j < m; j++) { const w = m - j; a += x[i - j] * w; d += w; } return a / d; };
  const UP = [], MD = [], LO = [], MHF = [], MHS = [], MLF = [], MLS = [], E50 = [], BTr = []; const ae = 2 / (P.bbEma + 1);
  for (let i = 0; i < N; i++) {
    const n = Math.min(P.bbLen, i + 1); let sm = 0; for (let j = i - n + 1; j <= i; j++) sm += C[j];
    const mean = sm / n; let sq = 0; for (let j = i - n + 1; j <= i; j++) sq += (C[j] - mean) ** 2;
    const sd = Math.sqrt(sq / n); MD[i] = mean; UP[i] = mean + P.bbDev * sd; LO[i] = mean - P.bbDev * sd;
    MHF[i] = lw(H, i, P.maFast); MHS[i] = lw(H, i, P.maSlow); MLF[i] = lw(L, i, P.maFast); MLS[i] = lw(L, i, P.maSlow);
    E50[i] = i ? C[i] * ae + E50[i - 1] * (1 - ae) : C[i];
    BTr[i] = (MLF[i] > MD[i] && MLS[i] > MD[i] && C[i] > E50[i]) ? 1 : ((MHF[i] < MD[i] && MHS[i] < MD[i] && C[i] < E50[i]) ? -1 : 0);
  }

  // ---- zon
  const Sup = [], Dem = [];
  const mid = (t, b) => (t + b) / 2;
  const strength = sc => sc >= P.strong ? 'STRONG' : sc >= P.mid ? 'MID' : 'BASE';
  const distATR = (k, t, b) => { const d = C[k] > t ? C[k] - t : C[k] < b ? b - C[k] : 0; return A[k] > 0 ? d / A[k] : 0; };
  const score = (vm, ra) => { const ws = Math.max(P.volW + P.reactW, 0.01); return Math.max((vm * P.volW + Math.min(ra, 3) / 2 * P.reactW) / ws, 0.01); };
  const sameSide = (z, t, b, a) => z.some(o => (b <= o.top && t >= o.bot) || Math.abs(mid(t, b) - mid(o.top, o.bot)) <= a * P.mergeATR);
  const conflict = (z, t, b, a) => { const tol = a * P.conflictATR; return z.some(o => (b <= o.top + tol && t >= o.bot - tol) || Math.abs(mid(t, b) - mid(o.top, o.bot)) <= tol); };
  const isPH = p => { for (let j = 1; j <= P.pivL; j++) if (H[p - j] >= H[p]) return false; for (let j = 1; j <= P.pivR; j++) if (H[p + j] > H[p]) return false; return true; };
  const isPL = p => { for (let j = 1; j <= P.pivL; j++) if (L[p - j] <= L[p]) return false; for (let j = 1; j <= P.pivR; j++) if (L[p + j] < L[p]) return false; return true; };
  function zoneStep(k) {
    const R = P.pivR, BB = P.baseBars; if (k <= R + BB + 5) return;
    const p = k - R; if (p - P.pivL < 0 || p - BB + 1 < 0) return;
    const supOn = P.showSupply && (P.zoneMode === 0 || P.zoneMode === 1), demOn = P.showDemand && (P.zoneMode === 0 || P.zoneMode === 2);
    for (let side = 0; side < 2; side++) {
      const isSup = side === 0;
      if (isSup && (!supOn || !isPH(p))) continue;
      if (!isSup && (!demOn || !isPL(p))) continue;
      let wT = -Infinity, wB = Infinity, bT = -Infinity, bB = Infinity, v = 0;
      for (let j = p - BB + 1; j <= p; j++) { wT = Math.max(wT, H[j]); wB = Math.min(wB, L[j]); bT = Math.max(bT, O[j], C[j]); bB = Math.min(bB, O[j], C[j]); v += V[j]; }
      let t, b;
      if (isSup) { t = P.zh === 1 ? bT : wT; b = P.zh === 0 ? wB : bB; } else { t = P.zh === 0 ? wT : bT; b = P.zh === 1 ? bB : wB; }
      const a = A[k], m = mid(t, b), minH = a * P.minZH, maxH = a * P.maxZH;
      if (Math.max(t - b, 1e-9) < minH) { t = m + minH / 2; b = m - minH / 2; }
      if (t - b > maxH) { if (isSup) b = t - maxH; else t = b + maxH; }
      if (!(t > b)) continue;
      const baseVol = v / BB, volBase = VM[p] > 0 ? VM[p] : baseVol, vm = volBase > 0 ? baseVol / volBase : 1;
      const aP = A[p] > 0 ? A[p] : a; let react = 0;
      if (isSup) { let ll = Infinity; for (let j = p; j <= k; j++) ll = Math.min(ll, L[j]); react = H[p] - ll; }
      else { let hh = -Infinity; for (let j = p; j <= k; j++) hh = Math.max(hh, H[j]); react = hh - L[p]; }
      const sc = score(vm, aP > 0 ? Math.max(react / aP, 0) : 0);
      const volOK = !P.useVolFilter || vm >= P.minVolMult;
      const ovOK = isSup ? !sameSide(Sup, t, b, a) : !sameSide(Dem, t, b, a);
      const cfOK = !P.conflict || (isSup ? !conflict(Dem, t, b, a) : !conflict(Sup, t, b, a));
      if (volOK && ovOK && cfOK) {
        const arr = isSup ? Sup : Dem, mx = isSup ? P.maxSupply : P.maxDemand;
        arr.push({ top: t, bot: b, score: sc, left: p - BB + 1 }); while (arr.length > mx) arr.shift();
      }
    }
  }

  // ---- gelung utama
  const S = Math.max(3, N - (startBars || 1500));
  const Mk = []; let inPos = false, posType = 0, entry = 0, sl = 0, tp = 0, posBar = -1, tpLv = [], tpHit = [], posRisk = 0, beDone = false;
  let lastDemTouch = -1e9, lastSupTouch = -1e9, lastDemStr = '', lastSupStr = '', lastReB = -1e9, lastReS = -1e9, lastDemBot = 0, lastSupTop = 0;
  // arah TF besar pada masa candle k tutup (candle TF besar yang sudah tutup sahaja, tiada repaint)
  const HT = P.htf && P.htf.length ? P.htf : null; let hi0 = 0;
  const htfDir = tClose => { if (!HT) return 0; while (hi0 + 1 < HT.length && HT[hi0 + 1].t <= tClose) hi0++; return HT[hi0].t <= tClose ? HT[hi0].d : 0; };
  let lastFlags = {}; let pend = null, seqB = null, seqS = null;
  const NW = P.newsFilter && P.newsT && P.newsT.length ? P.newsT.slice().sort((a, b) => a - b) : null;
  const inNews = t => !!NW && NW.some(n => Math.abs(t - n) <= P.newsMin * 60);
  for (let k = S; k < N; k++) {
    const last = k === N - 1; let newsBlk = false;
    zoneStep(k);
    let supT = false, supB = false, demT = false, demB = false;
    Sup.forEach(z => { if (H[k] >= z.bot && L[k] <= z.top) { supT = true; lastSupTouch = k; lastSupStr = strength(z.score); lastSupTop = z.top; } if (C[k] > z.top) supB = true; });
    Dem.forEach(z => { if (H[k] >= z.bot && L[k] <= z.top) { demT = true; lastDemTouch = k; lastDemStr = strength(z.score); lastDemBot = z.bot; } if (C[k] < z.bot) demB = true; });
    if (P.deleteBroken) {
      for (let i = Sup.length - 1; i >= 0; i--) if (C[k] > Sup[i].top) Sup.splice(i, 1);
      for (let i = Dem.length - 1; i >= 0; i--) if (C[k] < Dem[i].bot) Dem.splice(i, 1);
    }
    let tpFinal = false, slHit = false, inv = false, invType = 0; const beAtExit = beDone;
    if (inPos && posType > 0) { if (H[k] >= tp) { tpFinal = true; inPos = false; posType = 0; } else if (L[k] <= sl) { slHit = true; inPos = false; posType = 0; } }
    if (inPos && posType < 0) { if (L[k] <= tp) { tpFinal = true; inPos = false; posType = 0; } else if (H[k] >= sl) { slHit = true; inPos = false; posType = 0; } }
    const newHits = [];
    if (inPos) tpLv.forEach((lv, i) => { if (!tpHit[i] && ((posType > 0 && H[k] >= lv) || (posType < 0 && L[k] <= lv))) { tpHit[i] = true; newHits.push(i); } });
    // breakeven: berkuat kuasa mulai candle seterusnya
    if (inPos && P.beR > 0 && !beDone && posRisk > 0 && ((posType > 0 && H[k] >= entry + P.beR * posRisk) || (posType < 0 && L[k] <= entry - P.beR * posRisk))) { sl = entry; beDone = true; }

    // ---- setup BBMA (dikira dulu supaya boleh jadi pencetus entry)
    const w = UP[k] - LO[k], w1 = UP[k - 1] - LO[k - 1], w2 = UP[k - 2] - LO[k - 2];
    const extB = MLF[k] < LO[k] && !(MLF[k - 1] < LO[k - 1]), extS = MHF[k] > UP[k] && !(MHF[k - 1] > UP[k - 1]);
    const momBr = C[k] > UP[k] && C[k] > O[k] && w > w1, momSr = C[k] < LO[k] && C[k] < O[k] && w > w1;
    const momB1 = C[k - 1] > UP[k - 1] && C[k - 1] > O[k - 1] && w1 > w2, momS1 = C[k - 1] < LO[k - 1] && C[k - 1] < O[k - 1] && w1 > w2;
    const csaB = C[k] > MD[k] && C[k - 1] <= MD[k - 1] && C[k] > MHF[k] && C[k] > MHS[k];
    const csaS = C[k] < MD[k] && C[k - 1] >= MD[k - 1] && C[k] < MLF[k] && C[k] < MLS[k];
    const reB = BTr[k] === 1 && L[k] <= Math.max(MLF[k], MLS[k]) && C[k] > MLF[k] && C[k] > MLS[k] && !momBr && k - lastReB > P.reCooldown;
    const reS = BTr[k] === -1 && H[k] >= Math.min(MHF[k], MHS[k]) && C[k] < MHF[k] && C[k] < MHS[k] && !momSr && k - lastReS > P.reCooldown;
    if (reB) lastReB = k; if (reS) lastReS = k;
    // turutan EXT -> MHV -> CSA -> RE
    if (seqB && k - seqB.k > P.seqBars) seqB = null;
    if (seqS && k - seqS.k > P.seqBars) seqS = null;
    let mhvB = false, mhvS = false;
    if (extB) seqB = { k, ext: L[k], mhv: false, csa: false };
    else if (seqB && !seqB.mhv) {
      if (C[k] < LO[k]) seqB.ext = Math.min(seqB.ext, L[k]);   // masih di luar BB: ekstrem berterusan
      else if (k - seqB.k >= 2 && MLF[k] >= LO[k] && L[k] <= seqB.ext + P.mhvATR * A[k]) { mhvB = true; seqB.mhv = true; }
    }
    if (extS) seqS = { k, ext: H[k], mhv: false, csa: false };
    else if (seqS && !seqS.mhv) {
      if (C[k] > UP[k]) seqS.ext = Math.max(seqS.ext, H[k]);
      else if (k - seqS.k >= 2 && MHF[k] <= UP[k] && H[k] >= seqS.ext - P.mhvATR * A[k]) { mhvS = true; seqS.mhv = true; }
    }
    const csaExtB = csaB && !!seqB, csaExtS = csaS && !!seqS;
    const lenB = reB && !!seqB && seqB.mhv && seqB.csa, lenS = reS && !!seqS && seqS.mhv && seqS.csa;
    if (csaB && seqB) seqB.csa = true; if (csaS && seqS) seqS.csa = true;
    if (lenB || csaS) seqB = null; if (lenS || csaB) seqS = null;
    // gred: TF besar searah + zon disentuh + dekat EMA50 (<= nearE50 ATR)
    const zBuy = k - lastDemTouch <= P.zoneBars, zSell = k - lastSupTouch <= P.zoneBars;
    const hdK = htfDir(T[k] + P.tfSec), nearE = Math.abs(C[k] - E50[k]) <= P.nearE50 * A[k];
    const why = d => ({ htf: HT ? hdK === d : false, zone: d > 0 ? zBuy : zSell, near: nearE });
    const gradeOf = wy => { const n = (wy.htf ? 1 : 0) + (wy.zone ? 1 : 0) + (wy.near ? 1 : 0); return n >= 3 ? 3 : n === 2 ? 2 : 1; };
    const wyB = why(1), wyS = why(-1), gB = gradeOf(wyB), gS = gradeOf(wyS);
    const lo = [], hi = [];
    if (lenB) lo.push('LENGKAP');
    if (P.showExt && extB) lo.push('EXT'); if (P.showMhv && mhvB) lo.push('MHV'); if (P.showMom && momBr && !momB1) lo.push('MOM'); if (P.showCsa && csaB) lo.push('CSA'); if (P.showRe && reB) lo.push('RE');
    if (lenS) hi.push('LENGKAP');
    if (P.showExt && extS) hi.push('EXT'); if (P.showMhv && mhvS) hi.push('MHV'); if (P.showMom && momSr && !momS1) hi.push('MOM'); if (P.showCsa && csaS) hi.push('CSA'); if (P.showRe && reS) hi.push('RE');
    const star = g => '★'.repeat(g);
    if (lo.length) Mk.push({ k, t: T[k], type: 'bbB', txt: lo.join(' ') + ' ' + star(gB), list: lo, grade: gB, lengkap: lenB, why: wyB, tr: C[k] > E50[k] });
    if (hi.length) Mk.push({ k, t: T[k], type: 'bbS', txt: hi.join(' ') + ' ' + star(gS), list: hi, grade: gS, lengkap: lenS, why: wyS, tr: C[k] < E50[k] });

    // ---- signal asas (pencetus entry dipilih melalui entrySrc)
    const bull = EF[k] > ES[k], bear = EF[k] < ES[k], change = bull !== (EF[k - 1] > ES[k - 1]);
    const emaB = bull && change && (!P.confirm || C[k] > O[k]);
    const emaS = bear && change && (!P.confirm || C[k] < O[k]);
    let stB = false, stS = false, useEma = false;
    switch (P.entrySrc) {
      case 're': stB = reB; stS = reS; break;
      case 'csa_ext': stB = csaExtB; stS = csaExtS; break;
      case 'ema_re': stB = reB; stS = reS; useEma = true; break;
      case 'lengkap': stB = lenB; stS = lenS; break;
      default: useEma = true;
    }
    if (P.minGrade > 1) { stB = stB && gB >= P.minGrade; stS = stS && gS >= P.minGrade; }
    let buy = (useEma && emaB) || stB, sell = (useEma && emaS) || stS;
    if (buy && sell) { buy = false; sell = false; }
    if (P.requireZone) { buy = buy && zBuy; sell = sell && zSell; }
    if (P.requireBBMA) { buy = buy && BTr[k] === 1; sell = sell && BTr[k] === -1; }
    if (P.requireHTF && HT) { buy = buy && hdK === 1; sell = sell && hdK === -1; }
    if (P.asiaFilter && P.tfSec <= 3600) { const hh = new Date((T[k] + P.tfSec) * 1000).getUTCHours(); if (hh >= 0 && hh < 7) { buy = false; sell = false; } }
    if (NW && (buy || sell) && inNews(T[k] + P.tfSec)) { buy = false; sell = false; newsBlk = true; }

    // ---- penapis tambahan (dipilih melalui Uji Strategi)
    if (P.sessLN && P.tfSec <= 3600) { const hh = new Date((T[k] + P.tfSec) * 1000).getUTCHours(); if (hh < 7 || hh >= 17) { buy = false; sell = false; } }
    if (P.extFilter && ((H[k] - L[k]) > P.extCandleATR * A[k] || Math.abs(C[k] - E50[k]) > P.extEmaATR * A[k])) { buy = false; sell = false; }
    if (P.bbwFilter) { let sw = 0, nw = 0; for (let j = Math.max(1, k - 50); j < k; j++) { sw += UP[j] - LO[j]; nw++; } if (nw > 10 && w < 0.7 * (sw / nw)) { buy = false; sell = false; } }

    // ---- bina pelan trade (entry, SL, TP) dari candle signal ks
    const plan = (d, ks, e, zT) => {
      let s0 = d > 0 ? L[ks] - A[ks] * P.slMult : H[ks] + A[ks] * P.slMult;
      if (P.slStruct) {
        let lv = d > 0 ? Infinity : -Infinity;
        for (let j = Math.max(0, ks - P.structBars + 1); j <= ks; j++) lv = d > 0 ? Math.min(lv, L[j]) : Math.max(lv, H[j]);
        if (d > 0 && zT && lastDemBot > 0) lv = Math.min(lv, lastDemBot);
        if (d < 0 && zT && lastSupTop > 0) lv = Math.max(lv, lastSupTop);
        s0 = lv - d * A[ks] * P.structBuf;
      }
      let r0 = (e - s0) * d;
      if (r0 <= 0) return null;
      if (P.slStruct) { r0 = Math.max(r0, A[ks] * P.minSLATR); r0 = Math.min(r0, A[ks] * P.maxSLATR); }
      const t0 = e + d * r0 * P.rr;
      // ruang ke TP: tiada zon lawan di antara entry dan TP
      if (P.roomFilter) {
        if (d > 0 && Sup.some(z => z.bot > e && z.bot < t0)) return null;
        if (d < 0 && Dem.some(z => z.top < e && z.top > t0)) return null;
      }
      return { e, sl: e - d * r0, tp: t0, risk: r0 };
    };
    let opened = null;
    const openPos = (d, pl, tags) => {
      if (inPos && posType === -d) { inv = true; invType = -d; inPos = false; }
      entry = pl.e; sl = pl.sl; tp = pl.tp; posRisk = pl.risk; beDone = false;
      tpLv = []; tpHit = []; for (let i = 1; i <= Math.floor(P.rr) - 1; i++) { tpLv.push(entry + d * posRisk * i); tpHit.push(false); }
      inPos = true; posType = d; posBar = k; opened = { d, tags };
    };
    const sigTags = d => { const t = []; if (d > 0) { if (zBuy) t.push('Demand ' + lastDemStr); if (BTr[k] === 1) t.push('BBMA naik'); } else { if (zSell) t.push('Supply ' + lastSupStr); if (BTr[k] === -1) t.push('BBMA turun'); } return t; };

    // ---- entry pullback: isi order yang menunggu
    if (pend && !(inPos && posType === pend.d)) {
      const d = pend.d;
      if (k - pend.k0 > P.pbBars || (d > 0 ? L[k] <= pend.sl0 : H[k] >= pend.sl0)) pend = null;
      else if (NW && (inNews(T[k]) || inNews(T[k] + P.tfSec))) { pend = null; newsBlk = true; }   // berita: batal order menunggu
      else if (d > 0 ? L[k] <= pend.level : H[k] >= pend.level) {
        const pl = plan(d, pend.k0, pend.level, pend.zT);
        if (pl) openPos(d, pl, pend.tags);
        pend = null;
      }
    }
    for (const d of [1, -1]) {
      if (!(d > 0 ? buy : sell)) continue;
      if (inPos && posType === d) continue;
      if (opened) continue;
      const zT = d > 0 ? zBuy : zSell;
      if (P.pullback) {
        // tunggu harga tarik balik ke EMA 5 atau 50% candle signal (mana lebih dekat)
        const mid = (H[k] + L[k]) / 2, level = d > 0 ? Math.max(EF[k], mid) : Math.min(EF[k], mid);
        const sl0 = d > 0 ? L[k] - A[k] * P.slMult : H[k] + A[k] * P.slMult;
        if ((d > 0 && level < C[k]) || (d < 0 && level > C[k])) { pend = { d, k0: k, level, sl0, zT, tags: sigTags(d) }; continue; }
      }
      const pl = plan(d, k, C[k], zT);
      if (pl) openPos(d, pl, sigTags(d));
    }
    const showBuy = !!opened && opened.d > 0, showSell = !!opened && opened.d < 0;
    if (newsBlk) Mk.push({ k, t: T[k], type: 'nblk', txt: 'Disekat berita' });
    if (tpFinal) Mk.push({ k, t: T[k], type: 'tp', txt: 'TP' });
    if (slHit) Mk.push(beAtExit ? { k, t: T[k], type: 'be', txt: 'BE' } : { k, t: T[k], type: 'sl', txt: 'SL' });
    if (inv) Mk.push({ k, t: T[k], type: 'inv', txt: invType > 0 ? 'INV BUY' : 'INV SELL' });
    if (opened) Mk.push({ k, t: T[k], type: opened.d > 0 ? 'buy' : 'sell', txt: opened.d > 0 ? 'BUY' : 'SELL', tags: opened.tags.slice(), price: entry, sl, tp });
    if (!showBuy && !showSell && inPos) newHits.forEach(i => Mk.push({ k, t: T[k], type: 'tpn', txt: 'TP' + (i + 1) }));
    if (last) lastFlags = { news: newsBlk, buy: showBuy, sell: showSell, tp: tpFinal, sl: slHit && !beAtExit, be: slHit && beAtExit, inv, supT, demT, supB, demB, bb: (lo.length ? 'BBMA BUY ' + lo.join(' ') + ' ' + star(gB) : '') + (hi.length ? ' BBMA SELL ' + hi.join(' ') + ' ' + star(gS) : '') };
  }
  // keputusan ke depan setiap setup (statistik sahaja): entry tutup candle, SL 1 ATR, TP 1 ATR (1R), dalam fwdBars candle
  Mk.forEach(m => {
    if (m.type !== 'bbB' && m.type !== 'bbS') return;
    const d = m.type === 'bbB' ? 1 : -1, e = C[m.k], a = A[m.k]; let res = null;
    for (let j = m.k + 1; j < N && j <= m.k + P.fwdBars; j++) {
      if (d > 0 ? L[j] <= e - a : H[j] >= e + a) { res = -1; break; }   // kena kedua-dua dalam 1 candle = dikira rugi
      if (d > 0 ? H[j] >= e + a : L[j] <= e - a) { res = 1; break; }
    }
    if (res === null && m.k + P.fwdBars < N) res = 0;
    m.res = res;
  });
  // ranking & ketelusan zon (seperti ALPHA S+)
  const k = N - 1;
  const rankZ = arr => arr.map((z, i) => {
    const ts = z.score / (1 + distATR(k, z.top, z.bot));
    let r = 1; arr.forEach((o, j) => { if (j !== i && o.score / (1 + distATR(k, o.top, o.bot)) > ts) r++; });
    let tr = r <= 2 ? 73 : 85; if (P.fadeFar && distATR(k, z.top, z.bot) > P.nearATR) tr += 12;
    return Object.assign({}, z, { rank: r, alpha: Math.max(0, 1 - Math.min(100, tr) / 100), strength: strength(z.score), t: T[z.left] });
  });
  return {
    T, O, H, L, C, A, EF, ES, UP, MD, LO, MHF, MHS, MLF, MLS, E50, BTr, S,
    sup: rankZ(Sup), dem: rankZ(Dem), marks: Mk, last: lastFlags,
    pos: inPos ? { dir: posType, entry, sl, tp, tpLv: tpLv.slice(), bar: posBar, t: T[posBar], risk: posRisk, be: beDone } : null,
    pend: (pend && P.pbBars - (N - 1 - pend.k0) > 0) ? { dir: pend.d, level: pend.level, sl: pend.sl0, t: T[pend.k0], left: P.pbBars - (N - 1 - pend.k0), tags: pend.tags } : null,
    trend: EF[k] > ES[k] ? 1 : -1, bbma: BTr[k]
  };
}
function setupMatch(m, mode) {
  if (!m || !m.list || (m.type !== 'bbB' && m.type !== 'bbS')) return false;
  const modes = String(mode || 'off').split(',').map(x => x.trim()).filter(Boolean);   // boleh lebih dari satu: "lengkap,all3"
  if (modes.length > 1) return modes.some(x => setupMatch(m, x));
  switch (modes[0]) {
    case 're3': return m.list.includes('RE') && m.grade >= 3;
    case 'lengkap': return !!m.lengkap;
    case 'all3': return m.grade >= 3;
    case 'all': return true;
    default: return false;
  }
}
const SRC_NAME = { ema: 'EMA 5/13', re: 'RE BBMA', csa_ext: 'CSA selepas EXT', ema_re: 'EMA + RE', lengkap: 'BBMA lengkap' };
g.WaddeySZ = { compute, DEF, setupMatch, SRC_NAME };
})(typeof window !== 'undefined' ? window : globalThis);
