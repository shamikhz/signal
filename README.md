# Crypto Signal Master

**Crypto Signal Master** is an advanced, client-side trading signal generator that combines traditional technical analysis with a **shared, decentralized Machine Learning model**.

## Key Features

-   **Real-Time Signals**: Fetches live market data from Binance API to generate Buy/Sell/Hold signals.
-   **Hybrid Logic**: Uses a combination of technical indicators (RSI, MACD, EMA, ATR, Price Action) and a Logistic Regression ML model.
-   **Shared "Hive Mind" Learning**: The unique "Train Model" feature allows any user to train the model on local browser data. The updated model weights are saved to a shared **Firebase Firestore** database, meaning every user contributes to a single, evolving global model.
-   **Smart UI**: Hides training controls when the model effectively solves the current market context (0 loss), preventing overfitting on solved data.
-   **Detailed Analytics**: Provides precise entry, stop-loss, and take-profit targets with 4-decimal precision, along with confidence scores and specific reasoning for every signal.

## Tech Stack

-   **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+ Modules).
-   **Backend / Database**: Firebase Firestore (for storing the shared ML model).
-   **Data Source**: Binance Public Data API.
-   **ML Engine**: Custom `OnlineLogisticRegression` implemented in pure JavaScript.

## How to Run

Simply open `index.html` in any modern web browser. No build step required for the core application.
