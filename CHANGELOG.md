# 0.0.2

- https://github.com/brunocalado/epic-3d-card-reveal/issues/2
- Added Tarot-style **reversed cards**: an opt-in `reversalChance` (0–100) gives each shown card that percent chance of appearing upside-down in the 3D viewer. Off by default — set the chance on a macro/API call (or the Macro Builder's *Reversed chance* slider) to enable it. The orientation is re-rolled on every display; the card's chat text is unchanged, while the chat thumbnail mirrors the orientation and is tagged "Reversed". Re-opening a card from chat keeps the published orientation.