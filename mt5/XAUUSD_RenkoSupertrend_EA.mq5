//+------------------------------------------------------------------+
//|                                   XAUUSD_RenkoSupertrend_EA.mq5  |
//|  Renko + Supertrend strategy for XM Global MT5 (XAUUSD)          |
//|                                                                  |
//|  Strategy                                                        |
//|  --------                                                        |
//|  * Renko bricks (default box size $1) are built internally from  |
//|    live ticks, because MT5 has no native Renko chart.            |
//|  * Supertrend (default ATR 7, multiplier 3.1) is computed on the |
//|    Renko brick series, not on time candles.                      |
//|  * BUY  : Supertrend flips green and the Renko brick closes      |
//|           above the line -> suggested entry = that brick close.  |
//|  * SELL : mirror of the above.                                   |
//|  * Entry slippage guard: the market entry is only taken while    |
//|    price is within $1 (input) of the suggested entry level. If   |
//|    the entry is missed, the level stays armed and the trade      |
//|    triggers when price returns to it (while the Supertrend       |
//|    direction is unchanged).                                      |
//|  * Exit / stops:                                                 |
//|      - Supertrend flip against the position closes it.           |
//|      - Hard max stop loss $6 (input) from entry.                 |
//|      - Trailing: at +$3 profit SL moves to break-even; after     |
//|        that, every further +$2 move lifts the SL by $1.          |
//|  * Chart: Renko bricks, Supertrend line, suggested-entry line    |
//|    and live SL line are all drawn on the chart.                  |
//+------------------------------------------------------------------+
#property copyright "mayankdoshi"
#property link      ""
#property version   "1.00"
#property description "Renko + Supertrend EA for XAUUSD on XM Global MT5"

#include <Trade\Trade.mqh>

//--- inputs -------------------------------------------------------
input group "=== Renko ==="
input double InpBoxSize        = 1.0;      // Renko box size ($)
input int    InpWarmupM1Bars   = 3000;     // M1 history bars used to warm up Renko/Supertrend

input group "=== Supertrend (on Renko bricks) ==="
input int    InpAtrPeriod      = 7;        // Supertrend ATR period
input double InpAtrMultiplier  = 3.1;      // Supertrend ATR multiplier

input group "=== Trading ==="
input double InpLots           = 0.01;     // Lot size
input double InpMaxSlippage    = 1.0;      // Max entry slippage from suggested entry ($)
input double InpMaxStopLoss    = 6.0;      // Max (initial) stop loss ($)
input double InpBreakevenMove  = 3.0;      // Profit ($) at which SL moves to entry
input double InpTrailStep      = 2.0;      // Extra profit ($) per trailing step
input double InpTrailAmount    = 1.0;      // SL improvement ($) per trailing step
input long   InpMagic          = 20260718; // Magic number

input group "=== Display ==="
input bool   InpDrawBricks     = true;     // Draw Renko bricks
input bool   InpDrawSupertrend = true;     // Draw Supertrend line
input int    InpMaxBricksDrawn = 300;      // Max bricks/segments kept on chart
input color  InpBullBrickColor = clrLimeGreen;
input color  InpBearBrickColor = clrTomato;
input color  InpStUpColor      = clrLime;
input color  InpStDownColor    = clrRed;
input color  InpEntryLineColor = clrYellow;
input color  InpSlLineColor    = clrOrangeRed;

//--- Renko brick --------------------------------------------------
struct RenkoBrick
  {
   double   open;
   double   close;
   double   high;
   double   low;
   datetime start_time;
   datetime end_time;
   bool     bullish;
  };

//--- globals ------------------------------------------------------
CTrade      g_trade;

RenkoBrick  g_bricks[];
int         g_brickCount   = 0;

double      g_tr[];          // true range per brick
double      g_atr[];         // Wilder ATR per brick
double      g_finalUpper[];  // Supertrend final upper band
double      g_finalLower[];  // Supertrend final lower band
double      g_st[];          // Supertrend line value per brick
int         g_trend[];       // +1 up (green), -1 down (red), 0 not ready

bool        g_seeded       = false;  // Renko anchor initialised
double      g_anchor       = 0.0;    // grid anchor before first brick
bool        g_warmup       = true;   // true while replaying history (no trading/drawing)

int         g_pendingDir   = 0;      // +1 armed buy, -1 armed sell, 0 none
double      g_pendingEntry = 0.0;    // suggested entry level (signal brick close)
bool        g_pendingActive= false;  // entry level currently armed

const string OBJ_PREFIX = "RST_";

//+------------------------------------------------------------------+
//| Initialisation                                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpBoxSize <= 0 || InpAtrPeriod < 2 || InpAtrMultiplier <= 0 ||
      InpLots <= 0 || InpMaxStopLoss <= 0 || InpTrailStep <= 0)
     {
      Print("Invalid input parameters");
      return(INIT_PARAMETERS_INCORRECT);
     }

   if(StringFind(_Symbol, "XAU") < 0 && StringFind(_Symbol, "GOLD") < 0)
      Print("Warning: EA was designed for XAUUSD, running on ", _Symbol);

   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints((ulong)MathMax(1.0, InpMaxSlippage / _Point));

   ArrayResize(g_bricks, 0, 8192);

   WarmupFromHistory();
   g_warmup = false;

   RedrawHistory();

   // Re-arm the last signal after (re)start if we are flat.
   if(g_pendingDir != 0 && !HasOpenPosition())
      g_pendingActive = true;

   PrintFormat("Init done: %d bricks from history, trend=%s, pending entry=%s",
               g_brickCount, TrendText(),
               g_pendingActive ? DoubleToString(g_pendingEntry, _Digits) : "none");
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   ObjectsDeleteAll(0, OBJ_PREFIX);
   Comment("");
  }

//+------------------------------------------------------------------+
//| Main tick handler                                                |
//+------------------------------------------------------------------+
void OnTick()
  {
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(bid <= 0)
      return;

   UpdateRenko(bid, TimeCurrent());
   ManagePosition();
   TryPendingEntry();
   UpdateLines();
   UpdatePanel();
  }

//+------------------------------------------------------------------+
//| Replay M1 closes through the Renko engine to seed everything     |
//+------------------------------------------------------------------+
void WarmupFromHistory()
  {
   MqlRates rates[];
   ArraySetAsSeries(rates, false); // oldest first
   int copied = CopyRates(_Symbol, PERIOD_M1, 1, InpWarmupM1Bars, rates);
   if(copied <= 0)
     {
      Print("Warmup: no M1 history available yet (", GetLastError(), ")");
      return;
     }
   for(int i = 0; i < copied; i++)
      UpdateRenko(rates[i].close, rates[i].time);
  }

//+------------------------------------------------------------------+
//| Renko engine: create bricks as price crosses box boundaries      |
//+------------------------------------------------------------------+
void UpdateRenko(double price, datetime t)
  {
   if(!g_seeded)
     {
      g_anchor = MathFloor(price / InpBoxSize) * InpBoxSize;
      g_seeded = true;
      return;
     }

   if(g_brickCount == 0)
     {
      while(price >= g_anchor + InpBoxSize)
        {
         AddBrick(g_anchor, g_anchor + InpBoxSize, t, true);
         g_anchor += InpBoxSize;
        }
      while(price <= g_anchor - InpBoxSize)
        {
         AddBrick(g_anchor, g_anchor - InpBoxSize, t, false);
         g_anchor -= InpBoxSize;
        }
      return;
     }

   bool created = true;
   while(created)
     {
      created = false;
      double lastOpen  = g_bricks[g_brickCount - 1].open;
      double lastClose = g_bricks[g_brickCount - 1].close;
      bool   lastBull  = g_bricks[g_brickCount - 1].bullish;

      if(lastBull)
        {
         if(price >= lastClose + InpBoxSize)
           { AddBrick(lastClose, lastClose + InpBoxSize, t, true);  created = true; }
         else if(price <= lastOpen - InpBoxSize)   // reversal needs 2 boxes
           { AddBrick(lastOpen, lastOpen - InpBoxSize, t, false);   created = true; }
        }
      else
        {
         if(price <= lastClose - InpBoxSize)
           { AddBrick(lastClose, lastClose - InpBoxSize, t, false); created = true; }
         else if(price >= lastOpen + InpBoxSize)   // reversal needs 2 boxes
           { AddBrick(lastOpen, lastOpen + InpBoxSize, t, true);    created = true; }
        }
     }
  }

//+------------------------------------------------------------------+
//| Append a closed brick, update Supertrend, detect signals, draw   |
//+------------------------------------------------------------------+
void AddBrick(double open, double close, datetime t, bool bullish)
  {
   int i = g_brickCount;
   ArrayResize(g_bricks, i + 1, 8192);
   ArrayResize(g_tr, i + 1, 8192);
   ArrayResize(g_atr, i + 1, 8192);
   ArrayResize(g_finalUpper, i + 1, 8192);
   ArrayResize(g_finalLower, i + 1, 8192);
   ArrayResize(g_st, i + 1, 8192);
   ArrayResize(g_trend, i + 1, 8192);

   g_bricks[i].open       = open;
   g_bricks[i].close      = close;
   g_bricks[i].high       = MathMax(open, close);
   g_bricks[i].low        = MathMin(open, close);
   g_bricks[i].bullish    = bullish;
   g_bricks[i].start_time = (i > 0) ? g_bricks[i - 1].end_time : t - 60;
   g_bricks[i].end_time   = (t > g_bricks[i].start_time) ? t : g_bricks[i].start_time + 1;
   g_brickCount++;

   ComputeSupertrend(i);

   if(i > 0 && g_trend[i] != 0 && g_trend[i - 1] != 0 && g_trend[i] != g_trend[i - 1])
      OnSupertrendFlip(i);

   if(!g_warmup)
     {
      DrawBrick(i);
      DrawStSegment(i);
      TrimOldDrawings(i);
     }
  }

//+------------------------------------------------------------------+
//| Supertrend on the Renko series (Wilder ATR)                      |
//+------------------------------------------------------------------+
void ComputeSupertrend(int i)
  {
   // True range
   if(i == 0)
      g_tr[i] = g_bricks[i].high - g_bricks[i].low;
   else
      g_tr[i] = MathMax(g_bricks[i].high - g_bricks[i].low,
                MathMax(MathAbs(g_bricks[i].high - g_bricks[i - 1].close),
                        MathAbs(g_bricks[i].low  - g_bricks[i - 1].close)));

   // Wilder ATR
   if(i < InpAtrPeriod - 1)
      g_atr[i] = 0.0;
   else if(i == InpAtrPeriod - 1)
     {
      double sum = 0.0;
      for(int k = 0; k <= i; k++)
         sum += g_tr[k];
      g_atr[i] = sum / InpAtrPeriod;
     }
   else
      g_atr[i] = (g_atr[i - 1] * (InpAtrPeriod - 1) + g_tr[i]) / InpAtrPeriod;

   if(g_atr[i] <= 0.0)
     {
      g_finalUpper[i] = 0.0;
      g_finalLower[i] = 0.0;
      g_st[i]         = 0.0;
      g_trend[i]      = 0;
      return;
     }

   double hl2        = (g_bricks[i].high + g_bricks[i].low) / 2.0;
   double basicUpper = hl2 + InpAtrMultiplier * g_atr[i];
   double basicLower = hl2 - InpAtrMultiplier * g_atr[i];

   if(i == 0 || g_trend[i - 1] == 0)
     {
      // First valid brick: seed the trend with the brick direction.
      g_finalUpper[i] = basicUpper;
      g_finalLower[i] = basicLower;
      g_trend[i]      = g_bricks[i].bullish ? 1 : -1;
      g_st[i]         = (g_trend[i] == 1) ? g_finalLower[i] : g_finalUpper[i];
      return;
     }

   g_finalUpper[i] = (basicUpper < g_finalUpper[i - 1] || g_bricks[i - 1].close > g_finalUpper[i - 1])
                     ? basicUpper : g_finalUpper[i - 1];
   g_finalLower[i] = (basicLower > g_finalLower[i - 1] || g_bricks[i - 1].close < g_finalLower[i - 1])
                     ? basicLower : g_finalLower[i - 1];

   if(g_trend[i - 1] == 1)
      g_trend[i] = (g_bricks[i].close < g_finalLower[i]) ? -1 : 1;
   else
      g_trend[i] = (g_bricks[i].close > g_finalUpper[i]) ? 1 : -1;

   g_st[i] = (g_trend[i] == 1) ? g_finalLower[i] : g_finalUpper[i];
  }

//+------------------------------------------------------------------+
//| Supertrend direction change on a closed Renko brick              |
//+------------------------------------------------------------------+
void OnSupertrendFlip(int i)
  {
   int    dir   = g_trend[i];           // new direction
   double entry = g_bricks[i].close;    // brick closed across the line

   // Arm (or re-arm) the suggested entry level. Stays armed until
   // filled or until the Supertrend flips again.
   g_pendingDir    = dir;
   g_pendingEntry  = entry;
   g_pendingActive = !g_warmup;

   if(g_warmup)
      return;

   // Flip exit: close a position that is against the new direction.
   if(HasOpenPosition())
     {
      long type = PositionGetInteger(POSITION_TYPE);
      if((dir == 1 && type == POSITION_TYPE_SELL) ||
         (dir == -1 && type == POSITION_TYPE_BUY))
        {
         if(g_trade.PositionClose(_Symbol))
            PrintFormat("Supertrend flip: closed %s position",
                        type == POSITION_TYPE_BUY ? "BUY" : "SELL");
         else
            PrintFormat("Flip close failed: %d / %s",
                        g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
        }
      else
         g_pendingActive = false; // already positioned in the new direction
     }

   PrintFormat("Supertrend flipped %s. Suggested entry %s",
               dir == 1 ? "GREEN (buy)" : "RED (sell)",
               DoubleToString(entry, _Digits));
  }

//+------------------------------------------------------------------+
//| Enter when price is within MaxSlippage of the armed entry level. |
//| Also covers the "price came back to the missed entry" case.      |
//+------------------------------------------------------------------+
void TryPendingEntry()
  {
   if(!g_pendingActive || g_warmup || g_pendingDir == 0)
      return;
   if(HasOpenPosition())
      return;

   double vol = NormalizeVolume(InpLots);
   if(vol <= 0)
      return;

   if(g_pendingDir == 1)
     {
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      if(ask <= g_pendingEntry + InpMaxSlippage)
        {
         double sl = NormalizeDouble(ask - InpMaxStopLoss, _Digits);
         if(g_trade.Buy(vol, _Symbol, 0.0, sl, 0.0, "RenkoST buy"))
           {
            g_pendingActive = false;
            PrintFormat("BUY filled near %s (suggested %s), SL %s",
                        DoubleToString(ask, _Digits),
                        DoubleToString(g_pendingEntry, _Digits),
                        DoubleToString(sl, _Digits));
           }
         else
            PrintFormat("Buy failed: %d / %s",
                        g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
        }
     }
   else
     {
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      if(bid >= g_pendingEntry - InpMaxSlippage)
        {
         double sl = NormalizeDouble(bid + InpMaxStopLoss, _Digits);
         if(g_trade.Sell(vol, _Symbol, 0.0, sl, 0.0, "RenkoST sell"))
           {
            g_pendingActive = false;
            PrintFormat("SELL filled near %s (suggested %s), SL %s",
                        DoubleToString(bid, _Digits),
                        DoubleToString(g_pendingEntry, _Digits),
                        DoubleToString(sl, _Digits));
           }
         else
            PrintFormat("Sell failed: %d / %s",
                        g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
        }
     }
  }

//+------------------------------------------------------------------+
//| Break-even + step trailing stop                                  |
//| +$3 -> SL to entry; each further +$2 -> SL up another $1.        |
//+------------------------------------------------------------------+
void ManagePosition()
  {
   if(!HasOpenPosition())
      return;

   long   type  = PositionGetInteger(POSITION_TYPE);
   double entry = PositionGetDouble(POSITION_PRICE_OPEN);
   double sl    = PositionGetDouble(POSITION_SL);
   double tp    = PositionGetDouble(POSITION_TP);

   long   stopsLevel = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist    = stopsLevel * _Point;

   if(type == POSITION_TYPE_BUY)
     {
      double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      double profit = bid - entry;
      if(profit < InpBreakevenMove)
         return;
      int    steps   = (int)MathFloor((profit - InpBreakevenMove) / InpTrailStep);
      double desired = NormalizeDouble(entry + steps * InpTrailAmount, _Digits);
      if(desired > sl + _Point / 2.0 && bid - desired >= minDist)
         g_trade.PositionModify(_Symbol, desired, tp);
     }
   else
     {
      double ask    = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      double profit = entry - ask;
      if(profit < InpBreakevenMove)
         return;
      int    steps   = (int)MathFloor((profit - InpBreakevenMove) / InpTrailStep);
      double desired = NormalizeDouble(entry - steps * InpTrailAmount, _Digits);
      if((sl == 0.0 || desired < sl - _Point / 2.0) && desired - ask >= minDist)
         g_trade.PositionModify(_Symbol, desired, tp);
     }
  }

//+------------------------------------------------------------------+
//| Helpers                                                          |
//+------------------------------------------------------------------+
bool HasOpenPosition()
  {
   if(!PositionSelect(_Symbol))
      return(false);
   return(PositionGetInteger(POSITION_MAGIC) == InpMagic);
  }

double NormalizeVolume(double vol)
  {
   double minV = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxV = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0)
      step = minV;
   vol = MathRound(vol / step) * step;
   return(MathMax(minV, MathMin(maxV, vol)));
  }

string TrendText()
  {
   if(g_brickCount == 0 || g_trend[g_brickCount - 1] == 0)
      return("warming up");
   return(g_trend[g_brickCount - 1] == 1 ? "GREEN (up)" : "RED (down)");
  }

//+------------------------------------------------------------------+
//| Drawing: Renko bricks                                            |
//+------------------------------------------------------------------+
void DrawBrick(int i)
  {
   if(!InpDrawBricks)
      return;
   string name = OBJ_PREFIX + "BRK_" + IntegerToString(i);
   if(!ObjectCreate(0, name, OBJ_RECTANGLE, 0,
                    g_bricks[i].start_time, g_bricks[i].open,
                    g_bricks[i].end_time,   g_bricks[i].close))
      return;
   color c = g_bricks[i].bullish ? InpBullBrickColor : InpBearBrickColor;
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_FILL, true);
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
  }

//+------------------------------------------------------------------+
//| Drawing: Supertrend segment between brick i-1 and i              |
//+------------------------------------------------------------------+
void DrawStSegment(int i)
  {
   if(!InpDrawSupertrend || i == 0)
      return;
   if(g_st[i] == 0.0 || g_st[i - 1] == 0.0)
      return;
   // On a flip, start the new segment at the new line value so the
   // line does not draw a vertical jump through price.
   double from = (g_trend[i] == g_trend[i - 1]) ? g_st[i - 1] : g_st[i];
   string name = OBJ_PREFIX + "ST_" + IntegerToString(i);
   if(!ObjectCreate(0, name, OBJ_TREND, 0,
                    g_bricks[i - 1].end_time, from,
                    g_bricks[i].end_time,     g_st[i]))
      return;
   color c = (g_trend[i] == 1) ? InpStUpColor : InpStDownColor;
   ObjectSetInteger(0, name, OBJPROP_COLOR, c);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 2);
   ObjectSetInteger(0, name, OBJPROP_RAY_RIGHT, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, name, OBJPROP_HIDDEN, true);
  }

void TrimOldDrawings(int i)
  {
   int old = i - InpMaxBricksDrawn;
   if(old < 0)
      return;
   ObjectDelete(0, OBJ_PREFIX + "BRK_" + IntegerToString(old));
   ObjectDelete(0, OBJ_PREFIX + "ST_" + IntegerToString(old));
  }

//+------------------------------------------------------------------+
//| Redraw the last N bricks / segments after warmup or restart      |
//+------------------------------------------------------------------+
void RedrawHistory()
  {
   int from = MathMax(0, g_brickCount - InpMaxBricksDrawn);
   for(int i = from; i < g_brickCount; i++)
     {
      DrawBrick(i);
      DrawStSegment(i);
     }
   ChartRedraw();
  }

//+------------------------------------------------------------------+
//| Suggested-entry and SL horizontal lines                          |
//+------------------------------------------------------------------+
void UpdateLines()
  {
   string entryName = OBJ_PREFIX + "ENTRY";
   string slName    = OBJ_PREFIX + "SL";

   bool inPos = HasOpenPosition();

   // Entry line: armed pending level, or actual entry while in a trade.
   double entryLevel = 0.0;
   string entryText  = "";
   if(inPos)
     {
      entryLevel = PositionGetDouble(POSITION_PRICE_OPEN);
      entryText  = "Entry " + DoubleToString(entryLevel, _Digits);
     }
   else if(g_pendingActive)
     {
      entryLevel = g_pendingEntry;
      entryText  = StringFormat("Suggested %s entry %s",
                                g_pendingDir == 1 ? "BUY" : "SELL",
                                DoubleToString(entryLevel, _Digits));
     }

   if(entryLevel > 0.0)
     {
      if(ObjectFind(0, entryName) < 0)
         ObjectCreate(0, entryName, OBJ_HLINE, 0, 0, entryLevel);
      ObjectSetDouble(0, entryName, OBJPROP_PRICE, entryLevel);
      ObjectSetInteger(0, entryName, OBJPROP_COLOR, InpEntryLineColor);
      ObjectSetInteger(0, entryName, OBJPROP_STYLE, STYLE_DASH);
      ObjectSetInteger(0, entryName, OBJPROP_SELECTABLE, false);
      ObjectSetString(0, entryName, OBJPROP_TEXT, entryText);
     }
   else
      ObjectDelete(0, entryName);

   // SL line: only while in a trade.
   if(inPos && PositionGetDouble(POSITION_SL) > 0.0)
     {
      double sl = PositionGetDouble(POSITION_SL);
      if(ObjectFind(0, slName) < 0)
         ObjectCreate(0, slName, OBJ_HLINE, 0, 0, sl);
      ObjectSetDouble(0, slName, OBJPROP_PRICE, sl);
      ObjectSetInteger(0, slName, OBJPROP_COLOR, InpSlLineColor);
      ObjectSetInteger(0, slName, OBJPROP_STYLE, STYLE_DASHDOT);
      ObjectSetInteger(0, slName, OBJPROP_SELECTABLE, false);
      ObjectSetString(0, slName, OBJPROP_TEXT, "SL " + DoubleToString(sl, _Digits));
     }
   else
      ObjectDelete(0, slName);
  }

//+------------------------------------------------------------------+
//| On-chart status panel                                            |
//+------------------------------------------------------------------+
void UpdatePanel()
  {
   string pos = "flat";
   if(HasOpenPosition())
     {
      long   type  = PositionGetInteger(POSITION_TYPE);
      double entry = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl    = PositionGetDouble(POSITION_SL);
      pos = StringFormat("%s @ %s  SL %s",
                         type == POSITION_TYPE_BUY ? "LONG" : "SHORT",
                         DoubleToString(entry, _Digits),
                         DoubleToString(sl, _Digits));
     }
   string pending = g_pendingActive
                    ? StringFormat("%s @ %s (max slippage $%.2f)",
                                   g_pendingDir == 1 ? "BUY" : "SELL",
                                   DoubleToString(g_pendingEntry, _Digits),
                                   InpMaxSlippage)
                    : "none";
   Comment(StringFormat(
      "Renko Supertrend EA  |  %s\n"
      "Box: $%.2f   Supertrend: (%d, %.1f) on Renko\n"
      "Bricks: %d   Trend: %s\n"
      "Armed entry: %s\n"
      "Position: %s",
      _Symbol, InpBoxSize, InpAtrPeriod, InpAtrMultiplier,
      g_brickCount, TrendText(), pending, pos));
  }
//+------------------------------------------------------------------+
