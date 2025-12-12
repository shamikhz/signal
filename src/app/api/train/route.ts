import { NextResponse } from "next/server";
import { Candle } from "@/lib/types";
import { OnlineLogisticRegression, loadModel, saveModel, extractFeatures } from "@/lib/ml";

export const dynamic = "force-dynamic";

const ALLOWED_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

function parseBinanceKlines(raw: unknown[]): Candle[] {
  return raw.map((k) => {
    const t = k as [number | string, number | string, number | string, number | string, number | string, number | string, number | string, ...unknown[]];
    return {
      openTime: Number(t[0]),
      open: Number(t[1]),
      high: Number(t[2]),
      low: Number(t[3]),
      close: Number(t[4]),
      volume: Number(t[5]),
      closeTime: Number(t[6]),
    };
  });
}

const MAX_HISTORY = 500;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const symbol = (body?.symbol || "BTCUSDT").toUpperCase();
    const interval = (body?.interval || "1h").toLowerCase();

    // Optional manual override
    const manualLabel = body?.label;

    if (!ALLOWED_INTERVALS.has(interval)) {
      return NextResponse.json({ error: `Invalid interval. Use one of: ${Array.from(ALLOWED_INTERVALS).join(", ")}` }, { status: 400 });
    }

    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${MAX_HISTORY}`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Binance API error: ${text}` }, { status: res.status });
    }
    const raw = await res.json();
    const candles = parseBinanceKlines(raw);

    // Initialize model if needed
    // We need at least enough candles for features (200 for EMA200)
    if (candles.length < 205) {
      return NextResponse.json({ ok: false, message: "Not enough data to train" });
    }

    // 1. Extract features for all candles where possible
    // Extract features returns array for last candle, we need to extract for history
    // But current extractFeatures implementation is designed for SINGLE (last) candle.
    // We will iterate.

    let model = loadModel();
    // Dummy init to get feature count if no model exists
    if (!model) {
      const dummyX = extractFeatures(candles.slice(0, 201));
      model = new OnlineLogisticRegression(dummyX.length, 0.01);
    }

    let trainedCount = 0;
    let totalLoss = 0;

    // 2. Walk forward simulation
    // We start from index 200 (need 200 for indicators)
    // We go up to candles.length - 1.
    // For each 'i', we pretend we are at that time. 
    // We compute signal/trade. If trade taken, we verify outcome in future candles.

    // We need to import checkTradeOutcome and computeTradeSignal logic
    // Since signal logic is in signal.ts and coupled with "last candle", we might need to slice
    // optimization: recreating slices is expensive but safe.

    const { computeTradeSignal } = await import("@/lib/signal"); // Dynamic import to avoid cycles if any
    const { checkTradeOutcome } = await import("@/lib/ml");

    for (let i = 200; i < candles.length - 1; i++) {
      const history = candles.slice(0, i + 1);
      const currentCandle = history[history.length - 1];

      // Compute features for THIS moment
      const x = extractFeatures(history);

      // Predict current probability (optional, to log or threshold)
      // const prob = model.predictProba(x);

      // Get Rule-based signal to see if we WOULD have entered
      // For RL, we want to train the model to predict "Win" (1) or "Loss" (0).
      // So we look if a trade would be triggered OR just check theoretical outcome of a Long?
      // Let's assume we want to learn "Is this a good Long entry?"
      // So we assume Long entry at Close.

      // Define simple RL parameters
      const atr = 0; // We define stops dynamically or use ATR?
      // Let's use the logic from signal.ts for SL/TP if possible, or simplified 2% rule.
      // Re-using signal.ts logic is better but complex to extract without refactor.
      // Let's use the actual signal output.

      const signalResult = computeTradeSignal(history);
      const { action, stopLoss, takeProfit, entry } = signalResult.signal;

      if (action === "buy" && stopLoss && takeProfit) {
        const outcome = checkTradeOutcome(candles, i + 1, entry, stopLoss, takeProfit, true);
        if (outcome !== null) {
          // Outcome 1 = Win (Target Hit), 0 = Loss (Stop Hit)
          // Train model!
          const loss = model.update(x, outcome as 0 | 1);
          totalLoss += loss;
          trainedCount++;
        }
      }
      // Could also handle Short if model supported it (currently binary prob usually implies Long strength)
    }

    saveModel(model);

    return NextResponse.json({
      ok: true,
      symbol,
      interval,
      trainedCount,
      avgLoss: trainedCount > 0 ? totalLoss / trainedCount : 0,
      weightsPreview: model.weights.slice(0, 4),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
