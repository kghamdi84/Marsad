# ADR 0036: Quarterly risk-factor updates from 10-Q filings

- Status: accepted
- Date: 2026-11-25
- Version: `tenq-1`

## Context

Checklist 2.5 asks for 10-K and 10-Q sections. The vendor's sections feed covers 10-Ks only (ADR for riskdiff-1), so quarterly reports need the filing documents themselves. Part II, Item 1A of a 10-Q either lists risk factors added or changed since the annual report or says there were none.

## Decision

- **Source**: the SEC filings job already stores each company's filings with the primary document name. A new step in the SEC filings workflow (`sec tenq`) downloads the two newest 10-Q documents per stock from SEC archives, each once (stored accessions are skipped), with the declared User-Agent and the shared `sec-api` concurrency group.
- **Extraction** (`tenq.ts`, pure): filing HTML to text (hidden inline-XBRL header, scripts and styles removed; entities decoded), then the "Item 1A. Risk Factors" heading that starts a line and is followed by the longest stretch before "Item 2. Unregistered ..." (the table of contents repeats the heading; a cross-reference inside a sentence is not a heading). Testing on four real filings (NVIDIA and Rocket Lab, recorded 2026-11-25) found both problems and fixed them.
- **"No material changes"**: true only when unqualified. "Other than the risk factors listed below, there have been no material changes" lists changes, so it is not "no change" (all four real filings are of this kind).
- **Storage**: `quarterly_sections` (owner read). A document whose section cannot be found is named in the run details and not stored; a failed download fails the run.
- **Display**: the company page shows the newest quarter's section as filed, whether it lists changes, and a sentence-level comparison with the previous quarter using the 10-K engine (`riskdiff-1`).

## Consequences

- The HTML heading rules may miss unusual layouts; such filings are listed as unreadable, never shown as empty.
