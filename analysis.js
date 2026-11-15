// Analisis Waddey FX: digunakan oleh dashboard (browser) dan notifier GitHub Actions (Node).
const TFSEC = {W1:604800, D1:86400, H4:14400, H1:3600, M30:1800, M15:900, M5:300, M1:60};

function ema(vals, p){
  const out = new Array(vals.length).fill(null); if(vals.length < p) return out;
  let s = 0; for(let i=0;i<p;i++) s += vals[i]; let e = s/p; out[p-1] = e;
  const k = 2/(p+1); for(let i=p;i<vals.length;i++){ e = vals[i]*k + e*(1-k); out[i] = e; }
  return out;
}
function atrArr(c, p){
  const out = new Array(c.length).fill(null); if(c.length < p+1) return out;
  const tr = c.map((b,i)=> i===0 ? b.h-b.l : Math.max(b.h-b.l, Math.abs(b.h-c[i-1].c), Math.abs(b.l-c[i-1].c)));
  let a = 0; for(let i=1;i<=p;i++) a += tr[i]; a /= p; out[p] = a;
  for(let i=p+1;i<c.length;i++){ a = (a*(p-1)+tr[i])/p; out[i] = a; }
  return out;
}
const lastVal = arr => { for(let i=arr.length-1;i>=0;i--) if(arr[i]!=null) return arr[i]; return null; };
function isPH(c,p,L,R){ for(let j=1;j<=L;j++) if(c[p-j].h >= c[p].h) return false; for(let j=1;j<=R;j++) if(c[p+j].h > c[p].h) return false; return true; }
function isPL(c,p,L,R){ for(let j=1;j<=L;j++) if(c[p-j].l <= c[p].l) return false; for(let j=1;j<=R;j++) if(c[p+j].l < c[p].l) return false; return true; }

// Struktur SMC: BOS/CHoCH, Order Block, FVG, sweep
function structure(c, L=3){
  let trend=0, swH=null, swL=null, hB=true, lB=true;
  let bullOB=null, bearOB=null, bullFVG=null, bearFVG=null;
  const events=[], pivH=[], pivL=[];
  for(let k=2*L;k<c.length;k++){
    const p = k-L;
    if(isPH(c,p,L,L)){ swH={p:c[p].h,i:p}; hB=false; pivH.push({p:c[p].h,i:p,conf:k}); }
    if(isPL(c,p,L,L)){ swL={p:c[p].l,i:p}; lB=false; pivL.push({p:c[p].l,i:p,conf:k}); }
    if(bullOB  && c[k].c < bullOB.bot)  bullOB=null;
    if(bearOB  && c[k].c > bearOB.top)  bearOB=null;
    if(bullFVG && c[k].c < bullFVG.bot) bullFVG=null;
    if(bearFVG && c[k].c > bearFVG.top) bearFVG=null;
    if(!hB && swH && c[k].c > swH.p){
      hB=true; const ch = trend===-1; trend=1;
      events.push({i:k,dir:1,type:ch?'CHoCH':'BOS',lvl:swH.p});
      for(let j=k-1;j>=Math.max(0,k-15);j--) if(c[j].c < c[j].o){ bullOB={top:c[j].h,bot:c[j].l,i:j}; break; }
    }
    if(!lB && swL && c[k].c < swL.p){
      lB=true; const ch = trend===1; trend=-1;
      events.push({i:k,dir:-1,type:ch?'CHoCH':'BOS',lvl:swL.p});
      for(let j=k-1;j>=Math.max(0,k-15);j--) if(c[j].c > c[j].o){ bearOB={top:c[j].h,bot:c[j].l,i:j}; break; }
    }
    if(k>=2){
      if(c[k].l > c[k-2].h) bullFVG={top:c[k].l,bot:c[k-2].h,i:k};
      if(c[k].h < c[k-2].l) bearFVG={top:c[k-2].l,bot:c[k].h,i:k};
    }
  }
  return {trend, swH, swL, events, bullOB, bearOB, bullFVG, bearFVG, pivH, pivL};
}

// Sweep: bar dalam N terakhir menembusi swing (yang sudah disahkan sebelumnya) dan tutup balik
function recentSweep(c, st, N=12){
  const n=c.length; let bull=null, bear=null;
  for(let k=Math.max(0,n-N);k<n;k++){
    const lows = st.pivL.filter(q=>q.conf<k).slice(-3), highs = st.pivH.filter(q=>q.conf<k).slice(-3);
    for(const q of lows)  if(c[k].l < q.p && c[k].c > q.p) bull={i:k,lvl:q.p,ext:c[k].l};
    for(const q of highs) if(c[k].h > q.p && c[k].c < q.p) bear={i:k,lvl:q.p,ext:c[k].h};
  }
  return {bull, bear};
}

function tfDirection(c){
  if(c.length < 60) return {dir:0, s:0, e:0};
  const st = structure(c,3);
  const closes = c.map(b=>b.c), e20 = lastVal(ema(closes,20)), e50 = lastVal(ema(closes,50));
  const e = e20>e50 ? 1 : e20<e50 ? -1 : 0;
  return {dir: st.trend===e ? e : 0, s: st.trend, e, st};
}

// Zon Supply/Demand (port kod zon EA: pivot + base, tinggi dihad ATR)
function buildZones(c){
  const a = atrArr(c,14), sup=[], dem=[];
  const L=4, R=4, B=10, MINH=0.42, MAXH=1.15, SAME=0.38, CONF=0.22, MAXN=3;
  const overlap=(arr,top,bot,tolA)=>arr.some(z=> (bot<=z.top+tolA && top>=z.bot-tolA) || Math.abs((top+bot)/2-(z.top+z.bot)/2)<=tolA);
  for(let k=B+L+R+2;k<c.length;k++){
    const at=a[k]; if(!at) continue;
    for(let z=sup.length-1;z>=0;z--){ if(c[k].c>sup[z].top){ sup.splice(z,1); continue; } if(c[k].h>=sup[z].bot && c[k].l<=sup[z].top) sup[z].touch=k; }
    for(let z=dem.length-1;z>=0;z--){ if(c[k].c<dem[z].bot){ dem.splice(z,1); continue; } if(c[k].h>=dem[z].bot && c[k].l<=dem[z].top) dem[z].touch=k; }
    const p=k-R;
    const add=(isSup)=>{
      let wH=-Infinity,wL=Infinity,bH=-Infinity,bL=Infinity;
      for(let j=p-B+1;j<=p;j++){ wH=Math.max(wH,c[j].h); wL=Math.min(wL,c[j].l); bH=Math.max(bH,c[j].o,c[j].c); bL=Math.min(bL,c[j].o,c[j].c); }
      let top = isSup ? wH : bH, bot = isSup ? bL : wL;
      const mid=(top+bot)/2;
      if(top-bot < at*MINH){ top=mid+at*MINH/2; bot=mid-at*MINH/2; }
      if(top-bot > at*MAXH){ if(isSup) bot=top-at*MAXH; else top=bot+at*MAXH; }
      let react=0;
      if(isSup){ let lo=Infinity; for(let j=p+1;j<=k;j++) lo=Math.min(lo,c[j].l); react=(c[p].h-lo)/at; }
      else     { let hi=-Infinity; for(let j=p+1;j<=k;j++) hi=Math.max(hi,c[j].h); react=(hi-c[p].l)/at; }
      const same = isSup?sup:dem, other = isSup?dem:sup;
      if(same.some(z=> (bot<=z.top && top>=z.bot) || Math.abs(mid-(z.top+z.bot)/2)<=at*SAME)) return;
      if(overlap(other,top,bot,at*CONF)) return;
      same.push({top,bot,react,start:p,touch:p,t:c[p].t,kind:isSup?'Supply':'Demand'});
      while(same.length>MAXN) same.shift();
    };
    if(isPH(c,p,L,R)) add(true);
    if(isPL(c,p,L,R)) add(false);
  }
  const grade = r => r>=2 ? 'STRONG' : r>=1.2 ? 'MID' : 'BASE';
  sup.forEach(z=>z.grade=grade(z.react)); dem.forEach(z=>z.grade=grade(z.react));
  return {sup, dem};
}

// Julat dagangan H1 untuk premium/discount
function dealingRange(c, price){
  const st = structure(c,3);
  let hi = st.pivH.length ? st.pivH[st.pivH.length-1].p : Math.max(...c.slice(-50).map(b=>b.h));
  let lo = st.pivL.length ? st.pivL[st.pivL.length-1].p : Math.min(...c.slice(-50).map(b=>b.l));
  if(hi <= lo){ hi = Math.max(...c.slice(-50).map(b=>b.h)); lo = Math.min(...c.slice(-50).map(b=>b.l)); }
  hi = Math.max(hi, price); lo = Math.min(lo, price);
  const eq=(hi+lo)/2, pos = hi>lo ? (price-lo)/(hi-lo) : 0.5;
  return {hi, lo, eq, pos, zone: pos>0.5 ? 'Premium' : pos<0.5 ? 'Discount' : 'EQ'};
}

const weekKey = t => { const d=new Date(t*1000); const day=(d.getUTCDay()+6)%7; return Math.floor((t - day*86400)/86400); };

// Paras liquidity: PDH/PDL/PWH/PWL dengan status hari ini
function liquidity(d1, m5, nowSec){
  const out=[];
  const todayStart = Math.floor(nowSec/86400)*86400;
  // Hujung minggu / cuti: "hari ini" = hari dagangan terakhir yang ada data
  let sessStart = todayStart;
  if(!m5.some(b=>b.t>=todayStart) && m5.length) sessStart = Math.floor(m5[m5.length-1].t/86400)*86400;
  const closedDays = d1.filter(b=>b.t < sessStart);
  if(!closedDays.length) return out;
  const pd = closedDays[closedDays.length-1];
  const curW = weekKey(sessStart), weeks = new Map();
  for(const b of d1){ const k=weekKey(b.t); if(k>=curW) continue; const w=weeks.get(k)||{h:-Infinity,l:Infinity}; w.h=Math.max(w.h,b.h); w.l=Math.min(w.l,b.l); weeks.set(k,w); }
  const wk = [...weeks.keys()].sort((a,b)=>a-b), pw = wk.length ? weeks.get(wk[wk.length-1]) : null;
  const today = m5.filter(b=>b.t>=sessStart), last = m5[m5.length-1];
  const lv = [{name:'Previous day high',k:'PDH',p:pd.h,side:1},{name:'Previous day low',k:'PDL',p:pd.l,side:-1}];
  if(pw){ lv.push({name:'Previous week high',k:'PWH',p:pw.h,side:1},{name:'Previous week low',k:'PWL',p:pw.l,side:-1}); }
  for(const L of lv){
    const first = today.find(b => L.side>0 ? b.h > L.p : b.l < L.p);
    let status='Belum diambil', cls='';
    if(first && last){
      const beyond = L.side>0 ? last.c > L.p : last.c < L.p;
      status = beyond ? 'Acceptance' : 'Rejection'; cls = beyond ? 'acc' : 'rej';
    }
    out.push({...L, taken:!!first, firstT:first?first.t:null, status, cls, dist: last ? last.c - L.p : 0});
  }
  return out;
}

// Gabungan analisis + penilaian signal
function analyze(D, nowSec){
  const m5=D.M5, m15=D.M15, h1=D.H1, h4=D.H4, d1=D.D1;
  const price = m5[m5.length-1].c;
  const dir = {H4: tfDirection(h4), H1: tfDirection(h1), M15: tfDirection(m15)};
  const st5 = structure(m5,3), sw5 = recentSweep(m5, st5, 12);
  const atr5 = lastVal(atrArr(m5,14)), atr15 = lastVal(atrArr(m15,14));
  const range = dealingRange(h1, price);
  const liq = liquidity(d1, m5, nowSec);
  const zones = buildZones(m15);
  const n5 = m5.length;
  const lastEv = st5.events[st5.events.length-1] || null;
  const recentEv = d => st5.events.filter(e=>e.dir===d && n5-1-e.i < 12).pop() || null;

  // Regime M15 berbanding arah H1
  let regime='Ranging';
  const h1d = dir.H1.dir, m15st = dir.M15.st;
  if(h1d!==0 && m15st){
    const ev = m15st.events[m15st.events.length-1];
    if(m15st.trend===h1d) regime='Continuation';
    else if(ev && ev.type==='CHoCH' && ev.dir===-h1d) regime='Reversal (awal)';
    else regime='Retracement';
  }

  // POI berhampiran harga
  const near = (top,bot) => price <= top + atr15 && price >= bot - atr15;
  const poi = [];
  zones.dem.forEach(z=>poi.push({type:'Demand M15',dir:1,top:z.top,bot:z.bot,grade:z.grade}));
  zones.sup.forEach(z=>poi.push({type:'Supply M15',dir:-1,top:z.top,bot:z.bot,grade:z.grade}));
  if(st5.bullOB)  poi.push({type:'Bullish OB M5',dir:1,top:st5.bullOB.top,bot:st5.bullOB.bot,grade:'—'});
  if(st5.bearOB)  poi.push({type:'Bearish OB M5',dir:-1,top:st5.bearOB.top,bot:st5.bearOB.bot,grade:'—'});
  if(st5.bullFVG) poi.push({type:'Bullish FVG M5',dir:1,top:st5.bullFVG.top,bot:st5.bullFVG.bot,grade:'—'});
  if(st5.bearFVG) poi.push({type:'Bearish FVG M5',dir:-1,top:st5.bearFVG.top,bot:st5.bearFVG.bot,grade:'—'});
  poi.forEach(p=>{ p.near = near(p.top,p.bot); p.dist = price > p.top ? price-p.top : price < p.bot ? price-p.bot : 0; });

  const liqRej = s => liq.some(L=>L.side===s && L.status==='Rejection');
  const mk = (d)=>{
    const s = d; // 1 buy, -1 sell
    const ev = recentEv(d), sweep = d>0 ? sw5.bull : sw5.bear;
    const checks = [
      {k:'H4 tidak menentang', ok: dir.H4.dir !== -d, opt:true},
      {k: d>0 ? 'Trend H1 naik' : 'Trend H1 turun', ok: dir.H1.dir === d},
      {k: d>0 ? 'Harga di Discount (bawah EQ)' : 'Harga di Premium (atas EQ)', ok: d>0 ? price < range.eq : price > range.eq},
      {k: d>0 ? 'Liquidity bawah diambil + rejection' : 'Liquidity atas diambil + rejection', ok: liqRej(-d) || !!sweep},
      {k: d>0 ? 'M5 CHoCH/BOS naik (12 bar)' : 'M5 CHoCH/BOS turun (12 bar)', ok: !!ev},
      {k: d>0 ? 'POI bullish dekat harga' : 'POI bearish dekat harga', ok: poi.some(p=>p.dir===d && p.near)}
    ];
    const req = checks[1].ok && checks[2].ok && checks[4].ok && (checks[3].ok || checks[5].ok);
    const score = checks.filter(x=>x.ok).length;
    let plan=null;
    if(req && atr5 && atr15){
      const entry = price;
      const swingExt = d>0 ? Math.min(...m5.slice(-12).map(b=>b.l)) : Math.max(...m5.slice(-12).map(b=>b.h));
      let sl = d>0 ? Math.min(swingExt, sweep?sweep.ext:Infinity) - 0.2*atr5 : Math.max(swingExt, sweep?sweep.ext:-Infinity) + 0.2*atr5;
      let risk = Math.abs(entry-sl);
      risk = Math.min(Math.max(risk, 0.5*atr15), 3*atr15);
      sl = entry - d*risk;
      const tp1 = entry + d*risk;
      const cands = [...liq.map(L=>L.p), range.hi, range.lo, ...(d>0?zones.sup.map(z=>z.bot):zones.dem.map(z=>z.top))]
        .filter(x => d>0 ? (x >= entry + 1.5*risk && x <= entry + 4*risk) : (x <= entry - 1.5*risk && x >= entry - 4*risk))
        .sort((a,b)=> d>0 ? a-b : b-a);
      const tp2 = cands.length ? cands[0] : entry + d*2*risk;
      plan = {entry, sl, tp1, tp2, rr: Math.abs(tp2-entry)/risk, poi: poi.find(p=>p.dir===d && p.near) || null};
    }
    return {checks, req, score, grade: req ? (checks[0].ok && checks[3].ok && checks[5].ok ? 'A+' : 'A') : null, plan};
  };
  const buy = mk(1), sell = mk(-1);
  let status='WAIT', side=null;
  if(buy.req && !sell.req) { status='BUY'; side=buy; }
  else if(sell.req && !buy.req) { status='SELL'; side=sell; }
  else if(buy.req && sell.req) { status='WAIT'; }
  return {price, dir, regime, range, liq, zones, poi, st5, lastEv, buy, sell, status, side, atr5, atr15};
}
// ===== Logik EA (preset 20252026.set) =====
const EA_CFG = {swing:3, smcBars:300, atrP:5, fastEMA:5, slowEMA:13, minBodyATR:0.6, minBodyRatio:0.5, minTrig:1,
  useMom:true, useBOS:true, useFVG:true, slATR:3.0, maxSLATR:6.0, slStruct:true, slBuf:0.2,
  tp1R:3.0, tp2R:4.0, partial:0.9, beR:0.1, trailATR:1.5};

function eaClose(p, px, t, why, cfg){
  const r = (px - p.entry) * p.dir / p.risk;
  p.R = p.tp1Hit ? cfg.partial*cfg.tp1R + (1-cfg.partial)*r : r;
  p.closed = true; p.exit = px; p.exitT = t; p.res = why;
}
function eaManage(p, b, atr, cfg){
  const d = p.dir;
  if(d>0 ? b.l <= p.sl : b.h >= p.sl){ eaClose(p, p.sl, b.t, p.tp1Hit ? 'Trailing/BE' : 'SL', cfg); return; }
  if(!p.tp1Hit && (d>0 ? b.h >= p.tp1 : b.l <= p.tp1)){ p.tp1Hit = true; p.sl = p.entry + d*p.risk*cfg.beR; }
  if(d>0 ? b.h >= p.tp2 : b.l <= p.tp2){ eaClose(p, p.tp2, b.t, 'TP2', cfg); return; }
  if(p.tp1Hit && atr){ const nsl = b.c - d*atr*cfg.trailATR; if(d>0 ? (nsl>p.sl && nsl>p.entry) : (nsl<p.sl && nsl<p.entry)) p.sl = nsl; }
}
// Jalankan logik EA bar demi bar. Signal terbaru sentiasa dipaparkan.
// Simulasi: signal bertentangan menutup trade semasa dan membuka arah baru (pusing arah).
function eaSim(m5, m15, cfg=EA_CFG){
  const n = m5.length, closes = m5.map(b=>b.c);
  const ef = ema(closes,cfg.fastEMA), es = ema(closes,cfg.slowEMA), at = atrArr(m5,cfg.atrP);
  const trades=[], signals=[]; let pos=null;
  const planFor = (i, d, st) => {
    const b = m5[i], atr = at[i], price = b.c, zn = buildZones(m15.filter(z => z.t + 900 <= b.t + 300));
    let supLvl = null, opp = 0;
    if(d>0){ let best=-Infinity; zn.dem.forEach(z=>{ if(z.bot<price && z.top>best){ best=z.top; supLvl=z.bot; } });
             const ups = zn.sup.filter(z=>z.bot>price).map(z=>z.bot); if(ups.length) opp = Math.min(...ups); }
    else   { let best=Infinity; zn.sup.forEach(z=>{ if(z.top>price && z.bot<best){ best=z.bot; supLvl=z.top; } });
             const dns = zn.dem.filter(z=>z.top<price).map(z=>z.top); if(dns.length) opp = Math.max(...dns); }
    let sl = price - d*atr*cfg.slATR;
    if(cfg.slStruct){
      const g = atr*0.5; let lvl = null;
      const cands = d>0 ? [st.swL&&st.swL.p, st.bullOB&&st.bullOB.bot, supLvl] : [st.swH&&st.swH.p, st.bearOB&&st.bearOB.top, supLvl];
      for(const c of cands){ if(c==null) continue; if(d>0 ? c < price-g : c > price+g) lvl = lvl==null ? c : (d>0 ? Math.max(lvl,c) : Math.min(lvl,c)); }
      if(lvl!=null) sl = lvl - d*atr*cfg.slBuf;
    }
    if(Math.abs(price-sl) > atr*cfg.maxSLATR) sl = price - d*atr*cfg.maxSLATR;
    const risk = Math.abs(price-sl), tp1 = price + d*risk*cfg.tp1R;
    let tp2 = price + d*risk*cfg.tp2R;
    if(opp){ const cap = opp - d*atr*0.1; if(d>0 ? (cap<tp2 && cap>tp1) : (cap>tp2 && cap<tp1)) tp2 = cap; }
    return {t:b.t, dir:d, entry:price, sl, sl0:sl, tp1, tp2, risk, tp1Hit:false, closed:false, R:0};
  };
  let lastSt = null;
  for(let i=Math.max(cfg.smcBars,30); i<n; i++){
    const b = m5[i], atr = at[i];
    if(pos){ eaManage(pos, b, atr, cfg); if(pos.closed){ trades.push(pos); pos=null; } }
    if(!atr || ef[i]==null || es[i]==null) continue;
    const w = m5.slice(i-cfg.smcBars+1, i+1), st = structure(w, cfg.swing), last = w.length-1;
    const lastE = st.events[st.events.length-1], ev = lastE && lastE.i===last ? lastE : null;
    const body = Math.abs(b.c-b.o), range = b.h-b.l;
    const big = body >= atr*cfg.minBodyATR && range > 0 && body/range >= cfg.minBodyRatio;
    const momB = big && b.c>b.o && ef[i]>es[i], momS = big && b.c<b.o && ef[i]<es[i];
    const fB = st.bullFVG && st.bullFVG.i < last-1 && b.l <= st.bullFVG.top && b.c > st.bullFVG.bot && b.c > b.o;
    const fS = st.bearFVG && st.bearFVG.i < last-1 && b.h >= st.bearFVG.bot && b.c < st.bearFVG.top && b.c < b.o;
    const tb=[], ts=[];
    if(cfg.useMom && momB) tb.push('Momentum'); if(cfg.useBOS && ev && ev.dir===1) tb.push(ev.type); if(cfg.useFVG && fB) tb.push('FVG');
    if(cfg.useMom && momS) ts.push('Momentum'); if(cfg.useBOS && ev && ev.dir===-1) ts.push(ev.type); if(cfg.useFVG && fS) ts.push('FVG');
    let buy = tb.length >= cfg.minTrig, sell = ts.length >= cfg.minTrig;
    if(buy && sell){ if(tb.length===ts.length) continue; if(tb.length>ts.length) sell=false; else buy=false; }
    if(!buy && !sell) continue;
    const d = buy ? 1 : -1, sig = {t:b.t, i, dir:d, trig:(buy?tb:ts).join(' '), st};
    signals.push(sig);
    if(pos && pos.dir !== d){ eaClose(pos, b.c, b.t, 'Pusing arah', cfg); trades.push(pos); pos=null; }
    if(!pos){ pos = planFor(i, d, st); pos.trig = sig.trig; sig.plan = pos; }
  }
  const latest = signals[signals.length-1] || null;
  if(latest && !latest.plan){ latest.plan = planFor(latest.i, latest.dir, latest.st); latest.plan.trig = latest.trig; }
  signals.forEach(x=>{ delete x.st; });
  const lastT = n ? m5[n-1].t : 0, fresh = latest && latest.t === lastT ? latest : null;
  const s0 = m5[Math.max(cfg.smcBars,30)];
  return {trades, pos, signals, latest, fresh, lastT, from: s0 ? s0.t : lastT};
}
if(typeof module!=='undefined') module.exports={analyze,structure,buildZones,liquidity,dealingRange,tfDirection,eaSim,TFSEC};
