# Checkpoint — Member-Facing UI Redesign

First piece of the next phase (member dashboard redesign → member roster audit → reconnect automations → resend credentials). This covers just the redesign. Reference mockups are copied into the repo at `docs/design-reference/` (`member-dashboard.png`, `member-contributions.png`, `sign-in.png`, `sign-up.png`) so the coding agent can view them directly.

## Decisions locked in (don't re-litigate these)

- **Scope: member-facing views only.** Admin views (Overview, full Members, Loans, Transactions, Investments, Expenses, Settings, etc.) keep the current dark theme untouched. This redesign only touches: the member dashboard, member contributions page, sign-in, sign-up, and the shell (sidebar/topbar) those live in. Build it as a visually separate component tree so there's zero risk of regressing the admin UI.
- **Stat cards = mine + group aggregates**, not literal club-wide "Total Revenue/Loans/Fines" as labeled in the mockup. The mockup's visual pattern (icon, label, big number, trend line) stays; the actual metrics behind each card change to match what a member is allowed to see per the access-split work already shipped (`main` @ `2f7dcde` and later).
- **Sign-up is real self-service, but anchored to an existing Member record.** A stranger cannot register and get access. Signup succeeds only if the email or phone entered matches a `Member` record an admin already created (via the existing Members.jsx "Add Member" flow). On match, it creates a `User` with `role: 'member'` linked to that `member_id`. No path from the signup form ever creates `role: 'admin'`. If there's no match, show a clear error directing them to contact the treasurer — don't say "email already exists" vs "no such member" in a way that leaks which is true (avoid account enumeration), just a single generic "We couldn't verify that email/phone against our member records. Contact your treasurer to be added."

## Mockup → real data mapping

**Dashboard** (`docs/design-reference/member-dashboard.png`):
- Top banner ("Quarterly report is here / Download Now") → keep the visual pattern, wire it to the existing CSV/PDF export already built for Overview.jsx (`exportSummaryCSV`/`exportSummaryPDF` in `frontend/src/utils/exporter.js`), scoped to the member's own data only. Don't build new export logic if the existing one can be adapted.
- Stat card 1 "Total Revenue" → replace with **Group Cash at Bank** (aggregate, from `GET /api/summary/snapshot`).
- Stat card 2 "Total Contribution" → **My Total Contribution** (this FY, from `GET /api/members/me`).
- Stat card 3 "Total Loans" → **My Active Loan Balance** (from `GET /api/loans`, already forced to the caller's own `member_id` for non-admins).
- Stat card 4 "Total Fines" → **My Unpaid Fines** (from `GET /api/members/me` or the fines array already returned there).
- "Overview" line chart ("Average per month") → **my monthly contributions this year**, reusing the recharts `AreaChart` pattern already in `frontend/src/views/Overview.jsx` for visual reference, restyled to the light theme (blue line, white card, tooltip bubble like the mockup).
- "All transactions" table with status pills and filter tabs → **my own activity feed** (contributions + loan events + fine payments), not the club ledger — members don't get ledger access per the access-split work. Assemble this client-side from data already available through member-scoped endpoints (`GET /api/contributions`, `GET /api/loans`, and the member's fines from `GET /api/members/me`) rather than adding a new backend endpoint, unless the combining logic gets unwieldy — your call, but prefer reusing what exists.
- Top search bar, mail icon, avatar dropdown → cosmetic, can be inert/stubbed (search doesn't need to actually filter anything yet, mail icon can link to the notifications panel already built in `MemberDashboard.jsx` from the last phase).

**Contributions** (`docs/design-reference/member-contributions.png`):
- "Total Contributed" → my total contributions this FY.
- "Year Target" → `contribution_amount × 12` from the active `FyRules` for the current fiscal year (`GET /api/rules`).
- "Rate" → `contribution_amount`/month from the same rules record.
- "Compliance" → months paid ÷ months elapsed this FY, same calculation pattern already used for `months_paid_2025` elsewhere in the codebase.
- FY dropdown → reuse the existing fiscal-year selection pattern from Overview.jsx.
- Table → my own contributions list (`GET /api/contributions`, already self-scoped for members).

**Sign in / Sign up** (`docs/design-reference/sign-in.png`, `sign-up.png`):
- Visual restyle of the existing `frontend/src/views/Login.jsx` (sign-in logic already works, just needs the new look) plus a new sign-up screen and flow per the decision above.
- "Forget Password?" link in the mockup — there's no password-reset flow built yet. Render it but make it a disabled/tooltip state ("Contact your treasurer to reset your password") rather than a dead link or a half-built feature. Don't build real password reset in this pass.
- "Remember password" checkbox — cosmetic is fine; if convenient, tie it to how long the JWT persists in `localStorage`, but don't block on this.

## Git workflow — same rules as last time, updated for one thing

`main` now requires a pull request before merging (branch protection is on, confirmed in GitHub settings) — direct pushes to `main` will be rejected. Everything else from before still applies: work in this exact repo location (not an isolated worktree that can get pruned before committing), commit early and often, don't lose work.

1. Confirm `git status` is clean and you're on an up-to-date `main` before branching.
2. Create a new branch: `git checkout -b feature/member-ui-redesign`.
3. Commit after every completed task below, not one giant commit at the end.
4. Push the branch regularly: `git push -u origin feature/member-ui-redesign` (then plain `git push` after that). Do NOT attempt to push to or merge into `main` directly — it'll be rejected by branch protection, and that's intentional.
5. When finished, open a pull request from `feature/member-ui-redesign` into `main` (via `gh pr create` if the `gh` CLI is available, otherwise give me the compare URL) and stop there — I'll review and merge myself.
6. Before opening the PR, paste the raw output of `git log --oneline -20` and `git status` in your final report as proof of what's actually committed and pushed.

## Backend tasks

1. New `POST /api/auth/signup` in `backend/routes/auth.js`: body `{ email_or_phone, username, password }`. Look up an existing `Member` by `email` or `phone` matching the input (case-insensitive, trimmed). If no match, or if a `User` already exists for that `member_id`, return a generic error (see account-enumeration note above). If matched and no existing `User` for that member, hash the password (`bcrypt`, matching the pattern already used in `auth.js`) and create a `User` with `role: 'member'`, `member_id` set, `status: 'active'`. Return a JWT the same shape as `/login` does, so the frontend can log the person straight in after signup.
2. Fix the leftover leaky endpoint flagged in the previous phase's audit while you're in this area: `GET /summary/fines` and `GET /summary/welfare` in `backend/routes/summary.js` still return every member's data under plain `authenticate`. Since the new Dashboard needs "my fines" data anyway, scope these the same way `loans.js`/`contributions.js` already do — non-admin callers get their own `member_id` forced, ignore any client-supplied one.
3. No other backend auth changes needed — the read-scoping from the last phase already covers what this UI needs.

## Frontend tasks

1. Build a self-contained "member" component tree so nothing here touches admin styling: something like `frontend/src/member/` (or `frontend/src/views/member/` — your call, be consistent) containing its own layout shell, sidebar, topbar, and a small set of light-theme primitives (stat card, section header, status pill, table) styled to match the mockups. Don't repurpose the existing dark-themed `components/UI.jsx` primitives for these — new components, new (scoped) CSS, so admin is untouched.
2. New light-theme tokens: pull the palette straight from the mockups (white `#ffffff` surfaces, near-black text, blue gradient primary `#2563eb`→`#3b82f6`-ish, status pill colors — amber/blue for pending, green for approved/paid, gray for paused). Scope these as CSS variables under a wrapper class (e.g. `.theme-member`) so they don't leak into or override the admin dark-theme variables already defined for the rest of the app.
3. Rebuild the member sidebar to match the mockup's grouping: **General** (Dashboard, Contributions, Loans, Members), **Tools** (Transactions, Expenses, Investments), **Account** (Notifications, Help center, Settings, Logout) — reuse the existing member-scoped routes/data from `MemberDashboard.jsx` (built last phase) for Loans/Members/Transactions/Expenses/Investments where a dedicated mockup doesn't exist yet; give them the same light-theme shell and stat-card/table visual pattern for consistency even without a pixel-specific mockup for each. Don't invent new data access for these — reuse what's already scoped correctly.
4. New `frontend/src/member/views/Dashboard.jsx` (or wherever you land in your structure) matching `docs/design-reference/member-dashboard.png`, wired per the data mapping above.
5. New `frontend/src/member/views/Contributions.jsx` matching `docs/design-reference/member-contributions.png`, wired per the data mapping above.
6. Restyle `frontend/src/views/Login.jsx` (or a new light-theme version used only when rendering the pre-auth screens) to match `docs/design-reference/sign-in.png`. Add a new Sign Up screen matching `sign-up.png`, calling the new `POST /api/auth/signup` endpoint, with a link back to Sign In and vice versa (matching the mockups' "Don't have an account? / Already have an account?" links).
7. `frontend/src/App.jsx`: route non-admin users into this new member shell/layout instead of the current dark-themed `Layout` + `MemberDashboard` combo from the last phase. Admin routing/layout stays exactly as-is.
8. Keep the notification bell and "Members Needing Attention" work from the last phase intact — the bell moves into the new member topbar (mail icon in the mockup), the attention widget stays admin-only and untouched.

## Non-goals for this pass

- No changes to any admin view, admin styling, or admin routing.
- No real password-reset flow — stub only, see above.
- No new backend endpoints beyond `POST /api/auth/signup` and the two-line fix to `summary/fines` + `summary/welfare` scoping — everything else the new UI needs already exists from the last phase.
- Don't touch the reconciliation/audit/rules/import/mailer routes — out of scope, unrelated to this pass.
- Don't attempt the member-roster audit, account-coverage check, automation reconnect, or credentials email — those are separate, later tasks, not part of this prompt.

## Verification

- Manually test: sign up with an email/phone that matches an existing `Member` → succeeds, logs straight in, `role: 'member'`. Sign up with one that doesn't match → clear rejection, no account created. Sign up with an email that already has a `User` → clear rejection, no duplicate created.
- Confirm a member's Dashboard and Contributions pages show only their own contribution/loan/fine figures plus the group aggregate cash figure — never another member's data, never the full transaction ledger.
- Confirm `GET /summary/fines` and `/summary/welfare` now scope to self for a member token, same as loans/contributions already do.
- Confirm the admin experience (login as an admin account, check Overview/Members/Loans/etc.) is pixel-identical to before this change — nothing in the dark theme moved or broke.
- Run `npm run build` in `frontend/` clean.
- Final check, mandatory: paste `git log --oneline -20`, `git status`, and either the `gh pr create` output or the compare URL for the PR into your final report.
