import { Candle, MACD } from "@/lib/types";

/**
 * Simple Moving Average
 */
export function SMA(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential Moving Average
 */
export function EMA(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (period <= 0) return out;
  const k = 2 / (period + 1);
  let emaPrev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    const price = values[i];
    if (i === period - 1) {
      // seed with SMA
      let sum = 0;
      for (let j = i - (period - 1); j <= i; j++) sum += values[j];
      emaPrev = sum / period;
      out[i] = emaPrev;
    } else if (i >= period) {
      emaPrev = price * k + (emaPrev as number) * (1 - k);
      out[i] = emaPrev;
    }
  }
  return out;
}

/**
 * RSI (Wilder's smoothing)
 */
export function RSI(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(closes.length).fill(null);
  if (period <= 0 || closes.length < period + 1) return out;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses -= change; // negative change -> add absolute
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

/**
 * MACD (12, 26, 9 by default)
 */
export function MACDSeries(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): MACD {
  const emaFast = EMA(closes, fast);
  const emaSlow = EMA(closes, slow);
  const macd: (number | null)[] = Array(closes.length).fill(null);

  for (let i = 0; i < closes.length; i++) {
    if (emaFast[i] != null && emaSlow[i] != null) {
      macd[i] = (emaFast[i] as number) - (emaSlow[i] as number);
    }
  }

  const macdNumbers = macd.map((v) => (v == null ? 0 : v));
  const signal = EMA(macdNumbers, signalPeriod);
  const histogram: (number | null)[] = Array(closes.length).fill(null);
  for (let i = 0; i < closes.length; i++) {
    if (macd[i] != null && signal[i] != null) {
      histogram[i] = (macd[i] as number) - (signal[i] as number);
    }
  }

  return { macd, signal, histogram };
}

/**
 * ATR (Wilder’s smoothing)
 */
export function ATR(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = Array(candles.length).fill(null);
  if (candles.length < period) return out;

  const TRs: number[] = [];
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

  // Wilder’s smoothing
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

/**
 * Utility: detect cross over/under between two series at the latest bar
 */
export function crossedAbove(a: (number | null)[], b: (number | null)[]): boolean {
  const n = a.length - 1;
  if (n < 1 || a[n] == null || b[n] == null || a[n - 1] == null || b[n - 1] == null) return false;
  return (a[n - 1] as number) <= (b[n - 1] as number) && (a[n] as number) > (b[n] as number);
}

export function crossedBelow(a: (number | null)[], b: (number | null)[]): boolean {
  const n = a.length - 1;
  if (n < 1 || a[n] == null || b[n] == null || a[n - 1] == null || b[n - 1] == null) return false;
  return (a[n - 1] as number) >= (b[n - 1] as number) && (a[n] as number) < (b[n] as number);
}

export function TwoPoleOscillator(values: number[], period = 20): (number | null)[] {
  const out: (number | null)[] = Array(values.length).fill(null);
  if (period <= 1 || values.length < period) return out;
  const a = Math.exp(-Math.sqrt(2) * Math.PI / period);
  const b = 2 * a * Math.cos(Math.sqrt(2) * Math.PI / period);
  const c2 = b;
  const c3 = -a * a;
  const c1 = 1 - c2 - c3;
  const filt: number[] = Array(values.length).fill(0);
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

export function SupportResistanceChannel(candles: Candle[], pivotLen = 5): { support: (number | null)[]; resistance: (number | null)[] } {
  const n = candles.length;
  const support: (number | null)[] = Array(n).fill(null);
  const resistance: (number | null)[] = Array(n).fill(null);
  let lastSupport: number | null = null;
  let lastResistance: number | null = null;
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
