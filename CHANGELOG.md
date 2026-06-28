# 0.0.4

- Polished the **Macro Builder**'s *Appearance* tab for readability: each setting is now boxed into its own card with a raised fill and a clear border, so every control and its explanatory note read as one unit instead of blurring into a single wall of text. Hints sit at full contrast inside their box, and the redundant "These settings apply to every macro type" line was removed.

# 0.0.3

- https://github.com/brunocalado/epic-3d-card-reveal/issues/1
- Added a **Send card description to chat** world setting (off by default). When enabled, the chat reveal also shows the card's description — pulled from the Card document's own description field, so lore-heavy decks like the **PF2e Harrow Deck** post their card text alongside the image. Rich text and `@UUID` links are rendered, not shown as raw markup. Cards with no description, and arbitrary images shown through the API, are unchanged.
- The description can also be toggled per macro: `Dealer.draw` / `Dealer.view` accept a `showDescription` override, and the **Macro Builder** shows a matching **Send card description** control for deck-based macro types (Draw / View).

# 0.0.2

- https://github.com/brunocalado/epic-3d-card-reveal/issues/2
- Added Tarot-style **reversed cards**: an opt-in `reversalChance` (0–100) gives each shown card that percent chance of appearing upside-down in the 3D viewer. Off by default — set the chance on a macro/API call (or the Macro Builder's *Reversed chance* slider) to enable it. The orientation is re-rolled on every display; the card's chat text is unchanged, while the chat thumbnail mirrors the orientation and is tagged "Reversed". Re-opening a card from chat keeps the published orientation.