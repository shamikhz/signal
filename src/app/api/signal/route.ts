import { NextResponse } from "next/server";
import { Candle, SignalResponse } from "@/lib/types";
import { computeTradeSignal } from "@/lib/signal";
import { computeMLProbability } from "@/lib/ml";

export const dynamic = "force-dynamic"; // avoid static caching

const ALLOWED_INTERVALS = new Set(["1m", "5m", "15m", "30m", "1h", "4h", "1d"]);

function parseBinanceKlines(raw: unknown[]): Candle[] {
  // Binance kline: [ openTime, open, high, low, close, volume, closeTime, ...]
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

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "BTCUSDT").toUpperCase();
  const interval = (searchParams.get("interval") || "1h").toLowerCase();

  if (!ALLOWED_INTERVALS.has(interval)) {
    return NextResponse.json({ error: `Invalid interval. Use one of: ${Array.from(ALLOWED_INTERVALS).join(", ")}` }, { status: 400 });
  }

  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=500`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Binance API error: ${text}` }, { status: res.status });
    }
    const raw = await res.json();
    const candles = parseBinanceKlines(raw);

    const { signal, indicators } = computeTradeSignal(candles);
    const last = candles[candles.length - 1];

    const mlProbability = computeMLProbability(candles) ?? undefined;

    const body: SignalResponse = {
      symbol,
      interval,
      timestamp: last.closeTime,
      lastPrice: last.close,
      signal,
      indicators,
      mlProbability,
    };

    return NextResponse.json(body);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
