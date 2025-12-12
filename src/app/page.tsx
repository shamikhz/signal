"use client";

import { useState } from "react";
import type { SignalResponse } from "@/lib/types";

export default function HomePage() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState("1h");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SignalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchSignal(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/signal?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Request failed");
      setResult(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: 24, fontFamily: "system-ui" }}>
      <h1>Crypto Signal (Rule-based, ML-ready)</h1>
      <p style={{ color: "#666" }}>
        Enter a symbol and interval to compute a buy/sell/hold signal with entry, stop-loss, and take-profit.
        This tool is for educational purposes only and not financial advice.
      </p>

      <form onSubmit={fetchSignal} style={{ display: "flex", gap: 12, alignItems: "flex-end", marginTop: 16 }}>
        <div>
          <label>Symbol</label><br />
          <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                 placeholder="BTCUSDT" style={{ padding: 8, width: 160 }} />
        </div>
        <div>
          <label>Interval</label><br />
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            style={{
              padding: 8,
              backgroundColor: "#2b2b2b",
              color: "#ffffff",
              border: "1px solid #444",
              borderRadius: 4
            }}
          >
            <option value="1m">1m</option>
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="30m">30m</option>
            <option value="1h">1h</option>
            <option value="4h">4h</option>
            <option value="1d">1d</option>
          </select>
        </div>
        <button type="submit" disabled={loading} style={{ padding: "8px 16px" }}>
          {loading ? "Loading..." : "Get Signal"}
        </button>
      </form>

      {error && <p style={{ color: "red", marginTop: 16 }}>Error: {error}</p>}

      {result && (
        <section style={{ marginTop: 24, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
          <h2>
            {result.symbol} — {result.interval} — {new Date(result.timestamp).toLocaleString()}
          </h2>
          <p>Last Price: <strong>{result.lastPrice.toFixed(2)}</strong></p>
          {typeof result.mlProbability === "number" && (
            <p>Model P(up): <strong>{(result.mlProbability * 100).toFixed(1)}%</strong></p>
          )}
          <p>
            Action: <strong style={{
              color:
                result.signal.action === "buy" ? "green" :
                result.signal.action === "sell" ? "crimson" : "gray"
            }}>{result.signal.action.toUpperCase()}</strong>{" "}
            (confidence {(result.signal.confidence * 100).toFixed(0)}%)
          </p>
          <ul>
            <li>Entry: {result.signal.entry.toFixed(2)}</li>
            <li>Stop Loss: {result.signal.stopLoss.toFixed(2)}</li>
            <li>Take Profit: {result.signal.takeProfit.toFixed(2)}</li>
          </ul>
          {Array.isArray(result.signal.reasons) && result.signal.reasons.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h3>Reasons</h3>
              <ul>
                {result.signal.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
