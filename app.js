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

  const last = candles[n];
  const prev = candles[n - 1] ?? last;

  const price = last.close || 1;
  const ret1 = (last.close - prev.close) / Math.max(prev.close, 1e-6);
  const e50 = ema50[n] ?? price;
  const e200 = ema200[n] ?? price;
  const rsi = rsi14[n] ?? 50;
  const macdHist = macd.histogram[n] ?? 0;
  const atr = atr14[n] ?? 0;

  const rsiNorm = (rsi - 50) / 50;
  const emaRatio = e200 ? e50 / e200 - 1 : 0;
  const macdNorm = macdHist / Math.max(price, 1e-6);
  const atrNorm = atr / Math.max(price, 1e-6);
  const aboveE50 = last.close > e50 ? 1 : 0;

  return [ret1, rsiNorm, emaRatio, macdNorm, atrNorm, aboveE50];
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
        atr14: null, twoPole: null, srChannel: { support: null, resistance: null, width: null }
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
    if (R >= 50 && R <= 70) { longScore += 1; reasons.push(`RSI=${R.toFixed(1)} bullish`); }
    else if (R <= 50 && R >= 30) { shortScore += 1; reasons.push(`RSI=${R.toFixed(1)} bearish`); }
    if (R > 70) reasons.push("RSI overbought");
    if (R < 30) reasons.push("RSI oversold");
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

  const scoreDiff = longScore - shortScore;
  let action = "hold";
  if (scoreDiff >= 1) action = "buy";
  else if (scoreDiff <= -1) action = "sell";

  const atrMultStop = 1.5;
  const rr = 2.2;
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

    if (A == null || risk <= 0 || rewardOverRisk < 2) {
      action = "hold";
      enforceHold = true;
      reasons.push("RR < 1:2; forcing HOLD");
      // Re-center
      stopLoss = entry;
      takeProfit = entry;
    }
  }

  const indicatorsAvailable = (E50 != null ? 1 : 0) + (E200 != null ? 1 : 0) + (R != null ? 1 : 0) + (M != null && S != null ? 1 : 0) + (A != null ? 1 : 0);
  let confidence = Math.min(0.9, Math.max(0.15, Math.abs(scoreDiff) / 3));
  confidence = Math.min(confidence, 0.15 + 0.15 * indicatorsAvailable);
  if (enforceHold) confidence = Math.min(confidence, 0.15);

  return {
    signal: { action, confidence, entry, stopLoss, takeProfit, reasons },
    indicators: {
      ema50: E50, ema200: E200, rsi14: R,
      macd: { macd: M, signal: S, histogram: H },
      atr14: A,
      twoPole: TP,
      srChannel: {
        support: Ssupport,
        resistance: Sresistance,
        width: (Ssupport && Sresistance) ? Math.max(Sresistance - Ssupport, 0) : null
      }
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

function renderResult(data) {
  document.querySelector("#resSymbol").textContent = `${data.symbol} (${data.interval})`;

  document.querySelector("#resPrice").textContent = data.lastPrice.toFixed(4);

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
  document.querySelector("#valEntry").textContent = data.signal.entry.toFixed(4);
  document.querySelector("#valStop").textContent = data.signal.stopLoss.toFixed(4);
  document.querySelector("#valTP").textContent = data.signal.takeProfit.toFixed(4);
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
  document.querySelector("#indEMA50").textContent = ind.ema50 ? ind.ema50.toFixed(4) : "-";
  document.querySelector("#indATR").textContent = ind.atr14 ? ind.atr14.toFixed(4) : "-";
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
