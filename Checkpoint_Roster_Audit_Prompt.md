# Checkpoint — Member Roster & Account Coverage Audit

Read-mostly diagnostic pass, plus safe data backfill. No account creation, no emails sent — those come after this pass. All open questions below are now resolved by Joseph — nothing left to guess at.

## Git workflow (same rules as every prior pass)

Work on `main` in this exact repo location, branch off for any actual writes (`feature/roster-audit`), commit as you go, push, open a PR — do not push to `main` directly (branch protection blocks it anyway). If this task ends up being read-only (no Member records actually need changes), say so plainly rather than opening an empty PR.

## Known roster (from the reconciled financial report, 11 total)

Ansgar Kabutelana, Elias Wakara, Emmanuel Gidamis, Gibson Mulokozi, Ignas Lukanga, Jakob Daniel, Joseph Masonda, Peter Lema, Samwel Lembele, William Mattao (all Active), Abubakari Meza (Former / Y1 only).

## Contact details recovered so far (from a Group TIN Registration CSV)

| Roster name | Email | Phone |
|---|---|---|
| Jakob Daniel | jakobdaniel284@gmail.com | 750948655 |
| Ignas Lukanga | ignaslukanga@gmail.com | 0766463591 |
| Gibson Mulokozi | ggmulokozi@outlook.com | +255759708948 |
| William Mattao | williammattao@gmail.com | 0743058380 |
| Ansgar Kabutelana | ansgarthomsy@gmail.com | 0656807111 |
| Peter Lema | peterwilliamlema@gmail.com | 0745265621 |
| Emmanuel Gidamis | gidamisemmanuel@gmail.com | 0750477898 |
| Elias Wakara | prosperelias924@gmail.com | 255625756424 |
| Samwel Lembele → rename to Samwel Allen Ephraim | sam.allen471@gmail.com | +255717424453 |

All three previously-open questions are now resolved by Joseph:
- **Elias Wakara**: full legal name is Elias Prosper Wakara, contact details above — treat like the other 7 confirmed matches.
- **Samwel**: confirmed the same person as the CSV's "Samwel Allen Ephraim" entry. Rename this `Member` record's `name` field from "Samwel Lembele" to "Samwel Allen Ephraim" and apply the email/phone above. This is a display-name change only — the record's numeric `id` doesn't change, so it shouldn't affect any relational data (contributions/loans/fines/transactions all key off `member_id`, not name). Double-check nothing in the codebase does name-string matching instead of id matching before assuming this is fully safe — if you find anything that does, flag it rather than silently proceeding.
- **Abubakari Meza**: confirmed no account needed. Leave his `Member` record untouched, don't create a `User` for him, and exclude him from any "needs an account" follow-up list you produce.

## Tasks

1. Pull the live `Member` collection and the live `User` collection (via the app / a local script against the same MongoDB the production API uses — check `backend/db/mongoose.js` / `.env` for the connection). For each of the 10 active roster members (exclude Abubakari — former, no account needed), report: does a `Member` record exist, does a linked `User` record exist (`User.member_id` pointing to it), what's currently in `Member.email` / `Member.phone` (empty or populated), and what `User.status` is (active/disabled).
2. For all 9 confirmed matches in the table above (7 originals + Elias + Samwel): if the corresponding `Member` record's `email` or `phone` field is empty or clearly stale, update it from the table via a direct, logged update (not a bulk blind overwrite — skip any record where the existing value looks intentionally different rather than just missing, and note that skip in your report rather than overwriting silently). Apply the Samwel rename as part of this same update.
3. Produce a clear gap table in your final report: member name | has Member record | has linked User account | email present | phone present | flagged issue (if any) — for the 10 active members only. This is the input Joseph needs to decide who still needs an account created and who needs an updated welcome/credentials email once that's greenlit — don't create accounts or send anything yet, this pass is audit + safe backfill only.

## Non-goals for this pass

- No new `User` accounts created.
- No emails sent (the mailer is still disconnected post-migration anyway, tracked separately).
- No changes to Abubakari Meza's record — the one exception to the backfill above, leave him exactly as-is.
- No changes to any member's financial data (contributions, loans, fines) — this is contact-info and account-coverage only.

## Verification

- Report the gap table above in full, not summarized.
- Confirm via `git diff` (if any Member records were updated) exactly which fields changed for which members, pasted in the report.
- Standard proof-of-push: `git log --oneline -10`, `git status`, and the PR link or `gh pr create` output — same as every prior pass.

---

## Separate, unrelated task — bundle into the same branch/PR since it's small

The `?` help icon on stat cards (`frontend/src/member/components/Primitives.jsx`, `StatCard`'s `help` prop) currently just renders a static `HelpCircle` icon with no click behavior — dead UI. Make it functional:

1. Change `StatCard`'s `help` prop from a boolean flag to accept explanation content (e.g. `help={{ title, body }}` or similar — your call on the exact shape, but it needs to carry real text, not just `true`). Keep backward compatibility unnecessary — update every call site in the same pass.
2. Clicking the `?` opens a small modal/popover (reuse whatever modal pattern already exists in the codebase, e.g. `components/UI.jsx`'s `Modal` if it fits the light theme cleanly, or a lightweight new one scoped to `.theme-member` if not) showing the title and explanation body. Dismissible via click-outside or a close button, matching existing modal conventions in this app.
3. Wire real explanation copy into every existing `help` usage — don't leave placeholder text. Use this content:

   **Dashboard.jsx:**
   - *Group Cash at Bank*: "The total confirmed cash currently held by the club (M-Koba balance), shared across all members. Updates whenever contributions, loan disbursements, repayments, or expenses are recorded."
   - *My Total Contribution (FY{year})*: "The total you've contributed so far in the current fiscal year (March–February cycle). Only contributions marked as paid or recorded count toward this."
   - *My Active Loan Balance*: "The remaining balance on your currently active loan(s) — principal minus what you've repaid so far. Zero if you have no active loan."
   - *My Unpaid Fines*: "Fines issued to you that are still marked unpaid. These are typically issued for late or missed monthly contributions."

   **Contributions.jsx:**
   - *Total Contributed*: "The sum of your contributions recorded for the fiscal year selected above."
   - *Year Target*: "Your monthly contribution rate × 12 months — what you're expected to contribute across the full fiscal year if you pay every month."
   - *Rate*: "The required monthly contribution amount, set by the club's rules for this fiscal year. Can change year to year if the club votes to adjust it."
   - *Compliance*: "The share of elapsed months this fiscal year you've actually paid for — months paid ÷ months elapsed so far, not months paid ÷ 12, so this won't look low just because the year isn't over yet."

4. Verify by actually clicking each `?` in a local run and confirming the right explanation shows for the right card — don't just confirm it compiles.
