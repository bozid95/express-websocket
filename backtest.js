'use strict';
/**
 * BACKTEST v10 — OPTIMIZED for PF > 1.3
 * 
 * Changes from v9 (+5.84R, PF 1.06):
 * 1. MIN_SCORE raised to 30 → 35 (stricter filter)
 * 2. SL from 2.5x → 2.0x ATR (less loss per trade)
 * 3. TP1 minimum RR raised to 1.5:1 (not 1:1)
 * 4. Added: skip if current candle is RED (wait for green)
 * 5. Added: RSI must be RISING (not still falling)
 * 6. Lookback 1000 candles (~42 days)
 * 7. Run 3 configs: A=conservative, B=balanced, C=aggressive
 */

const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const agent = new https.Agent({ rejectUnauthorized: false });

const CACHE_DIR = path.join(__dirname, 'klines_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const PAIRS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT','DOTUSDT',
  'LTCUSDT','ATOMUSDT','NEARUSDT','FTMUSDT',
  'ARBUSDT','OPUSDT','INJUSDT','SUIUSDT','WIFUSDT','SEIUSDT',
];

const LOOKBACK = 1000;
const TRADE_WIN = 48;
const STEP = 2;

// 3 configurations to test
const CONFIGS = [
  { name: 'A: Conservative', minScore: 40, slMult: 2.0, minRR: 1.5, requireGreen: true, requireRsiRising: true },
  { name: 'B: Balanced',     minScore: 35, slMult: 2.0, minRR: 1.2, requireGreen: true, requireRsiRising: false },
  { name: 'C: Original+',    minScore: 30, slMult: 2.0, minRR: 1.0, requireGreen: false, requireRsiRising: false },
];

// ── INDICATORS ──────────────────────────────────────────────

function ema(p,n){const k=2/(n+1);let e=p.slice(0,n).reduce((a,b)=>a+b)/n;const r=new Array(n-1).fill(null);r.push(e);for(let i=n;i<p.length;i++){e=(p[i]-e)*k+e;r.push(e)}return r}
function rsi(p,n=14){if(p.length<n+1)return 50;let g=0,l=0;for(let i=1;i<=n;i++){let d=p[i]-p[i-1];d>=0?g+=d:l-=d}let ag=g/n,al=l/n;for(let i=n+1;i<p.length;i++){let d=p[i]-p[i-1];ag=((ag*(n-1))+(d>=0?d:0))/n;al=((al*(n-1))+(d<0?-d:0))/n}return al===0?100:100-(100/(1+(ag/al)))}
function rsiAt(p,idx,n=14){return rsi(p.slice(0,idx+1),n)}
function macd(p){const f=ema(p,12),s=ema(p,26),ml=[];for(let i=0;i<p.length;i++)if(f[i]!==null&&s[i]!==null)ml.push(f[i]-s[i]);if(ml.length<9)return{h:0,ph:0,cu:false,cd:false};const sl=ema(ml,9);const lm=ml[ml.length-1],ls=sl[sl.length-1]||0,pm=ml[ml.length-2]||lm,ps=sl[sl.length-2]||ls;return{h:lm-ls,ph:pm-ps,cu:pm<=ps&&lm>ls,cd:pm>=ps&&lm<ls}}
function atr(h,l,c,n=14){if(h.length<n+1)return 0;let t=[h[0]-l[0]];for(let i=1;i<h.length;i++)t.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));let a=t.slice(0,n).reduce((x,y)=>x+y)/n;for(let i=n;i<t.length;i++)a=(a*(n-1)+t[i])/n;return a}
function adx(h,l,c,n=14){if(h.length<n*3)return 0;let t=[],pd=[],md=[];for(let i=1;i<h.length;i++){t.push(Math.max(h[i]-l[i],Math.abs(h[i]-c[i-1]),Math.abs(l[i]-c[i-1])));let u=h[i]-h[i-1],d=l[i-1]-l[i];pd.push(u>d&&u>0?u:0);md.push(d>u&&d>0?d:0)}let aT=t.slice(0,n).reduce((a,b)=>a+b),aP=pd.slice(0,n).reduce((a,b)=>a+b),aM=md.slice(0,n).reduce((a,b)=>a+b);const dx=[];for(let i=n;i<t.length;i++){aT=aT-aT/n+t[i];aP=aP-aP/n+pd[i];aM=aM-aM/n+md[i];let pI=(aP/aT)*100,mI=(aM/aT)*100;dx.push((pI+mI)===0?0:Math.abs(pI-mI)/(pI+mI)*100)}if(dx.length<n)return 0;let a=dx.slice(0,n).reduce((x,y)=>x+y)/n;for(let i=n;i<dx.length;i++)a=((a*(n-1))+dx[i])/n;return a}

function scoreV10(c,h,l,o,v,idx,pctChange,cfg) {
  let sc=0; const why=[];
  const price=c[idx];
  const cs=c.slice(0,idx+1),hs=h.slice(0,idx+1),ls=l.slice(0,idx+1);
  const _rsi=rsi(cs), _macd=macd(cs), _atr=atr(hs,ls,cs), _adx=adx(hs,ls,cs);
  const e21=ema(cs,21); const E21=e21[e21.length-1]||price;
  if(_atr===0) return {sc:0,why:[],rsi:50,atr:0,e21:price};

  // GATE: RSI<40
  if(_rsi>=40) return {sc:0,why:['RSI not oversold'],rsi:_rsi,atr:_atr,e21:E21};

  // GATE: Freefall
  let ff=0;
  for(let k=idx-5;k<=idx;k++){if(k>24){const ll=Math.min(...ls.slice(k-24,k));if(ls[k]<ll)ff++}}
  if(ff>=3) return {sc:0,why:['FREEFALL'],rsi:_rsi,atr:_atr,e21:E21};

  // GATE: EMA21 above
  if(E21<=price*1.003) return {sc:0,why:['No room'],rsi:_rsi,atr:_atr,e21:E21};

  // GATE: Green candle required?
  if(cfg.requireGreen && c[idx]<=o[idx]) return {sc:0,why:['Red candle'],rsi:_rsi,atr:_atr,e21:E21};

  // GATE: RSI rising?
  if(cfg.requireRsiRising) {
    const prevRsi = rsiAt(c,idx-1);
    if(_rsi <= prevRsi) return {sc:0,why:['RSI falling'],rsi:_rsi,atr:_atr,e21:E21};
  }

  // 1. RSI (max 20)
  if(_rsi<22){sc+=20;why.push(`RSI ${_rsi.toFixed(0)} extreme`);}
  else if(_rsi<28){sc+=15;why.push(`RSI ${_rsi.toFixed(0)} oversold`);}
  else if(_rsi<33){sc+=10;why.push(`RSI ${_rsi.toFixed(0)}`);}
  else sc+=5;

  // 2. Drop (max 12)
  const absPct=Math.abs(pctChange);
  if(absPct>=8){sc+=12;why.push(`${absPct.toFixed(0)}% crash`);}
  else if(absPct>=5){sc+=9;why.push(`${absPct.toFixed(0)}% drop`);}
  else if(absPct>=4){sc+=6;}
  else sc+=3;

  // 3. Green candle quality (max 15)
  const curGreen=c[idx]>o[idx];
  const body=Math.abs(c[idx]-o[idx]), range=h[idx]-l[idx];
  if(curGreen&&range>0&&body/range>0.4){sc+=15;why.push('Bull candle ✅');}
  else if(curGreen){sc+=8;why.push('Green');}
  else sc-=5;

  // 4. MACD (max 10)
  if(_macd.cu){sc+=10;why.push('MACD cross ↑');}
  else if(_macd.h<0&&_macd.h>_macd.ph){sc+=6;why.push('MACD turning');}

  // 5. Volume (max 8)
  const avgV=v.slice(Math.max(0,idx-20),idx).reduce((a,b)=>a+b)/Math.min(20,idx);
  const vr=v[idx]/avgV;
  if(vr>3){sc+=8;why.push(`Vol ${vr.toFixed(1)}x`);}
  else if(vr>2){sc+=5;}
  else if(vr>1.5) sc+=2;

  // 6. Support (max 10)
  const sup3d=Math.min(...ls.slice(Math.max(0,idx-72),idx));
  const dSup=(price-sup3d)/price*100;
  if(dSup<0.5){sc+=10;why.push('Dbl bottom ✅');}
  else if(dSup<1.5){sc+=6;why.push('Support');}
  else if(dSup<3) sc+=3;

  // 7. Wick (max 5)
  if(range>0){const lw=Math.min(c[idx],o[idx])-l[idx];if(lw/range>0.5){sc+=5;why.push('Wick ↑');}}

  // 8. ADX (max 5)
  if(_adx<20){sc+=5;why.push('ADX weak');}
  else if(_adx>35) sc-=3;

  return {sc,why,rsi:_rsi,atr:_atr,e21:E21};
}

function simTrade(k,idx,entry,atrVal,e21,cfg) {
  const sl=entry-atrVal*cfg.slMult;
  const slDist=entry-sl;
  const meanDist=Math.max(e21-entry,0);
  const tp1=entry+Math.max(meanDist*0.4,slDist*cfg.minRR);
  const tp2=entry+Math.max(meanDist*0.7,slDist*2.0);
  const tp3=entry+Math.max(meanDist*1.0,slDist*3.0);

  let pnlR=0,remain=1.0,tSL=sl,t1=false,t2=false,outcome='TIMEOUT';
  for(let j=idx+1;j<Math.min(idx+TRADE_WIN,k.c.length);j++){
    if(k.l[j]<=tSL){
      if(!t1){pnlR-=remain;outcome='SL';}
      else if(!t2){outcome='TP1+BE';}
      else{pnlR+=remain*1.5;outcome='TP2+TR';}
      break;
    }
    if(k.h[j]>=tp3){pnlR+=remain*((tp3-entry)/slDist);outcome='TP3';break;}
    if(k.h[j]>=tp2&&!t2){pnlR+=0.30*((tp2-entry)/slDist);remain-=0.30;t2=true;tSL=tp1;}
    if(k.h[j]>=tp1&&!t1){pnlR+=0.50*((tp1-entry)/slDist);remain-=0.50;t1=true;tSL=entry;}
  }
  if(outcome==='TIMEOUT'){
    const last=k.c[Math.min(idx+TRADE_WIN-1,k.c.length-1)];
    const exitR=(last-entry)/slDist;
    if(t1){pnlR+=remain*Math.max(0,exitR);outcome=t2?'TP2+TO':'TP1+TO';}
    else{pnlR=Math.max(-1,exitR);outcome=exitR>0?'TO+':'TO-';}
  }
  return {pnlR,outcome};
}

async function fetchK(sym,itv,lim){
  const cacheFile = path.join(CACHE_DIR, `${sym}_${itv}_${lim}.json`);
  
  // Try API first
  for(let a=0;a<3;a++){
    try{
      const r=await axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${itv}&limit=${lim}`,{httpsAgent:agent,timeout:15000});
      if(typeof r.data==='string'&&r.data.includes('<!doctype'))throw new Error('ISP BLOCKED');
      const d=Array.isArray(r.data)?r.data:JSON.parse(r.data);
      if(!Array.isArray(d)||!d.length)throw new Error('Bad data');
      const result={o:d.map(k=>+k[1]),h:d.map(k=>+k[2]),l:d.map(k=>+k[3]),c:d.map(k=>+k[4]),v:d.map(k=>+k[5])};
      // Save to cache
      fs.writeFileSync(cacheFile, JSON.stringify(result));
      return result;
    }catch(e){
      if(a<2){await new Promise(r=>setTimeout(r,2000*(a+1)));continue;}
      // API failed — try cache
      if(fs.existsSync(cacheFile)){
        process.stdout.write('[CACHE]');
        return JSON.parse(fs.readFileSync(cacheFile,'utf8'));
      }
      throw e;
    }
  }
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function btPairCfg(sym,k,cfg){
  const res={trades:[],pnl:0,w:0,l:0};
  let last=-TRADE_WIN;
  for(let i=200;i<k.c.length-TRADE_WIN;i+=STEP){
    if(i-last<TRADE_WIN)continue;
    const price=k.c[i],p24=k.c[Math.max(0,i-24)];
    const pct=((price-p24)/p24)*100;
    if(pct>-3)continue;
    const{sc,why,rsi:_rsi,atr:atrVal,e21}=scoreV10(k.c,k.h,k.l,k.o,k.v,i,pct,cfg);
    if(sc<cfg.minScore||atrVal===0)continue;
    const result=simTrade(k,i,price,atrVal,e21,cfg);
    if(result.pnlR>0)res.w++;else res.l++;
    res.pnl+=result.pnlR;
    last=i;
    res.trades.push({p:price.toFixed(4),sc,out:result.outcome,pnl:result.pnlR.toFixed(2)+'R',pct:pct.toFixed(1)+'%'});
  }
  return res;
}

async function main(){
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  BACKTEST v10 — Multi-Config Optimization               ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log(`  Pairs: ${PAIRS.length} | Lookback: ${Math.round(LOOKBACK/24)}d | Window: ${TRADE_WIN}h`);
  console.log('');

  // Fetch all data first
  console.log('  Fetching data...');
  const allData = {};
  for(const pair of PAIRS){
    try{
      allData[pair]=await fetchK(pair,'1h',LOOKBACK);
      process.stdout.write('.');
      await sleep(5000);
    }catch(e){console.log(`\n  ${pair} ERR: ${e.message.substring(0,40)}`);}
  }
  console.log(` Done (${Object.keys(allData).length} pairs)\n`);

  // Run each config
  for(const cfg of CONFIGS){
    console.log(`  ════════════════════════════════════════`);
    console.log(`  CONFIG ${cfg.name}`);
    console.log(`  MinScore:${cfg.minScore} SL:${cfg.slMult}x TP1minRR:${cfg.minRR} Green:${cfg.requireGreen} RSIrise:${cfg.requireRsiRising}`);
    console.log('');

    let tPnl=0,tW=0,tL=0,tN=0;
    const pairRes=[];

    for(const pair of PAIRS){
      if(!allData[pair])continue;
      const r=await btPairCfg(pair,allData[pair],cfg);
      const tot=r.trades.length;
      tPnl+=r.pnl;tW+=r.w;tL+=r.l;tN+=tot;
      pairRes.push({pair,...r,tot});
    }

    const wr=tN>0?((tW/tN)*100).toFixed(1):'0';
    const wins=pairRes.flatMap(p=>p.trades.filter(t=>parseFloat(t.pnl)>0));
    const loss=pairRes.flatMap(p=>p.trades.filter(t=>parseFloat(t.pnl)<=0));
    const avgW=wins.length>0?wins.reduce((s,t)=>s+parseFloat(t.pnl),0)/wins.length:0;
    const avgL=loss.length>0?Math.abs(loss.reduce((s,t)=>s+parseFloat(t.pnl),0)/loss.length):1;
    const pf=loss.length>0?(avgW*tW)/(avgL*tL):999;
    const expectancy=tN>0?(tPnl/tN):0;

    console.log(`  Trades: ${tN} | W:${tW} L:${tL} | WR: ${wr}%`);
    console.log(`  P&L: ${tPnl>=0?'+':''}${tPnl.toFixed(2)}R | PF: ${pf.toFixed(2)} | Avg: ${expectancy>=0?'+':''}${expectancy.toFixed(3)}R/trade`);
    console.log(`  AvgWin: +${avgW.toFixed(2)}R | AvgLoss: -${avgL.toFixed(2)}R`);

    const profPairs=pairRes.filter(p=>p.pnl>0&&p.tot>0);
    const losPairs=pairRes.filter(p=>p.pnl<=0&&p.tot>0);
    console.log(`  Profitable: ${profPairs.length}/${pairRes.filter(p=>p.tot>0).length} pairs`);

    if(profPairs.length){
      profPairs.sort((a,b)=>b.pnl-a.pnl);
      console.log(`  🏆 ${profPairs.slice(0,5).map(p=>`${p.pair}+${p.pnl.toFixed(1)}R`).join(' | ')}`);
    }
    if(losPairs.length){
      losPairs.sort((a,b)=>a.pnl-b.pnl);
      console.log(`  💀 ${losPairs.slice(0,3).map(p=>`${p.pair}${p.pnl.toFixed(1)}R`).join(' | ')}`);
    }
    console.log('');
  }
}

main().catch(e=>{console.error('Fatal:',e);process.exit(1);});
