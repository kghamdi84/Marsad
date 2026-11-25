# ADR 0024: The trade journal and the adherence score

- Status: accepted
- Date: 2026-11-25
- Version: `journal-1`

## Context

The brief asks for a journal of the trades Khaled placed in Sahm, linked to the alert that prompted them, with tags and screenshots, a Jimmy D adherence score and statistics by setup. Jimmy D's principles: patience, process, strict risk, clean setups, taking profits, and no emotional bias.

## Decision

- **Trades** (personal table `trades`, MFA required): ticker, side, setup (a playbook id or Khaled's own name), tags, an optional link to an alert, entry and exit, stop and target, the five pre-trade checklist items, four "followed" items (stop placed, sized by the sizer, exit followed the plan, no chasing or revenge), notes and up to six screenshots. A trade is either open or fully closed (the database refuses an exit date without a price, or before the entry).
- **Adherence score** (`journal.ts`): the share of applicable items honored: the five checklist items, the four followed items (the exit item only once closed) and a named setup. An unanswered item counts as not honored. Each principle shows its own count, and every broken item is listed in plain words. The score measures the process, not the result.
- **Statistics by setup**: closed and open counts, win rate, mean R over trades with a stop, realized USD, mean adherence, flagged "insufficient history" under 30 closed trades. A comparison of mean R at adherence 80 or above against below 80 shows whether following the process paid, once each side has 30 trades.
- **Screenshots**: a private Storage bucket `journal` (PNG, JPEG or WebP up to 5 MB). Objects live under the owner's id as the first folder; one policy allows read and write only to that owner with an MFA session. The app downloads each image and shows it from a local `blob:` URL, so the strict Content Security Policy needs no change. A PGlite stand-in for Storage tests the policy offline (owner, another user, no MFA, anon).

## Consequences

- The weekly AI review (7.8) can read the broken items and the statistics once an Anthropic key and caps are set.
- If Khaled deletes a trade row, its screenshots stay in Storage until removed; deletion is not offered in the app yet (trades are history).
