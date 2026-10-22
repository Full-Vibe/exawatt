---
exawatt-roadmap: v1
---

# dispatch-engine roadmap

The optimizer that decides, every five minutes, whether each enrolled site
charges, holds, or sells — and what we bid into the market on its behalf.

## Now

### DSP-31 Nodal price forecast refit

Status: active-build — summer telemetry is in; shadow bidding started 2026-07-30.

Scope:

- retrain the nodal LMP forecaster on May-July actuals from the pilot fleet
- add ORDC adder and hub-to-node basis features for the ERCOT entry
- shadow-bid the refit model against production for ten trading days

Exit criteria:

- backtest MAE under 4.1 $/MWh on the holdout week
- shadow P&L within 2% of production on calm days, better on scarcity days

Milestones:

- [x] F1 Feature backfill from pilot telemetry
- F2 Model refit and holdout eval (landed 2026-07-28)
- [ ] F3 Ten-day shadow bidding run
- [ ] F4 Production cutover behind the bid safety rails

## Next

### DSP-32 Bid curve safety rails

Status: planned — hard ceilings and monotonicity checks before any model cutover.

Scope:

- reject non-monotone bid curves before submission
- clamp bids to per-site battery warranty limits

### DSP-33 Ancillary services co-optimization

Status: planned — bid energy and reserves jointly instead of energy-only.

## Later

### DSP-34 Sub-hourly redispatch

Status: later — re-optimize inside the operating hour when telemetry diverges from plan.

## Shipped

### DSP-30 Deterministic dispatch backtest harness

Status: done — landed 2026-07-24; every strategy change replays the same twelve market days.

### DSP-27 Day-ahead bidding v1

Status: done — landed 2026-06-30; first revenue week cleared 2026-07-06.
