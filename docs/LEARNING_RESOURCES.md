# Data Workshop & Algo Trading — Learning Resources

Curated, authentic learning material for the workshop curriculum (strategy, stochastic modeling, algorithmic planning, and execution). Sources are limited to **official documentation**, **peer-reviewed papers**, **established open-source repositories**, and **legitimate free books**.

---

## Quick start bundle (covers ~80% of the curriculum)

| # | Resource | Link |
|---|----------|------|
| 1 | ML4T workflow (notebooks + code) | https://github.com/stefan-jansen/machine-learning-for-trading |
| 2 | Factor investing + autoencoders (free book) | https://www.mlfactor.com |
| 3 | GARCH / volatility modeling | https://github.com/bashtage/arch |
| 4 | Adaptive SuperTrend + clustering | https://github.com/coding-kitties/PyIndicators |
| 5 | HMM market regime detection | https://github.com/ItsSawhill/market-regime-detection |
| 6 | Cointegration / pairs trading | https://github.com/MatyDiop/Cointrader |
| 7 | Portfolio optimization | https://github.com/pyportfolio/pyportfolioopt |
| 8 | Fyers API (official) | https://myapi.fyers.in/docsv3 |
| 9 | Firstock API (official) | https://firstock.in/api/docs/login/ |
| 10 | India VIX methodology (NSE PDF) | https://nsearchives.nseindia.com/web/sites/default/files/inline-files/white_paper_IndiaVIX.pdf |

---

## Week-by-week notebook plan

Use this schedule to map workshop days to concrete reading, notebooks, and exercises. **India data path:** pull OHLCV via Fyers or Firstock; fall back to `yfinance` (`^NSEI`, `^NSEBANK`, individual `.NS` tickers) for offline practice.

### Week 0 — Day 0: Onboarding & setup

| Day | Topic | Read / watch | Run / build | India exercise |
|-----|-------|--------------|-------------|----------------|
| 0.1 | Python + Git | [Python tutorial](https://docs.python.org/3/tutorial/), [Git docs](https://git-scm.com/doc) | Clone ML4T repo, create venv | `git clone` + `pip install -r requirements.txt` (ML4T `second-edition` branch) |
| 0.2 | Cursor IDE | [Cursor docs](https://cursor.com/docs) | Open repo in Cursor, run one notebook | Ask Cursor to explain `indicators.js` in this repo |
| 0.3 | Antigravity | [antigravity.google](https://antigravity.google/) | [MCP workshop repo](https://github.com/korniichuk/agentic-ai-in-practice-dawts-2026) | Build a tiny MCP tool: `get_nifty_quote()` |
| 0.4 | Fyers API | [Fyers v3 docs](https://myapi.fyers.in/docsv3), [fyers-skills](https://github.com/FyersDev/fyers-skills) | OAuth login → `history` candles → `quotes` | Fetch 1 year of `NSE:NIFTY50-INDEX` daily bars |
| 0.5 | Firstock API | [Login docs](https://firstock.in/api/docs/login/), [Python SDK](https://github.com/the-firstock/firstock-developer-sdk-python) | Login with TOTP → order book → time-price series | Same Nifty history via Firstock; compare to Fyers |

**Deliverable:** `.env` with broker credentials; script that saves Nifty/Bank Nifty daily CSV to `data/`.

---

### Week 1 — Day 1: Foundations

#### Day 1.1 — Adaptive SuperTrend

| Resource | Type | Link |
|----------|------|------|
| PyIndicators (SuperTrend + K-means clustering) | GitHub | https://github.com/coding-kitties/PyIndicators |
| Adaptive SuperTrend + K-Means article | Article | https://entreprenerdly.com/trading-signals-with-adaptive-supertrend-and-k-means/ |

**Notebook plan:**
1. Install: `pip install pyindicators` (or clone PyIndicators).
2. Load Nifty daily OHLCV.
3. Run `supertrend_basic(atr_length=10, factor=3.0)` — plot trend flips.
4. Run `supertrend_clustering(min_mult=1.0, max_mult=5.0, from_cluster='best')` — compare fixed vs adaptive factor.
5. Backtest: long when trend=1, flat when trend=0; report Sharpe and max drawdown.

**India exercise:** Run on `NSE:NIFTY50-INDEX`, `NSE:NIFTYBANK-INDEX`, and one liquid stock (`NSE:RELIANCE-EQ`).

---

#### Day 1.2 — Probability, Bayes, conditional probability

| Resource | Type | Link |
|----------|------|------|
| Probability fundamentals for quant finance | Interactive + PDF | https://mbrenndoerfer.com/writing/probability-theory-fundamentals-quantitative-finance |
| Bayesian statistics in algo trading | Article | https://blog.quantinsti.com/introduction-to-bayesian-statistics-in-finance/ |
| Bayesian ML chapter (ML4T) | Notebook | https://github.com/stefan-jansen/machine-learning-for-trading/tree/main/10_bayesian_machine_learning |

**Notebook plan:**
1. Read conditional probability + Bayes sections (Brenndoerfer).
2. ML4T: run `bayesian_sharpe_ratio` notebook — compare two strategies' posterior Sharpe.
3. ML4T: run `rolling_regression` — Bayesian hedge ratio for a Nifty/Bank Nifty pair.
4. Implement a simple Naive Bayes classifier: P(up \| gap-up, high volume) from historical opens.

**India exercise:** Estimate P(gap-up \| prior day red candle) on Nifty daily data.

---

#### Day 1.3 — Target vs stop-loss probability (volatility-based)

| Resource | Type | Link |
|----------|------|------|
| TP/SL barrier math | Article | https://crosstrade.io/blog/your-tp-sl-ratio-is-not-a-strategy |
| Stop placement + win-rate geometry | Article | https://retired.today/blog/stop-loss-placement |
| ATR-based stops | Reference | Welles Wilder, *New Concepts in Technical Trading Systems* (1978) |

**Key formulas:**
- Fair process (no drift): `P(hit target a before stop b) = b / (a + b)`
- ATR stop: `stop_distance = k × ATR(n)` (typically k=2, n=14)

**Notebook plan:**
1. Compute 14-day ATR on Nifty.
2. Set target = 2×ATR, stop = 1×ATR; simulate 1000 Monte Carlo paths; compare hit rates to `b/(a+b)`.
3. Build a table: for RR ratios 1:1, 2:1, 3:1 → required win rate vs fair win rate.
4. Add transaction costs (0.1% round trip) → revised break-even win rate.

**India exercise:** Use India VIX to scale ATR multiplier (high VIX → wider stops).

---

#### Day 1.4 — Gap analysis

| Resource | Type | Link |
|----------|------|------|
| Gap trading intro + pandas backtest | Article | https://medium.datadriveninvestor.com/introduction-to-gap-trading-with-a-backtest-in-python-c00db7289498 |
| Gap & Go / Gap & Fade | Article | https://medium.datadriveninvestor.com/backtesting-a-gap-trading-strategy-with-python-690bc09be563 |
| Backtrader framework | GitHub | https://github.com/mementum/backtrader |

**Notebook plan:**
1. Define partial gap-up: `open > prev_close`; partial gap-down: `open < prev_close`.
2. Define full gap-up: `open > prev_high`; full gap-down: `open < prev_low`.
3. Backtest intraday: enter at open, exit at close (long gap-up, short gap-down).
4. Split results by gap size decile and by India VIX regime (VIX < 15 vs VIX > 20).
5. Optional: implement Gap-and-Go vs Gap-and-Fade logic from Medium article.

**India exercise:** Run on Nifty 50 constituents with Fyers 5-min intraday history.

---

#### Day 1.5 — HMM / Markov regime detection

| Resource | Type | Link |
|----------|------|------|
| HMM practical guide | Tutorial | https://regimeforecast.com/blog/hidden-markov-models-market-regimes-python |
| HMM + regime-aware backtest | Tutorial | https://www.pythonandtrading.com/detect-market-regimes-hmm-python/ |
| QuantStart HMM chapter (PDF) | PDF | https://www.quantstart.com/static/ebooks/aat/sample.pdf |
| market-regime-detection | GitHub | https://github.com/ItsSawhill/market-regime-detection |
| macro_regime (walk-forward HMM) | GitHub | https://github.com/ShrishDhuria/macro_regime |
| hmmlearn | GitHub | https://github.com/hmmlearn/hmmlearn |

**Notebook plan:**
1. Features: daily log-returns + 20-day rolling volatility.
2. Fit `GaussianHMM(n_components=3)` on Nifty returns (2015–2022).
3. Remap states by mean return: bull / sideways / bear.
4. Walk-forward: refit every 252 days; predict regime out-of-sample (2023–2025).
5. Regime-aware strategy: trend-follow in bull, mean-revert in sideways, cash in bear.
6. Clone and run `ItsSawhill/market-regime-detection` for comparison.

**Critical:** Never fit HMM on the full sample and backtest on the same data — use walk-forward.

**India exercise:** Add Bank Nifty as a second feature; compare 2-state vs 3-state models.

---

#### Day 1.6 — Volume profile

| Resource | Type | Link |
|----------|------|------|
| VolumeProfile implementation | GitHub | https://github.com/srlcarlg/srl-python-indicators/blob/master/volume_profile.py |
| Market Profile concepts | Book | *Mind Over Markets* — Dalton, Jones, Kilroy |

**Notebook plan:**
1. Build a simple volume-at-price histogram from 5-min OHLCV (no tick data needed).
2. Compute POC (price with max volume), Value Area (70% volume band).
3. Identify HVN (high volume nodes) and LVN (low volume nodes).
4. Optional: fit Gaussian mixture on volume distribution to find modes.
5. Overlay POC/VA on a price chart for one stock over 5 sessions.

**India exercise:** Volume profile on `NSE:RELIANCE-EQ` using Fyers intraday candles.

---

#### Day 1.7 — Cointegration & pairs trading

| Resource | Type | Link |
|----------|------|------|
| Pairs trading workflow | Tutorial | https://quantbrainai.net/blog/pairs-trading-cointegration-methodology/ |
| Stat Arb Research Platform | GitHub | https://github.com/rcodeborg2311/Statistical-Arbitrage-Research-Platform |
| Cointrader (Kalman hedge ratio) | GitHub | https://github.com/MatyDiop/Cointrader |
| statistical-arbitrage-engine | GitHub | https://github.com/Pooja2420/statistical-arbitrage-engine |
| Engle-Granger paper | PDF | https://cowles.yale.edu/sites/default/files/files/pub/d08/d0815.pdf |

**Notebook plan:**
1. Screen Nifty 50 pairs: Engle-Granger test (`statsmodels.tsa.stattools.coint`), p < 0.05.
2. Build spread: `Y - β×X` via OLS; z-score with 30-day rolling window.
3. Signals: long spread at z < -2, short at z > +2, exit near z ≈ 0.
4. Upgrade: Kalman filter for dynamic β (see Cointrader).
5. Walk-forward: re-select pairs every 6 months.

**India exercise:** Test HDFC Bank / ICICI Bank, TCS / Infosys, Nifty / Bank Nifty.

---

#### Day 1.8 — Screeners & portfolio selection

| Resource | Type | Link |
|----------|------|------|
| yass (point-in-time screener) | GitHub | https://github.com/jamesjxliao/yass |
| AlphaSift (multi-factor + LLM) | GitHub | https://github.com/ZhuLinsen/alphasift |
| WorldQuant 101 Alphas | Paper | https://arxiv.org/abs/1601.00991 |
| PyPortfolioOpt | GitHub | https://github.com/pyportfolio/pyportfolioopt |
| Riskfolio-Lib | GitHub | https://github.com/dcajasn/Riskfolio-Lib |

**Notebook plan:**
1. **Fundamental screener:** ROE > 15%, D/E < 1, revenue growth > 10% (Screener.in export or manual list).
2. **Technical screener:** price > 200 SMA, RSI 40–60, volume > 1.5× 20-day avg.
3. **Momentum screener:** 12-1 month return rank top quintile.
4. Combine scores → top 10 names.
5. **Portfolio:** PyPortfolioOpt max-Sharpe on selected names; compare to equal-weight.
6. **Risk profiles:** min-variance (conservative), max-Sharpe (moderate), momentum tilt (aggressive).

**India exercise:** Use this repo's DarvaX scanner output as one screener input (`npm run darvax:scan`).

---

### Week 2 — Day 2: Advanced execution

#### Day 2.1 — GARCH volatility forecasting

| Resource | Type | Link |
|----------|------|------|
| arch library | GitHub | https://github.com/bashtage/arch |
| GJR-GARCH on NIFTY 50 | Tutorial | https://blog.quantinsti.com/garch-gjr-garch-volatility-forecasting-python/ |
| garch-risk-analytics | GitHub | https://github.com/Aneesh2409/garch-risk-analytics |
| India VIX + GARCH (peer-reviewed) | PDF | https://doi.org/10.18488/journal.aefr.2021.113.252.262 |

**Notebook plan:**
1. Nifty daily returns → fit GARCH(1,1), GJR-GARCH(1,1), EGARCH(1,1).
2. Compare AIC/BIC; forecast 1-day ahead volatility.
3. Rolling walk-forward: refit every 60 days; evaluate with QLIKE loss.
4. Generate 95% VaR from GARCH σ; backtest breach ratio (Kupiec test).
5. Compare GARCH forecast vs India VIX implied vol.

**India exercise:** Fit GARCH on India VIX series itself (download from NSE/Fyers).

---

#### Day 2.2 — VIX / expiry range forecasting

| Resource | Type | Link |
|----------|------|------|
| India VIX white paper | NSE PDF | https://nsearchives.nseindia.com/web/sites/default/files/inline-files/white_paper_IndiaVIX.pdf |
| NSE India VIX page | Official | https://www.nseindia.com/static/products-services/indices-indiavix-index |
| Fyers option chain + India VIX | Docs | https://github.com/FyersDev/fyers-skills/blob/master/skills/fyers-trading/references/market-data.md |
| Global VIX → India VIX | PDF | https://www.academia.edu/92740509/Role_of_the_Global_Volatility_Indices_in_Predicting_the_Volatility_Index_of_the_Indian_Economy |

**Practitioner formulas:**
- Daily expected move (%) ≈ `India VIX / 19.1`
- 30-day range: `Spot × (1 ± VIX/√12 / 100)`
- Expected points: `(VIX/19.1) × Spot / 100`

**Notebook plan:**
1. Read NSE white paper; understand OTM option strip + cubic spline.
2. Pull India VIX + Nifty spot daily; compute realized vs implied vol spread.
3. Build range calculator: given VIX and spot → S1/R1 for the session.
4. GARCH forecast + VIX → blended range estimate.
5. **LLM layer (optional):** feed structured JSON (VIX, GARCH σ, OI, PCR) to an LLM; ask for 3 scenario ranges with reasoning — use LLM for synthesis, not primary math.

**India exercise:** Compare predicted range vs actual high-low on expiry days (Thu for Nifty weekly).

---

#### Day 2.3 — Deep learning factor models & autoencoders

| Resource | Type | Link |
|----------|------|------|
| ML for Factor Investing (free book) | Online | https://www.mlfactor.com |
| Book code + data | GitHub | https://github.com/shokru/mlfactor.github.io |
| Python port | GitHub | https://github.com/viniesposito/py-mlfactor |
| Gu, Kelly, Xiu (ML asset pricing) | NBER PDF | https://www.nber.org/system/files/working_papers/w25398/w25398.pdf |
| CD-DFM | GitHub | https://github.com/alexouadi/CD-DFM |
| PRISM-VQ | GitHub | https://github.com/finxlab/PRISM-VQ |
| ml-quant-trading (213 factors) | GitHub | https://github.com/initial-d/ml-quant-trading |
| Autoencoder exercise (Ch. 7) | Online | https://www.mlfactor.com/solutions-to-exercises.html |

**Notebook plan:**
1. Read mlfactor.com Ch. 1–3 (notations, factor zoo, prediction).
2. Read Gu-Kelly-Xiu NBER paper — understand cross-sectional ML for returns.
3. Run mlfactor autoencoder exercise (Ch. 7) — factor side + beta side networks.
4. Explore `initial-d/ml-quant-trading`: 213 factors → Markowitz portfolio.
5. Compare: PCA factors vs autoencoder factors vs raw characteristics.

**India exercise:** Adapt factor inputs to NSE data (PE, PB, momentum, volatility from Screener.in + price history).

---

#### Day 2.4 — Algorithmic execution framework

| Resource | Type | Link |
|----------|------|------|
| Jesse algo framework | GitHub | https://github.com/jesse-ai/jesse |
| Backtrader | GitHub | https://github.com/mementum/backtrader |
| Zipline Reloaded | GitHub | https://github.com/stefan-jansen/zipline-reloaded |
| Fyers agent skills | GitHub | https://github.com/FyersDev/fyers-skills |
| Antigravity + MCP workshop | GitHub | https://github.com/korniichuk/agentic-ai-in-practice-dawts-2026 |

**Suggested execution stack:**
```
Data (Fyers/Firstock) → Indicators (PyIndicators) → Signals → Backtest (Backtrader/Jesse)
  → Paper trade → Live (broker SDK) → Agent layer (Cursor/Antigravity + MCP)
```

**Notebook plan:**
1. Wrap Day 1 SuperTrend signal in Backtrader `Strategy` class.
2. Add GARCH-based position sizing from Day 2.1.
3. Add regime filter from Day 1.5 HMM (no trades in bear regime).
4. Paper trade via Fyers place_order (dry-run first — see fyers-skills safety rules).
5. Build MCP server with tools: `get_quote`, `get_history`, `place_order`, `get_positions`.

**India exercise:** Connect to this repo's Dhan feed as alternative data source (`backend/dhanHistorical.js`).

---

#### Day 2.5 — Capstone: full pipeline

**Build one end-to-end system:**

1. **Universe:** Nifty 50 or Nifty 500 (this repo's `backend/universe/nse500.json`).
2. **Regime:** HMM 3-state on Nifty → gate all strategies.
3. **Signals:** Adaptive SuperTrend (trend) + cointegration pairs (mean reversion in sideways).
4. **Vol filter:** Skip trades when GARCH σ > 95th percentile.
5. **Range:** India VIX → set bracket order distances.
6. **Portfolio:** PyPortfolioOpt max-Sharpe on selected names; max 5% per name.
7. **Execution:** Fyers/Firstock paper → live with `DARVAX_AUTO_TRADE=false` until validated.
8. **Monitoring:** Telegram alerts (this repo's `backend/telegramAlerts.js`).

**Deliverable:** Jupyter notebook or Python package with backtest report (Sharpe, max DD, win rate, regime breakdown).

---

## Reference books & PDFs

### Free and legitimate

| Title | Authors | Access |
|-------|---------|--------|
| Machine Learning for Factor Investing | Coqueret & Guida | https://www.mlfactor.com |
| Empirical Asset Pricing via ML | Gu, Kelly, Xiu | https://www.nber.org/system/files/working_papers/w25398/w25398.pdf |
| India VIX White Paper | NSE | https://nsearchives.nseindia.com/web/sites/default/files/inline-files/white_paper_IndiaVIX.pdf |
| QuantStart HMM chapter | QuantStart | https://www.quantstart.com/static/ebooks/aat/sample.pdf |
| Engle-Granger cointegration | Engle & Granger | https://cowles.yale.edu/sites/default/files/files/pub/d08/d0815.pdf |
| Options, Futures & Other Derivatives (older ed.) | John C. Hull | https://archive.org/details/optionsfuturesot00hull_1 (Internet Archive borrow) |

### Worth purchasing (industry standard)

| Title | Authors | Why |
|-------|---------|-----|
| Machine Learning for Trading (3rd ed.) | Stefan Jansen | End-to-end ML4T workflow; code at https://github.com/stefan-jansen/machine-learning-for-trading |
| Advances in Financial Machine Learning | Marcos López de Prado | Institutional ML rigor, backtesting, meta-labeling |
| Quantitative Trading | Ernest P. Chan | Practical systematic trading |
| Algorithmic Trading | Ernest P. Chan | Strategy rationale + implementation |
| Active Portfolio Management | Grinold & Kahn | Portfolio construction theory |
| Options, Futures & Other Derivatives (latest) | John C. Hull | Derivatives + vol modeling |

> Do not use pirated PDFs. Purchase books or use the free/legal sources above.

---

## Python environment (recommended)

```bash
python -m venv .venv-workshop
source .venv-workshop/bin/activate   # Windows: .venv-workshop\Scripts\activate

pip install \
  numpy pandas matplotlib seaborn scipy statsmodels \
  arch hmmlearn scikit-learn \
  backtrader pyportfolioopt \
  fyers-apiv3 firstock \
  yfinance pymc
```

For ML4T notebooks, follow https://github.com/stefan-jansen/machine-learning-for-trading/blob/main/docs/installation.md (Docker recommended).

---

## Topic index (all resources by curriculum item)

| Curriculum topic | Primary resources |
|------------------|-------------------|
| Adaptive SuperTrend | PyIndicators, Entreprenerdly article |
| Probability / Bayes | Brenndoerfer, QuantInsti, ML4T Ch. 10 |
| Target vs SL probability | Crosstrade, Retired.today, Wilder ATR |
| Gap analysis | Medium (2 articles), Backtrader |
| HMM regimes | regimeforecast.com, pythonandtrading.com, hmmlearn, QuantStart PDF |
| Volume profile | srl-python-indicators, Mind Over Markets |
| Cointegration | quantbrainai.net, Cointrader, Engle-Granger PDF |
| Screeners | yass, AlphaSift, WorldQuant 101 paper |
| Portfolio selection | PyPortfolioOpt, Riskfolio-Lib, Grinold & Kahn |
| GARCH / vol forecasting | arch, QuantInsti GJR-GARCH, garch-risk-analytics |
| India VIX / expiry range | NSE white paper, AEFR GARCH paper |
| DL factor models | mlfactor.com, Gu-Kelly-Xiu NBER, CD-DFM, PRISM-VQ |
| Algo execution | Jesse, Backtrader, Fyers skills, Antigravity MCP |
| Fyers API | myapi.fyers.in/docsv3, FyersDev/fyers-skills |
| Firstock API | firstock.in/api/docs, the-firstock/firstock-developer-sdk-python |
| Cursor / Antigravity | cursor.com/docs, antigravity.google |

---

## Connection to this repository

This repo (PowerBull Pro + DarvaX) already implements several workshop concepts:

| Workshop topic | Repo component |
|----------------|----------------|
| Technical indicators (EMA, RSI) | `backend/indicators.js` |
| Screener / strength scoring | `backend/darvaxEngine.js`, `backend/darvaxScanner.js` |
| Fundamental screener | `backend/screenerFundamentals.js` |
| Live broker feed | `backend/dhanFeed.js`, `backend/dhanHistorical.js` |
| Telegram alerts | `backend/telegramAlerts.js` |
| NSE universe | `backend/universe/nse500.json` |

Use the week-by-week plan above for **learning and research**; use this repo for **production-style scanning and alerts** on Dhan.

---

*Last updated: August 2026. Verify API docs and package versions before the workshop — broker APIs change frequently.*
