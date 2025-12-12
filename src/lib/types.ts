export type Candle = {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
};

export type MACD = {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
};

export type IndicatorsSummary = {
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macd: {
    macd: number | null;
    signal: number | null;
    histogram: number | null;
  };
  atr14: number | null;
  twoPole: number | null;
  srChannel: {
    support: number | null;
    resistance: number | null;
    width: number | null;
  };
};

export type TradeSignal = {
  action: "buy" | "sell" | "hold";
  confidence: number; // 0..1
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reasons: string[];
};

export type SignalResponse = {
  symbol: string;
  interval: string;
  timestamp: number;
  lastPrice: number;
  signal: TradeSignal;
  indicators: IndicatorsSummary;
  mlProbability?: number; // optional P(up) from ML model
};
