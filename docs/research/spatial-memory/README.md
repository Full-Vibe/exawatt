# Spatial Memory Research

Research in this directory is evidence, not product canon. Durable conclusions
must be promoted into product, engineering, marketing, or decision documents.

## Map-based visualizations increase recall accuracy of data

- Authors: Bahador Saket, Carlos Scheidegger, Stephen G. Kobourov, and Katy Börner
- Local artifact: `map-based-visualization-recall.pdf`
- Source URL: <https://www2.cs.arizona.edu/~kobourov/recall.pdf>
- Retrieved: 2026-07-10
- SHA-256: `7899315d3b8001b4e3d5593f9349bf1e4ac87775aab7adf19600f3082468ef73`

### Why Exawatt cares

The paper provides evidence that map-like visual organization can improve
people's recall of data location compared with non-map layouts. It supports the
hypothesis that Exawatt should give Projects and Agents stable spatial addresses
and avoid gratuitous reshuffling.

It does **not** prove that a specific grid, projection, game metaphor, or manual
layout system is correct for Exawatt. Product claims should remain narrow:
spatial stability can reduce reorientation cost, and the board should be tested
with Exawatt operators rather than presented as a universal cognitive result.

### Canon promoted from this evidence

- ENG-004 V2.0 treats deterministic placement and spatial stability as design
  constraints.
- Decision `0007` adopts the Spatial Operations Board.
- `docs/product/marketing.md` records a future manifesto/copy opportunity. Any
  public claim must cite the study accurately and avoid overstating causality.
