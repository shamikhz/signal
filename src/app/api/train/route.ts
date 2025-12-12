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

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const symbol = (body?.symbol || "BTCUSDT").toUpperCase();
    const interval = (body?.interval || "1h").toLowerCase();
    const label = body?.label as 0 | 1;

    if (!ALLOWED_INTERVALS.has(interval)) {
      return NextResponse.json({ error: `Invalid interval. Use one of: ${Array.from(ALLOWED_INTERVALS).join(", ")}` }, { status: 400 });
    }
    if (label !== 0 && label !== 1) {
      return NextResponse.json({ error: "Label must be 0 or 1" }, { status: 400 });
    }

    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=500`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Binance API error: ${text}` }, { status: res.status });
    }
    const raw = await res.json();
    const candles = parseBinanceKlines(raw);

    const x = extractFeatures(candles);
    let model = loadModel();
    if (!model) {
      model = new OnlineLogisticRegression(x.length, 0.01);
    } else if (model.featureCount !== x.length) {
      model = new OnlineLogisticRegression(x.length, model.learningRate);
    }

    const loss = model.update(x, label);
    saveModel(model);

    return NextResponse.json({
      ok: true,
      symbol,
      interval,
      label,
      loss,
      weightsPreview: model.weights.slice(0, 4), // small preview
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
