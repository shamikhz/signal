import { Candle, IndicatorsSummary, TradeSignal } from "@/lib/types";
import { EMA, RSI, MACDSeries, ATR, crossedAbove, crossedBelow, TwoPoleOscillator, SupportResistanceChannel } from "@/lib/indicators";

/**
 * Compute a rule-based trade signal and summarize indicators.
 * Future: replace scoring with ML model inference.
 */
export function computeTradeSignal(candles: Candle[]): { signal: TradeSignal; indicators: IndicatorsSummary } {
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
        ema50: null,
        ema200: null,
        rsi14: null,
        macd: { macd: null, signal: null, histogram: null },
        atr14: null,
        twoPole: null,
        srChannel: { support: null, resistance: null, width: null }
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

  const reasons: string[] = [];
  let longScore = 0;
  let shortScore = 0;

  // Trend bias
  if (E50 != null && E200 != null) {
    if ((E50 as number) > (E200 as number)) {
      longScore += 1; reasons.push("EMA50 > EMA200 (uptrend)");
    } else if ((E50 as number) < (E200 as number)) {
      shortScore += 1; reasons.push("EMA50 < EMA200 (downtrend)");
    }
  }

  // Price relative to EMA50
  if (E50 != null) {
    if (lastClose > (E50 as number)) { longScore += 0.5; reasons.push("Price > EMA50"); }
    else { shortScore += 0.5; reasons.push("Price < EMA50"); }
  }

  // RSI momentum
  if (R != null) {
    if ((R as number) >= 50 && (R as number) <= 70) { longScore += 1; reasons.push(`RSI=${R?.toFixed(1)} bullish zone`); }
    else if ((R as number) <= 50 && (R as number) >= 30) { shortScore += 1; reasons.push(`RSI=${R?.toFixed(1)} bearish zone`); }
    if ((R as number) > 70) reasons.push("RSI overbought");
    if ((R as number) < 30) reasons.push("RSI oversold");
  }

  // MACD signal cross
  const macdCrossUp = crossedAbove(macd.macd, macd.signal);
  const macdCrossDown = crossedBelow(macd.macd, macd.signal);
  if (macdCrossUp || (H != null && (H as number) > 0)) { longScore += 1; reasons.push("MACD bullish"); }
  if (macdCrossDown || (H != null && (H as number) < 0)) { shortScore += 1; reasons.push("MACD bearish"); }

  if (TP != null) {
    if ((TP as number) > 0) { longScore += 0.5; reasons.push("Two-pole oscillator bullish"); }
    else if ((TP as number) < 0) { shortScore += 0.5; reasons.push("Two-pole oscillator bearish"); }
  }

  if (Ssupport != null || Sresistance != null) {
    const atr = A != null ? (A as number) : Math.max(1e-6, lastClose * 0.002);
    if (Ssupport != null && Math.abs(lastClose - (Ssupport as number)) <= 0.5 * atr) {
      longScore += 0.5; reasons.push(`Near support ~${(Ssupport as number).toFixed(2)}`);
    }
    if (Sresistance != null && Math.abs((Sresistance as number) - lastClose) <= 0.5 * atr) {
      shortScore += 0.5; reasons.push(`Near resistance ~${(Sresistance as number).toFixed(2)}`);
    }
  }

  const scoreDiff = longScore - shortScore;
  let action: "buy" | "sell" | "hold" = "hold";
  if (scoreDiff >= 1) action = "buy";
  else if (scoreDiff <= -1) action = "sell";

  // Price levels via ATR-based volatility stops
  const atrMultStop = 1.5;
  const rr = 2.2; // desired RR
  const entry = lastClose;
  let stopLoss = lastClose;
  let takeProfit = lastClose;

  if (A != null) {
    const atr = A as number;
    if (action === "buy") {
      stopLoss = entry - atrMultStop * atr;
      takeProfit = entry + rr * (entry - stopLoss);
    } else if (action === "sell") {
      stopLoss = entry + atrMultStop * atr;
      takeProfit = entry - rr * (stopLoss - entry);
    } else {
      // hold: neutral levels
      stopLoss = entry - atrMultStop * atr;
      takeProfit = entry + atrMultStop * atr;
    }
  }

  // Enforce minimum risk-to-reward of 1:2
  let enforceHoldDueToRRR = false;
  if (action !== "hold") {
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    const rewardOverRisk = risk > 0 ? reward / risk : 0;
  
    if (A == null || risk <= 0 || rewardOverRisk < 2) {
      action = "hold";
      enforceHoldDueToRRR = true;
      reasons.push("Risk-to-reward below 1:2; forcing HOLD");
      // Re-center levels
      if (A != null) {
        const atr = A as number;
        stopLoss = entry - atrMultStop * atr;
        takeProfit = entry + atrMultStop * atr;
      } else {
        stopLoss = entry;
        takeProfit = entry;
      }
    }
  }

  // Confidence bounded 0.15..0.9 based on absolute score difference and indicator availability
  const indicatorsAvailable =
    (E50 != null ? 1 : 0) +
    (E200 != null ? 1 : 0) +
    (R != null ? 1 : 0) +
    (M != null && S != null ? 1 : 0) +
    (A != null ? 1 : 0);

  let confidence = Math.min(0.9, Math.max(0.15, Math.abs(scoreDiff) / 3));
  confidence = Math.min(confidence, 0.15 + 0.15 * indicatorsAvailable);
  if (enforceHoldDueToRRR) {
    confidence = Math.min(confidence, 0.15);
  }

  const indicators: IndicatorsSummary = {
    ema50: E50 ?? null,
    ema200: E200 ?? null,
    rsi14: R ?? null,
    macd: { macd: M ?? null, signal: S ?? null, histogram: H ?? null },
    atr14: A ?? null,
    twoPole: TP ?? null,
    srChannel: {
      support: Ssupport ?? null,
      resistance: Sresistance ?? null,
      width: Ssupport != null && Sresistance != null ? Math.max((Sresistance as number) - (Ssupport as number), 0) : null,
    }
  };

  return {
    signal: { action, confidence, entry, stopLoss, takeProfit, reasons },
    indicators
  };
}
