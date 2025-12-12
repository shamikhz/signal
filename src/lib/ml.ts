import fs from "fs";
import path from "path";
import { Candle } from "@/lib/types";
import { EMA, RSI, MACDSeries, ATR } from "@/lib/indicators";

type SerializedModel = {
  weights: number[];
  bias: number;
  learningRate: number;
  featureCount: number;
};

const DATA_DIR = path.join(process.cwd(), "data");
const MODEL_PATH = path.join(DATA_DIR, "model.json");

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export class OnlineLogisticRegression {
  weights: number[];
  bias: number;
  learningRate: number;
  featureCount: number;

  constructor(featureCount: number, learningRate = 0.01, init?: SerializedModel) {
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

  predictProba(x: number[]): number {
    if (x.length !== this.featureCount) throw new Error(`Feature length mismatch: expected ${this.featureCount}, got ${x.length}`);
    const z = this.bias + this.weights.reduce((acc, w, i) => acc + w * x[i], 0);
    return sigmoid(z);
  }

  update(x: number[], y: 0 | 1): number {
    const p = this.predictProba(x);
    const error = p - y; // derivative of log-loss wrt z
    // SGD update
    for (let i = 0; i < this.featureCount; i++) {
      this.weights[i] -= this.learningRate * error * x[i];
    }
    this.bias -= this.learningRate * error;
    // Return log-loss for monitoring
    const eps = 1e-12;
    const loss = -(y * Math.log(p + eps) + (1 - y) * Math.log(1 - p + eps));
    return loss;
  }

  serialize(): SerializedModel {
    return {
      weights: this.weights,
      bias: this.bias,
      learningRate: this.learningRate,
      featureCount: this.featureCount,
    };
  }
}

export function ensureModelStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadModel(): OnlineLogisticRegression | null {
  ensureModelStorage();
  if (!fs.existsSync(MODEL_PATH)) return null;
  const raw = fs.readFileSync(MODEL_PATH, "utf-8");
  const obj = JSON.parse(raw) as SerializedModel;
  return new OnlineLogisticRegression(obj.featureCount, obj.learningRate, obj);
}

export function saveModel(model: OnlineLogisticRegression): void {
  ensureModelStorage();
  fs.writeFileSync(MODEL_PATH, JSON.stringify(model.serialize(), null, 2), "utf-8");
}

/**
 * Extract numeric features from candles using indicators.
 * Keep features small and well-scaled for online learning stability.
 */
export function extractFeatures(candles: Candle[]): number[] {
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
  const ret1 = (last.close - prev.close) / Math.max(prev.close, 1e-6); // 1-bar return
  const e50 = ema50[n] ?? price;
  const e200 = ema200[n] ?? price;
  const rsi = rsi14[n] ?? 50;
  const macdHist = macd.histogram[n] ?? 0;
  const atr = atr14[n] ?? 0;

  // Normalize and construct features
  const rsiNorm = (rsi - 50) / 50;             // [-1, 1]
  const emaRatio = e200 ? e50 / e200 - 1 : 0;  // around [-0.2, 0.2] typically
  const macdNorm = macdHist / Math.max(price, 1e-6);
  const atrNorm = atr / Math.max(price, 1e-6);
  const aboveE50 = last.close > e50 ? 1 : 0;

  // Final feature vector
  const x = [
    ret1,
    rsiNorm,
    emaRatio,
    macdNorm,
    atrNorm,
    aboveE50,
  ];
  return x;
}

/**
 * Compute ML probability P(up) for the next bar using the current model and features.
 * Returns null if no model is present yet.
 */
export function computeMLProbability(candles: Candle[]): number | null {
  const model = loadModel();
  if (!model) return null;
  const x = extractFeatures(candles);
  // If model featureCount differs (e.g., features changed), reinit
  if (model.featureCount !== x.length) {
    const newModel = new OnlineLogisticRegression(x.length, model.learningRate);
    saveModel(newModel);
    return null;
  }
  return model.predictProba(x);
}