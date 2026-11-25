# ADR 0027: Optional Shariah screening aid

- Status: accepted
- Date: 2026-11-25
- Version: `shariah-1`

## Context

The brief asks for an optional Shariah screen, off by default: debt, cash and non-permissible income ratios against configurable thresholds, labeled as a screening aid, with Sahm's own labels taking precedence.

## Decision

- Off by default (`user_settings.shariah_screen`). Khaled switches it on and sets the basis (market capitalization or total assets) and the debt and cash limits on the Status page. Defaults: market capitalization and 33%; AAOIFI's published limit is 30% on market capitalization, and several index providers use 33%.
- Ratios come from the stored SEC filings as known on the Financials panel's date: long-term debt and cash and cash equivalents from the latest balance sheet, market capitalization as the last close times the cover-page shares outstanding filed by then. A ratio passes when it is below the limit; a missing input makes the verdict "cannot be judged", never a pass.
- What the screen cannot see is always shown with it: business activity and non-permissible income (not in the stored filings), short-term debt (not stored, so the debt ratio can be understated) and interest-bearing securities (not included in cash). The verdict is at most "passes the financial ratios".

## Consequences

- A fuller screen needs revenue by activity and interest income, which would come from filing text or a data provider; noted in IDEAS.
