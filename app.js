/**
 * CRYPTO SIGNAL MASTER - VANILLA JS PORT
 * Includes: Indicators, Signal Logic, ML Logic, and UI Controller
 */

/* ================= IMPORTS & FIREBASE SETUP ================= */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBV0B_6jo8opd9dmcg9SoXNcYJKSesXlrs",
  authDomain: "trainai-1b085.firebaseapp.com",
  projectId: "trainai-1b085",
  storageBucket: "trainai-1b085.firebasestorage.app",
  messagingSenderId: "735674489344",
  appId: "1:735674489344:web:ebd3b2feb3010f16ff56e5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const MODEL_DOC_ID = "global_v1";

/* ================= TYPES & CONSTANTS ================= */
const ALLOWED_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];

/* ================= 1. INDICATORS (from indicators.ts) ================= */

function SMA(values, period) {
  const out = Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function EMA(values, period) {
  const out = Array(values.length).fill(null);
  if (period <= 0) return out;
  const k = 2 / (period + 1);
  let emaPrev = null;
  for (let i = 0; i < values.length; i++) {
    const price = values[i];
    if (i === period - 1) {
      let sum = 0;
      for (let j = i - (period - 1); j <= i; j++) sum += values[j];
      emaPrev = sum / period;
      out[i] = emaPrev;
    } else if (i >= period) {
      emaPrev = price * k + emaPrev * (1 - k);
      out[i] = emaPrev;
    }
  }
  return out;
}

function RSI(closes, period = 14) {
  const out = Array(closes.length).fill(null);
  if (period <= 0 || closes.length < period + 1) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

function MACDSeries(closes, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = EMA(closes, fast);
  const emaSlow = EMA(closes, slow);
  const macd = Array(closes.length).fill(null);

  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] != null && emaSlow[i] != null) {
      macd[i] = emaFast[i] - emaSlow[i];
    }
  }

  const macdNumbers = macd.map((v) => (v == null ? 0 : v));
  const signal = EMA(macdNumbers, signalPeriod);
  const histogram = Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (macd[i] != null && signal[i] != null) {
      histogram[i] = macd[i] - signal[i];
    }
  }
  return { macd, signal, histogram };
}

function ATR(candles, period = 14) {
  const out = Array(candles.length).fill(null);
  if (candles.length < period) return out;

  const TRs = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = i > 0 ? candles[i - 1].close : c.close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
    TRs.push(tr);
  }

  let atr = 0;
  for (let i = 0; i < TRs.length; i++) {
    if (i === period - 1) {
      atr = TRs.slice(0, period).reduce((a, b) => a + b, 0) / period;
      out[i] = atr;
    } else if (i >= period) {
      atr = ((atr * (period - 1)) + TRs[i]) / period;
      out[i] = atr;
    }
  }
  return out;
}

function crossedAbove(a, b) {
  const n = a.length - 1;
  if (n < 1 || a[n] == null || b[n] == null || a[n - 1] == null || b[n - 1] == null) return false;
  return a[n - 1] <= b[n - 1] && a[n] > b[n];
}

function crossedBelow(a, b) {
  const n = a.length - 1;
  if (n < 1 || a[n] == null || b[n] == null || a[n - 1] == null || b[n - 1] == null) return false;
  return a[n - 1] >= b[n - 1] && a[n] < b[n];
}

function TwoPoleOscillator(values, period = 20) {
  const out = Array(values.length).fill(null);
  if (period <= 1 || values.length < period) return out;
  const a = Math.exp(-Math.sqrt(2) * Math.PI / period);
  const b = 2 * a * Math.cos(Math.sqrt(2) * Math.PI / period);
  const c2 = b;
  const c3 = -a * a;
  const c1 = 1 - c2 - c3;
  const filt = Array(values.length).fill(0);
  for (let i = 0; i < values.length; i++) {
    if (i === 0) {
      filt[i] = values[i];
    } else if (i === 1) {
      filt[i] = values[i];
    } else {
      filt[i] = c1 * ((values[i] + values[i - 1]) / 2) + c2 * filt[i - 1] + c3 * filt[i - 2];
    }
    if (i >= period) {
      out[i] = values[i] - filt[i];
    }
  }
  return out;
}

function SupportResistanceChannel(candles, pivotLen = 5) {
  const n = candles.length;
  const support = Array(n).fill(null);
  const resistance = Array(n).fill(null);
  let lastSupport = null;
  let lastResistance = null;
  for (let i = 0; i < n; i++) {
    let isPivotHigh = true;
    let isPivotLow = true;
    for (let l = 1; l <= pivotLen; l++) {
      const li = i - l;
      const ri = i + l;
      const left = li >= 0 ? candles[li] : candles[i];
      const right = ri < n ? candles[ri] : candles[i];
      if (candles[i].high <= left.high || candles[i].high <= right.high) isPivotHigh = false;
      if (candles[i].low >= left.low || candles[i].low >= right.low) isPivotLow = false;
      if (!isPivotHigh && !isPivotLow) break;
    }
    if (isPivotHigh) lastResistance = candles[i].high;
    if (isPivotLow) lastSupport = candles[i].low;
    resistance[i] = lastResistance;
    support[i] = lastSupport;
  }
  return { support, resistance };
}

function LonesomeTheBlueSR(candles, pivotLen = 10, maxBack = 300) {
  const n = candles.length;
  if (n < pivotLen * 2 + 1) return { support: null, resistance: null };

  const startIdx = Math.max(0, n - maxBack);
  const pivotsHigh = [];
  const pivotsLow = [];

  // 1. Find Pivots
  for (let i = startIdx + pivotLen; i < n - pivotLen; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    let isHigh = true;
    let isLow = true;

    for (let j = 1; j <= pivotLen; j++) {
      if (candles[i - j].high > high || candles[i + j].high > high) isHigh = false;
      if (candles[i - j].low < low || candles[i + j].low < low) isLow = false;
    }

    if (isHigh) pivotsHigh.push({ price: high, index: i });
    if (isLow) pivotsLow.push({ price: low, index: i });
  }

  // 2. Find Closest Support & Resistance from current price
  const lastClose = candles[n - 1].close;
  let closestSupport = null;
  let closestResistance = null;

  // Simple logic: Find the "strongest" or "most recent" relevant pivot levels
  // We will take the closest Pivot High above price as Resistance
  // And closest Pivot Low below price as Support
  // Refinement: Pivot clusters could be better, but closest significant pivot is a good approximation for "channel" bounds.

  let minDiffRes = Infinity;
  for (const p of pivotsHigh) {
    if (p.price > lastClose) {
      const diff = p.price - lastClose;
      if (diff < minDiffRes) {
        minDiffRes = diff;
        closestResistance = p.price;
      }
    }
  }

  let minDiffSup = Infinity;
  for (const p of pivotsLow) {
    if (p.price < lastClose) {
      const diff = lastClose - p.price;
      if (diff < minDiffSup) {
        minDiffSup = diff;
        closestSupport = p.price;
      }
    }
  }

  // Fallback: if no pivot above/below, maybe use the recent extremes
  if (closestResistance === null) closestResistance = Math.max(...candles.slice(-pivotLen).map(c => c.high));
  if (closestSupport === null) closestSupport = Math.min(...candles.slice(-pivotLen).map(c => c.low));

  return { support: closestSupport, resistance: closestResistance };
}

function BollingerBands(values, period = 20, stdDev = 2) {
  const out = {
    upper: Array(values.length).fill(null),
    middle: Array(values.length).fill(null),
    lower: Array(values.length).fill(null)
  };

  if (values.length < period) return out;

  // SMA is middle band
  const sma = SMA(values, period);

  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1);
    const mean = sma[i];
    const sumSqDiff = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0);
    const variance = sumSqDiff / period;
    const std = Math.sqrt(variance);

    out.middle[i] = mean;
    out.upper[i] = mean + stdDev * std;
    out.lower[i] = mean - stdDev * std;
  }
  return out;
}

function StochasticRSI(values, rsiPeriod = 14, stochPeriod = 14, kPeriod = 3, dPeriod = 3) {
  const rsi = RSI(values, rsiPeriod);
  const stochK = Array(values.length).fill(null);
  const stochD = Array(values.length).fill(null);

  // Need enough data for RSI + Stoch
  if (values.length < rsiPeriod + stochPeriod) return { k: stochK, d: stochD };

  const stochRSI = Array(values.length).fill(null);

  for (let i = rsiPeriod + stochPeriod - 1; i < values.length; i++) {
    // Get slice of RSI values
    // Note: RSI array has nulls at start, so indices align
    const rsiSlice = [];
    for (let j = 0; j < stochPeriod; j++) {
      rsiSlice.push(rsi[i - j]);
    }
    const minRSI = Math.min(...rsiSlice);
    const maxRSI = Math.max(...rsiSlice);

    if (maxRSI - minRSI === 0) {
      stochRSI[i] = 100; // Flatline max
    } else {
      stochRSI[i] = ((rsi[i] - minRSI) / (maxRSI - minRSI)) * 100;
    }
  }

  // Smooth K and D
  const smoothK = SMA(stochRSI.map(v => v === null ? 0 : v), kPeriod); // Simple smoothing for now, ideally SMA on valid range
  // Let's do a proper running calculation for K and D to handle nulls correctly? 
  // Simplified: standard StochRSI often uses SMA on the StochRSI values

  // Re-loop for correct K/D mapping avoiding 0s where null
  for (let i = 0; i < values.length; i++) {
    if (stochRSI[i] == null) {
      stochK[i] = null;
      stochD[i] = null;
    }
  }

  // Calculate SMA on valid StochRSI values for K
  for (let i = rsiPeriod + stochPeriod + kPeriod - 2; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < kPeriod; j++) sum += stochRSI[i - j];
    stochK[i] = sum / kPeriod;
  }

  // Calculate SMA on K for D
  for (let i = rsiPeriod + stochPeriod + kPeriod + dPeriod - 3; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < dPeriod; j++) sum += stochK[i - j];
    stochD[i] = sum / dPeriod;
  }

  return { k: stochK, d: stochD };
}

function ADX(candles, period = 14) {
  // Wilder's ADX
  const n = candles.length;
  const adx = Array(n).fill(null);
  if (n < period * 2) return adx;

  const plusDM = Array(n).fill(0);
  const minusDM = Array(n).fill(0);
  const tr = Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const p = candles[i - 1];

    const up = c.high - p.high;
    const down = p.low - c.low;

    plusDM[i] = (up > down && up > 0) ? up : 0;
    minusDM[i] = (down > up && down > 0) ? down : 0;

    tr[i] = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
  }

  // Smooth TR, +DM, -DM (Wilder's Smoothing)
  // First value is sum
  let trSmooth = 0;
  let plusDMSmooth = 0;
  let minusDMSmooth = 0;

  for (let i = 1; i <= period; i++) {
    trSmooth += tr[i];
    plusDMSmooth += plusDM[i];
    minusDMSmooth += minusDM[i];
  }

  // Initial Calculation
  // We need to calculate DX for a period to get first ADX?
  // Wilder's approach: ADX is EMA of DX.

  const dx = Array(n).fill(null);

  // Helper for Wilder Smoothing: prev - (prev/n) + new
  // But standard RSI/ATR uses this. Let's use simple rolling for first segment then smoothing.

  // Let's implement correct Wilder's smoothing loop from period+1
  let prevTr = trSmooth;
  let prevPlus = plusDMSmooth;
  let prevMinus = minusDMSmooth;

  for (let i = period + 1; i < n; i++) {
    const currentTr = prevTr - (prevTr / period) + tr[i];
    const currentPlus = prevPlus - (prevPlus / period) + plusDM[i];
    const currentMinus = prevMinus - (prevMinus / period) + minusDM[i];

    prevTr = currentTr;
    prevPlus = currentPlus;
    prevMinus = currentMinus;

    const diPlus = (currentPlus / currentTr) * 100;
    const diMinus = (currentMinus / currentTr) * 100;

    const sumDi = diPlus + diMinus;
    dx[i] = sumDi === 0 ? 0 : (Math.abs(diPlus - diMinus) / sumDi) * 100;
  }

  // ADX is SMA of DX over period (or smoothed)
  // First ADX
  let dxSum = 0;
  let count = 0;
  // We need 'period' amount of DX values to calculate first ADX
  // DX starts at index 'period + 1' approx.
  // Realistically simpler approximation used in libraries: 

  // Using EMA on DX is common for ADX
  const adxEma = EMA(dx.map(x => x === null ? 0 : x), period);
  // Refill nulls
  for (let i = 0; i < period * 2; i++) adxEma[i] = null;

  return adxEma;
}

/* ================= 2. ML LOGIC (from ml.ts) ================= */

class OnlineLogisticRegression {
  constructor(featureCount, learningRate = 0.01, init) {
    if (init) {
      this.weights = init.weights;
      this.bias = init.bias;
      this.learningRate = init.learningRate;
      this.featureCount = init.featureCount;
    } else {
      this.featureCount = featureCount;
      this.learningRate = learningRate;
      this.weights = Array(featureCount).fill(0);
      this.bias = 0;
    }
  }

  predictProba(x) {
    if (x.length !== this.featureCount) throw new Error(`Feature length mismatch.`);
    const z = this.bias + this.weights.reduce((acc, w, i) => acc + w * x[i], 0);
    return 1 / (1 + Math.exp(-z));
  }

  update(x, y) {
    const p = this.predictProba(x);
    const error = p - y;
    for (let i = 0; i < this.featureCount; i++) {
      this.weights[i] -= this.learningRate * error * x[i];
    }
    this.bias -= this.learningRate * error;
    // return loss
    const eps = 1e-12;
    return -(y * Math.log(p + eps) + (1 - y) * Math.log(1 - p + eps));
  }

  serialize() {
    return {
      weights: this.weights,
      bias: this.bias,
      learningRate: this.learningRate,
      featureCount: this.featureCount,
    };
  }
}

// Persist to Firestore
async function loadGlobalModel() {
  try {
    const docRef = doc(db, "models", MODEL_DOC_ID);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      const obj = docSnap.data();
      return new OnlineLogisticRegression(obj.featureCount, obj.learningRate, obj);
    } else {
      return null;
    }
  } catch (e) {
    console.error("Error loading model:", e);
    return null;
  }
}

function extractFeatures(candles) {
  const n = candles.length - 1;
  const closes = candles.map(c => c.close);
  const ema50 = EMA(closes, 50);
  const ema200 = EMA(closes, 200);
  const rsi14 = RSI(closes, 14);
  const macd = MACDSeries(closes, 12, 26, 9);
  const atr14 = ATR(candles, 14);

  // New Indicators
  const bb = BollingerBands(closes, 20, 2);
  const stoch = StochasticRSI(closes, 14, 14, 3, 3);
  const adx = ADX(candles, 14);

  const last = candles[n];
  const prev = candles[n - 1] ?? last;

  const price = last.close || 1;
  const ret1 = (last.close - prev.close) / Math.max(prev.close, 1e-6);
  const e50 = ema50[n] ?? price;
  const e200 = ema200[n] ?? price;
  const rsi = rsi14[n] ?? 50;
  const macdHist = macd.histogram[n] ?? 0;
  const atr = atr14[n] ?? 0;

  const bbUpper = bb.upper[n] ?? price;
  const bbLower = bb.lower[n] ?? price;
  const bbWidth = bbUpper - bbLower;
  const stochK = stoch.k[n] ?? 50;
  const adxVal = adx[n] ?? 0;

  const rsiNorm = (rsi - 50) / 50;
  const emaRatio = e200 ? e50 / e200 - 1 : 0;
  const macdNorm = macdHist / Math.max(price, 1e-6);
  const atrNorm = atr / Math.max(price, 1e-6);
  const aboveE50 = last.close > e50 ? 1 : 0;

  // New Features
  const bbPctB = bbWidth > 0 ? (price - bbLower) / bbWidth : 0.5; // %B
  const bbBw = bbWidth / Math.max(bb.middle[n] ?? price, 1e-6); // Bandwidth
  const stochNorm = (stochK - 50) / 50;
  const adxNorm = adxVal / 100;

  return [ret1, rsiNorm, emaRatio, macdNorm, atrNorm, aboveE50, bbPctB, bbBw, stochNorm, adxNorm];
}

function checkTradeOutcome(candles, startIndex, entryPrice, stopLoss, takeProfit, isLong) {
  for (let i = startIndex; i < candles.length; i++) {
    const c = candles[i];
    if (isLong) {
      if (c.high >= takeProfit) return 1; // Win
      if (c.low <= stopLoss) return 0;   // Loss
    } else {
      if (c.low <= takeProfit) return 1; // Win
      if (c.high >= stopLoss) return 0;  // Loss
    }
  }
  return null;
}

async function computeMLProbability(candles) {
  const model = await loadGlobalModel();
  if (!model) return null; // No shared model yet
  const x = extractFeatures(candles);
  if (model.featureCount !== x.length) {
    return null; // Feature mismatch
  }
  return model.predictProba(x);
}

/* ================= 3. SIGNAL LOGIC (from signal.ts) ================= */

function computeTradeSignal(candles) {
  if (!candles || candles.length < 60) {
    const lastClose = candles?.[candles.length - 1]?.close ?? 0;
    return {
      signal: {
        action: "hold",
        confidence: 0,
        entry: lastClose,
        stopLoss: lastClose,
        takeProfit: lastClose,
        reasons: ["Insufficient data"]
      },
      indicators: {
        ema50: null, ema200: null, rsi14: null,
        macd: { macd: null, signal: null, histogram: null },
        atr14: null, twoPole: null, srChannel: { support: null, resistance: null, width: null },
        lonesomeSR: { support: null, resistance: null },
        bb: { upper: null, middle: null, lower: null },
        stoch: { k: null, d: null },
        adx: null
      }
    };
  }

  const closes = candles.map((c) => c.close);
  const ema50 = EMA(closes, 50);
  const ema200 = EMA(closes, 200);
  const rsi14 = RSI(closes, 14);
  const macd = MACDSeries(closes, 12, 26, 9);
  const atr14 = ATR(candles, 14);
  const twoPole = TwoPoleOscillator(closes, 20);
  const sr = SupportResistanceChannel(candles, 5);
  const lonesomeSR = LonesomeTheBlueSR(candles, 10, 300);

  // New Logic
  const bb = BollingerBands(closes, 20, 2);
  const stoch = StochasticRSI(closes, 14, 14, 3, 3);
  const adx = ADX(candles, 14);

  const n = candles.length - 1;
  const lastClose = closes[n];
  const E50 = ema50[n];
  const E200 = ema200[n];
  const R = rsi14[n];
  const M = macd.macd[n];
  const S = macd.signal[n];
  const H = macd.histogram[n];
  const A = atr14[n];
  const TP = twoPole[n];
  const Ssupport = sr.support[n];
  const Sresistance = sr.resistance[n];

  const BB_Upper = bb.upper[n];
  const BB_Lower = bb.lower[n];
  const StochK = stoch.k[n];
  const StochD = stoch.d[n];
  const ADXVal = adx[n];

  const reasons = [];
  let longScore = 0;
  let shortScore = 0;

  if (E50 != null && E200 != null) {
    if (E50 > E200) { longScore += 1; reasons.push("EMA50 > EMA200 (uptrend)"); }
    else if (E50 < E200) { shortScore += 1; reasons.push("EMA50 < EMA200 (downtrend)"); }
  }

  if (E50 != null) {
    if (lastClose > E50) { longScore += 0.5; reasons.push("Price > EMA50"); }
    else { shortScore += 0.5; reasons.push("Price < EMA50"); }
  }

  if (R != null) {
    // Tighter RSI ranges logic? No, keep standard but add stoch
    if (R >= 50 && R <= 70) { longScore += 0.5; reasons.push(`RSI=${R.toFixed(1)} bullish`); }
    else if (R <= 50 && R >= 30) { shortScore += 0.5; reasons.push(`RSI=${R.toFixed(1)} bearish`); }

    // Extreme RSI
    if (R > 75) { shortScore += 1; reasons.push("RSI > 75 (Overbought)"); } // Reversal hint
    // if (R < 25) { longScore += 1; reasons.push("RSI < 25 (Oversold)"); } // Reversal hint
    // Wait, trending markets can stay overbought. Let's use ADX to differentiate.
  }

  const macdCrossUp = crossedAbove(macd.macd, macd.signal);
  const macdCrossDown = crossedBelow(macd.macd, macd.signal);
  if (macdCrossUp || (H != null && H > 0)) { longScore += 1; reasons.push("MACD bullish"); }
  if (macdCrossDown || (H != null && H < 0)) { shortScore += 1; reasons.push("MACD bearish"); }

  if (TP != null) {
    if (TP > 0) { longScore += 0.5; reasons.push("Oscillator bullish"); }
    else if (TP < 0) { shortScore += 0.5; reasons.push("Oscillator bearish"); }
  }

  if (Ssupport != null || Sresistance != null) {
    const atr = A != null ? A : Math.max(1e-6, lastClose * 0.002);
    if (Ssupport != null && Math.abs(lastClose - Ssupport) <= 0.5 * atr) {
      longScore += 0.5; reasons.push(`Near support ~${Ssupport.toFixed(2)}`);
    }
    if (Sresistance != null && Math.abs(Sresistance - lastClose) <= 0.5 * atr) {
      shortScore += 0.5; reasons.push(`Near resistance ~${Sresistance.toFixed(2)}`);
    }
  }

  // --- New Logic Integration ---

  // 1. ADX Trend Strength
  const isTrending = ADXVal != null && ADXVal > 25;
  if (ADXVal != null) {
    reasons.push(`ADX=${ADXVal.toFixed(1)} (${isTrending ? "Trending" : "Ranging"})`);
  }

  // 2. Bollinger Bands
  if (BB_Upper != null && BB_Lower != null) {
    if (lastClose > BB_Upper) {
      if (isTrending) {
        longScore += 1; // Strong momentum breakout
        reasons.push("Price > BB Upper (Breakout)");
      } else {
        shortScore += 1; // Mean reversion in range
        reasons.push("Price > BB Upper (Overextended)");
      }
    } else if (lastClose < BB_Lower) {
      if (isTrending) {
        shortScore += 1; // Strong momentum breakdown
        reasons.push("Price < BB Lower (Breakdown)");
      } else {
        longScore += 1; // Mean reversion in range
        reasons.push("Price < BB Lower (Oversold)");
      }
    }
  }

  // 3. Stochastic RSI
  if (StochK != null && StochD != null) {
    if (StochK < 20 && crossedAbove(stoch.k, stoch.d)) {
      longScore += 1.5; // Strong buy signal
      reasons.push("StochRSI Bull Cross (Oversold)");
    } else if (StochK > 80 && crossedBelow(stoch.k, stoch.d)) {
      shortScore += 1.5; // Strong sell signal
      reasons.push("StochRSI Bear Cross (Overbought)");
    }
  }

  const scoreDiff = longScore - shortScore;
  let action = "hold";
  if (scoreDiff >= 2) action = "buy"; // Increased threshold slightly for precision
  else if (scoreDiff <= -2) action = "sell";

  const atrMultStop = 1.5;
  const rr = 2.0; // Slightly conservative
  const entry = lastClose;
  let stopLoss = lastClose;
  let takeProfit = lastClose;

  if (A != null) {
    const atr = A;
    if (action === "buy") {
      stopLoss = entry - atrMultStop * atr;
      takeProfit = entry + rr * (entry - stopLoss);
    } else if (action === "sell") {
      stopLoss = entry + atrMultStop * atr;
      takeProfit = entry - rr * (stopLoss - entry);
    } else {
      stopLoss = entry - atrMultStop * atr;
      takeProfit = entry + atrMultStop * atr;
    }
  }

  // RR Check
  let enforceHold = false;
  if (action !== "hold") {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    const rewardOverRisk = risk > 0 ? reward / risk : 0;

    if (A == null || risk <= 0 || rewardOverRisk < 1.5) {
      action = "hold";
      enforceHold = true;
      reasons.push("RR < 1.5; forcing HOLD");
      // Re-center
      stopLoss = entry;
      takeProfit = entry;
    }
  }

  const indicatorsAvailable = (E50 != null ? 1 : 0) + (E200 != null ? 1 : 0) + (R != null ? 1 : 0) + (M != null && S != null ? 1 : 0) + (A != null ? 1 : 0) + (BB_Upper != null ? 1 : 0) + (StochK != null ? 1 : 0);
  let confidence = Math.min(0.95, Math.max(0.2, Math.abs(scoreDiff) / 4)); // Adjusted denominator for higher scores
  if (enforceHold) confidence = Math.min(confidence, 0.2);

  // 60% Confidence Rule
  if (confidence < 0.60 && action !== "hold") {
    action = "hold";
    reasons.push(`Confidence ${(confidence * 100).toFixed(1)}% < 60%`);
    stopLoss = entry;
    takeProfit = entry;
  }

  return {
    signal: { action, confidence, entry, stopLoss, takeProfit, reasons },
    indicators: {
      ema50: E50, ema200: E200, rsi14: R,
      macd: { macd: M, signal: S, histogram: H },
      atr14: A,
      twoPole: TP,
      lonesomeSR: {
        support: lonesomeSR.support,
        resistance: lonesomeSR.resistance
      },
      srChannel: {
        support: Ssupport,
        resistance: Sresistance,
        width: (Ssupport && Sresistance) ? Math.max(Sresistance - Ssupport, 0) : null
      },
      bb: { upper: BB_Upper, middle: bb.middle[n], lower: BB_Lower },
      stoch: { k: StochK, d: StochD },
      adx: ADXVal
    }
  };
}

/* ================= 4. CONTROLLER (Main Logic) ================= */

function parseBinanceKlines(raw) {
  // [time, open, high, low, close, volume, closeTime...]
  return raw.map((k) => ({
    openTime: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    closeTime: Number(k[6]),
  }));
}

async function fetchAndAnalyze(symbol, interval) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=500`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch from Binance. Check symbol or internet.");
    const raw = await res.json();
    const candles = parseBinanceKlines(raw);

    const { signal, indicators } = computeTradeSignal(candles);

    // Calculate predicted validity duration
    if (signal.action !== "hold" && indicators.atr14) {
      const dist = Math.abs(signal.takeProfit - signal.entry);
      const atr = indicators.atr14;
      const candlesNeeded = atr > 0 ? dist / atr : 0;
      signal.estDuration = candlesNeeded * intervalToSeconds(interval);
    } else {
      signal.estDuration = 0;
    }

    const last = candles[candles.length - 1];

    // Fetch the shared model for prediction
    let mlProbability = null;
    try {
      mlProbability = await computeMLProbability(candles);
    } catch (e) {
      console.warn("ML Prediction failed (maybe offline):", e);
    }

    return {
      symbol,
      interval,
      timestamp: last.closeTime,
      lastPrice: last.close,
      signal,
      indicators,
      mlProbability
    };

  } catch (err) {
    throw err;
  }
}

async function trainModel(symbol, interval) {
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=500`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch training data.");
    const raw = await res.json();
    const candles = parseBinanceKlines(raw);

    if (candles.length < 205) throw new Error("Not enough data to train.");

    // Run transaction: read global, update, write global
    let trainedCount = 0;
    let totalLoss = 0;

    const docRef = doc(db, "models", MODEL_DOC_ID);

    await runTransaction(db, async (transaction) => {
      const docSnap = await transaction.get(docRef);
      let model;

      if (!docSnap.exists()) {
        // Init with dummy features
        const dummyX = extractFeatures(candles.slice(0, 201));
        model = new OnlineLogisticRegression(dummyX.length, 0.01);
      } else {
        const obj = docSnap.data();
        model = new OnlineLogisticRegression(obj.featureCount, obj.learningRate, obj);
      }

      // Feature count check
      const checkX = extractFeatures(candles.slice(0, 201));
      if (model.featureCount !== checkX.length) {
        // Reset if features are different (breaking change)
        model = new OnlineLogisticRegression(checkX.length, 0.01);
      }

      trainedCount = 0;
      totalLoss = 0;

      // Walk forward training on the shared model
      for (let i = 200; i < candles.length - 1; i++) {
        const history = candles.slice(0, i + 1);
        const x = extractFeatures(history);

        const { signal } = computeTradeSignal(history);
        const { action, stopLoss, takeProfit, entry } = signal;

        if (action === "buy" && stopLoss && takeProfit) {
          const outcome = checkTradeOutcome(candles, i + 1, entry, stopLoss, takeProfit, true);
          if (outcome !== null) {
            const loss = model.update(x, outcome);
            totalLoss += loss;
            trainedCount++;
          }
        }
      }

      // Write back updated weights
      transaction.set(docRef, model.serialize());
    });

    return { trainedCount, avgLoss: trainedCount ? totalLoss / trainedCount : 0 };

  } catch (err) {
    throw err;
  }
}

// UI HANDLERS
const form = document.querySelector("#signalForm");
const trainBtn = document.querySelector("#trainBtn");
const loadingEl = document.querySelector("#loading");
const resultEl = document.querySelector("#resultSection");
const errorEl = document.querySelector("#error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const symbol = document.querySelector("#symbolInput").value.toUpperCase();
  const interval = document.querySelector("#intervalInput").value;

  loadingEl.classList.remove("hidden");
  errorEl.classList.add("hidden");
  resultEl.classList.add("hidden");

  try {
    const data = await fetchAndAnalyze(symbol, interval);
    renderResult(data);
    resultEl.classList.remove("hidden");
    // Also update training UI just in case
    updateTrainUI();
  } catch (err) {
    errorEl.textContent = `Error: ${err.message}`;
    errorEl.classList.remove("hidden");
    console.error(err);
  } finally {
    loadingEl.classList.add("hidden");
  }
});

/* ================= TRAIN BUTTON VISIBILITY LOGIC ================= */
const trainStatusEl = document.querySelector("#trainStatus");

function getTrainingKey(symbol, interval) {
  return `train_loss_${symbol}_${interval}`;
}

function updateTrainUI() {
  const symbol = document.querySelector("#symbolInput").value.toUpperCase();
  const interval = document.querySelector("#intervalInput").value;
  const key = getTrainingKey(symbol, interval);
  const storedLoss = localStorage.getItem(key);

  if (storedLoss !== null && parseFloat(storedLoss) === 0) {
    trainBtn.classList.add("hidden");
    trainStatusEl.textContent = "Model Fully Trained (Loss: 0.0000)";
    trainStatusEl.style.display = "inline";
  } else {
    trainBtn.classList.remove("hidden");
    trainStatusEl.style.display = "none";
  }
}

// Attach listeners for UI updates
document.querySelector("#symbolInput").addEventListener("input", updateTrainUI);
document.querySelector("#symbolInput").addEventListener("blur", updateTrainUI);
document.querySelector("#intervalInput").addEventListener("change", updateTrainUI);

// Initial State Check
updateTrainUI();

trainBtn.addEventListener("click", async () => {
  const symbol = document.querySelector("#symbolInput").value.toUpperCase();
  const interval = document.querySelector("#intervalInput").value;

  const originalText = trainBtn.textContent;
  trainBtn.textContent = "Training (Shared)...";
  trainBtn.disabled = true;
  errorEl.classList.add("hidden");

  try {
    const res = await trainModel(symbol, interval);
    alert(`Shared Training Complete!\nProcessed Trades: ${res.trainedCount}\nAvg Loss: ${res.avgLoss.toFixed(4)}\n\nThe global model in Firestore has been updated.`);

    // Save to local storage
    const key = getTrainingKey(symbol, interval);
    localStorage.setItem(key, res.avgLoss.toString());
    updateTrainUI();

  } catch (err) {
    errorEl.textContent = `Training Error: ${err.message}`;
    errorEl.classList.remove("hidden");
    console.error(err);
  } finally {
    trainBtn.textContent = originalText;
    trainBtn.disabled = false;
  }
});

/* ================= MARKET OVERVIEW LOGIC ================= */

async function fetchMarketData() {
  try {
    const res = await fetch("https://api.binance.com/api/v3/ticker/24hr");
    if (!res.ok) throw new Error("Failed to fetch market data");
    const data = await res.json();

    // Filter for USDT pairs only and exclude leveraged tokens (UP/DOWN/BULL/BEAR)
    const usdtPairs = data.filter(t =>
      t.symbol.endsWith("USDT") &&
      !t.symbol.includes("UP") &&
      !t.symbol.includes("DOWN") &&
      !t.symbol.includes("BULL") &&
      !t.symbol.includes("BEAR")
    );

    // Sort by percentage change
    const sorted = usdtPairs.sort((a, b) => parseFloat(b.priceChangePercent) - parseFloat(a.priceChangePercent));

    const topGainers = sorted.slice(0, 5);
    const topLosers = sorted.slice(-5).reverse(); // Bottom 5, reversed to show worst first

    renderMarketList("topGainers", topGainers);
    renderMarketList("topLosers", topLosers);

  } catch (err) {
    console.error("Market data error:", err);
    document.querySelector("#topGainers").innerHTML = '<p class="error">Failed to load</p>';
    document.querySelector("#topLosers").innerHTML = '<p class="error">Failed to load</p>';
  }
}

function renderMarketList(elementId, items) {
  const container = document.getElementById(elementId);
  container.innerHTML = "";

  items.forEach(item => {
    const price = parseFloat(item.lastPrice);
    const change = parseFloat(item.priceChangePercent);
    const div = document.createElement("div");
    div.className = "ticker-item";

    // Format price roughly
    const fmtPrice = price < 1 ? price.toFixed(5) : price.toFixed(2);

    div.innerHTML = `
      <span class="ticker-symbol" title="Click to analyze">${item.symbol.replace("USDT", "")}</span>
      <span class="ticker-price">$${fmtPrice}</span>
      <span class="ticker-change ${change >= 0 ? "change-pos" : "change-neg"}">
        ${change > 0 ? "+" : ""}${change.toFixed(2)}%
      </span>
    `;

    // Click to analyze
    div.querySelector(".ticker-symbol").addEventListener("click", () => {
      document.querySelector("#symbolInput").value = item.symbol;
      // Trigger the signal
      document.querySelector("#submitBtn").click();
    });

    container.appendChild(div);
  });
}

// Initial Fetch
fetchMarketData();
// Refresh every 1s
setInterval(fetchMarketData, 1000);

function formatPrice(val) {
  if (typeof val !== 'number') return "-";
  return val > 50 ? val.toFixed(3) : val.toFixed(5);
}

function intervalToSeconds(interval) {
  const num = parseInt(interval);
  if (interval.endsWith("m")) return num * 60;
  if (interval.endsWith("h")) return num * 3600;
  if (interval.endsWith("d")) return num * 86400;
  if (interval.endsWith("w")) return num * 604800;
  return 60; // 1m default
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "--";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `~${h}h ${m}m`;
  return `~${m}m`;
}

function renderResult(data) {
  document.querySelector("#resSymbol").textContent = `${data.symbol} (${data.interval})`;

  document.querySelector("#resPrice").textContent = formatPrice(data.lastPrice);

  const date = new Date(data.timestamp);
  document.querySelector("#resTime").textContent = date.toLocaleString();

  // Action Badge
  const badge = document.querySelector("#resBadge");
  badge.textContent = data.signal.action;
  badge.className = "signal-badge"; // reset
  if (data.signal.action === "buy") badge.classList.add("signal-buy");
  else if (data.signal.action === "sell") badge.classList.add("signal-sell");
  else badge.classList.add("signal-hold");

  document.querySelector("#resConfidence").textContent = `Conf: ${(data.signal.confidence * 100).toFixed(0)}%`;

  // Stats
  document.querySelector("#valEntry").textContent = formatPrice(data.signal.entry);
  document.querySelector("#valStop").textContent = formatPrice(Math.max(0, data.signal.stopLoss));
  document.querySelector("#valTP").textContent = formatPrice(Math.max(0, data.signal.takeProfit));
  document.querySelector("#resValidity").textContent = formatDuration(data.signal.estDuration);
  document.querySelector("#valML").textContent = typeof data.mlProbability === 'number'
    ? `${(data.mlProbability * 100).toFixed(1)}%`
    : "N/A (Train Model)";

  // Reasons
  const reasonsList = document.querySelector("#reasonsList");
  reasonsList.innerHTML = "";
  data.signal.reasons.forEach(r => {
    const li = document.createElement("li");
    li.textContent = r;
    reasonsList.appendChild(li);
  });

  // Indicators Table
  const ind = data.indicators;
  document.querySelector("#indRSI").textContent = ind.rsi14 ? ind.rsi14.toFixed(4) : "-";
  document.querySelector("#indMACD").textContent = ind.macd.macd ? ind.macd.macd.toFixed(4) : "-";
  document.querySelector("#indEMA50").textContent = ind.ema50 ? formatPrice(ind.ema50) : "-";
  document.querySelector("#indATR").textContent = ind.atr14 ? ind.atr14.toFixed(4) : "-";

  // LonesomeTheBlue SR
  const lup = ind.lonesomeSR.support !== null ? Math.max(0, ind.lonesomeSR.support) : "-";
  const ldown = ind.lonesomeSR.resistance !== null ? Math.max(0, ind.lonesomeSR.resistance) : "-";

  document.querySelector("#indLonesomeSup").textContent = typeof lup === "number" ? formatPrice(lup) : lup;
  document.querySelector("#indLonesomeRes").textContent = typeof ldown === "number" ? formatPrice(ldown) : ldown;

  // New Indicators
  // BB
  const bbU = ind.bb.upper ? formatPrice(ind.bb.upper) : "-";
  const bbL = ind.bb.lower ? formatPrice(ind.bb.lower) : "-";
  document.querySelector("#indBB").textContent = `${bbU} / ${bbL}`;

  // Stoch
  const sK = ind.stoch.k ? ind.stoch.k.toFixed(1) : "-";
  const sD = ind.stoch.d ? ind.stoch.d.toFixed(1) : "-";
  document.querySelector("#indStoch").textContent = `K:${sK} D:${sD}`;

  // ADX
  document.querySelector("#indADX").textContent = ind.adx ? ind.adx.toFixed(2) : "-";
}

/* ================= 5. DROPDOWN SEARCH LOGIC ================= */
const symbolInput = document.querySelector("#symbolInput");
const dropdown = document.querySelector("#symbolDropdown");
let allSymbols = [];

async function fetchSymbols() {
  try {
    // Fetch exchange info
    const res = await fetch("https://api.binance.com/api/v3/exchangeInfo");
    if (!res.ok) throw new Error("Failed to fetch symbols");
    const data = await res.json();

    // Store symbols (sorting by symbol name)
    allSymbols = data.symbols
      .filter(s => s.status === "TRADING") // Only trading pairs
      .map(s => ({
        symbol: s.symbol,
        base: s.baseAsset,
        quote: s.quoteAsset
      }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    console.log(`Loaded ${allSymbols.length} symbols from Binance.`);
  } catch (e) {
    console.warn("Symbol fetch error (dropdown will be empty):", e);
  }
}

function filterSymbols(query) {
  if (!query) {
    return allSymbols.slice(0, 50);
  }
  const q = query.toUpperCase();
  // Simple priority: starts with > includes
  // We'll just use includes for simplicity.
  return allSymbols.filter(s => s.symbol.includes(q)).slice(0, 50);
}

function renderDropdown(items) {
  dropdown.innerHTML = "";
  if (items.length === 0) {
    dropdown.classList.add("hidden");
    return;
  }

  items.forEach(item => {
    const li = document.createElement("li");
    li.innerHTML = `
      <span class="symbol">${item.symbol}</span>
      <span class="asset-name">${item.base}/${item.quote}</span>
    `;
    li.addEventListener("click", () => {
      symbolInput.value = item.symbol;
      dropdown.classList.add("hidden");
      updateTrainUI();
    });
    dropdown.appendChild(li);
  });

  dropdown.classList.remove("hidden");
}

// Event Listeners
const showDropdown = () => {
  const query = symbolInput.value.trim();
  // filterSymbols matches top 50 if query is empty
  const filtered = filterSymbols(query);
  renderDropdown(filtered);
};

symbolInput.addEventListener("input", showDropdown);
symbolInput.addEventListener("focus", showDropdown);
symbolInput.addEventListener("click", showDropdown);

// Hide dropdown when clicking outside
document.addEventListener("click", (e) => {
  const isClickInside = symbolInput.contains(e.target) || dropdown.contains(e.target);
  if (!isClickInside) {
    dropdown.classList.add("hidden");
  }
});

// Initialize
fetchSymbols();
