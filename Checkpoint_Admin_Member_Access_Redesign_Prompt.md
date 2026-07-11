# Checkpoint — Admin/Member Data Access Redesign

Two parts below: (1) the data-access sketch to sign off on, (2) a ready-to-run prompt for a coding agent to implement it in the `checkpoint-dashboard` repo. Do this pass before any visual UI redesign — it's plumbing, not styling.

---

## 1. Data access sketch

### Role model
Two unrelated "role" fields exist today and should stay conceptually separate:
- `User.role` — `admin` | `member`. This is the **permission** role and is what everything below hinges on.
- `Member.role` — `chair` | `secretary` | `treasurer` | `member`. This is the person's **club office**, purely informational. Recommend renaming this field to `Member.office` during implementation so it stops colliding with `User.role` in code and in future conversations.

### Admin — unchanged, full access
- Full member list and detail (financials, contact info, edit rights)
- Create/edit/delete contributions, loans, repayments, fines, welfare, expenses, investments, transactions
- Fiscal-year rules/constitution parameters (interest rate, fine rules, contribution amount)
- User access management (promote/demote, disable, reset)
- CSV import, reconciliation tools, audit log
- Generate/export reports (CSV/PDF), group-wide or per member
- Email broadcasts (statement, reminders, credentials) — kept, to be reconnected later
- **New:** send a targeted deadline/reminder alert to one specific member
- Sync/maintenance tools

### Member — "my money" focused, restricted
- **My dashboard**: own contributions (current FY + history), own active loan(s) with balance and due date, own unpaid fines, own compliance streak
- **My notifications**: upcoming contribution due date, loan repayment due date, new fine issued, overdue fine reminder
- **Members directory**: brief only — name, office, active/inactive status, "has active loan" flag. No other member's contribution/loan/fine figures.
- **Group snapshot**: total group cash/M-Koba balance, total loans outstanding (aggregate), total contributions this FY, total investment assets (aggregate), active member count. This satisfies "member has the right to see total group money and total loans" without exposing the ledger.
- **Group investments**: members get a chart of portfolio value over time built from real NAV updates (see below), not the raw transaction ledger (no transaction reference, evidence links, or verification-status internals). The existing Phase 1/2 roadmap narrative stays as static content for now — only the actual iTrust/money-market figures need to be data-driven in this pass.
- **Group expenses**: aggregate total/category breakdown only, not the editable ledger with references and approvers.
- **No access to**: full transactions ledger, other members' detail pages, rules/constitution editing, reconciliation, audit log, CSV import, user management, sync tools, Settings.

### Backend shape this implies
- A `requireSelfOrAdmin(paramIdField)` middleware pattern: any endpoint returning one member's data must check `req.user.role === 'admin' || req.user.member_id === requestedId`.
- `GET /api/members/me` — resolves the caller's own member record from `req.user.member_id`, never from a client-supplied id.
- `GET /api/members` (list) — non-admins get a stripped array (`id, name, office, status, has_active_loan`) for everyone except themselves; their own entry can include their financials.
- `GET /api/loans`, `GET /api/contributions` — for non-admins, ignore/override any client-supplied `member_id` query param and force it to `req.user.member_id`.
- `GET /api/summary` — split into the current admin payload and a trimmed `group-snapshot` payload for members (cash at bank, total loans outstanding, total contributions this FY, active members, total group assets — no interest-by-member breakdown, no full active-loan list).
- `GET /api/transactions`, `GET /api/investments` — admin-only for raw records; members don't get a ledger endpoint at all (they get the summary/growth figures below instead).
- New `Notification` collection (`member_id, type, message, due_date, read, created_at`) populated by a scheduled job (the repo already has `node-cron` installed) plus an admin-triggered "send alert to member" action. Wire it so the actual email send is a pluggable stub for now, since the mailer is disconnected post-migration — in-app notification first, email later.

### Decisions (resolved)
- **Other members' loan status**: not shown. The brief member-list entry for anyone other than yourself is just `{id, name, office, status}` — no loan flag, no financial signal of any kind.
- **"Members needing attention"**: admin-only. Built on top of the notification/deadline-scan data — an admin dashboard widget listing members with an overdue fine, an overdue loan repayment, or a missed contribution, grouped per member. Never shown to members.
- **Investments — dynamic, not static**: confirmed against the real Investment Register (`Checkpoint_Club_Reconciled_Financial_Report_Y1_Y3_June_2026.xlsx`, "Investment Register" tab). The club holds unit-based money-market placements (currently one: iTrust "iGrowth", 23,137 units purchased at TZS 216/unit on 18 June 2026 for a TZS 5,000,000 outlay). The unit cost (NAV) moves over time — the register already shows it revalued to TZS 220/unit by the last meeting, giving an "Estimated Value (Today)" of units × latest NAV (23,137 × 220 = 5,090,140), not the original purchase cost. So: admin records a new NAV/unit-cost reading periodically (monthly, per the "Provider statement received: Monthly" control note in the register); the system recomputes current value from units × latest NAV automatically; members see the resulting value-over-time and unit-cost-over-time as charts, not the underlying transaction/reference/evidence fields. This needs a NAV history model — see below.

---

## 2. Prompt for the coding agent

Copy everything in the fenced block below into your coding agent (Claude Code, Cursor, etc.) run against the `checkpoint-dashboard` repo.

```
You're working in the Checkpoint investment-club dashboard repo (Express + Mongoose backend on Vercel serverless, React + Vite frontend, JWT auth). Structure: backend/ (server.js, routes/, db/models.js, middleware/auth.js), frontend/src/ (App.jsx, views/, components/, api/index.js), api/index.js (Vercel entry, forwards to backend/server.js).

GOAL: enforce a real data-access split between the two existing account types — User.role 'admin' and User.role 'member' — so members only ever see their own financial detail plus club-wide aggregates, while admins keep full access. This is a backend authorization + minimal frontend pass, NOT a visual redesign. Don't restyle existing components beyond what's needed to add/hide sections.

GIT WORKFLOW — READ THIS FIRST, NON-NEGOTIABLE:
A previous attempt at this exact task did all the work in an isolated worktree/branch, reported success, and then the worktree was cleaned up before anything was committed — every edit was lost, nothing ever reached git. Do not repeat that.
1. Work directly on the `main` branch of this repo, in this exact working directory — do NOT create a separate branch or isolated worktree for this task. Before starting, run `git status` and `git branch --show-current` and confirm you're on `main` with a clean tree. If you're not on main, `git checkout main` first (stash or report any pre-existing dirty state rather than overwriting it silently).
2. Commit after every completed task from the numbered lists below — not one giant commit at the end. Use `git add -A && git commit -m "<short description>"` after each. This means roughly 15-20 commits over the course of this work, not one.
3. After every commit, immediately run `git push origin main`. If the push fails (auth, conflict, rejected), STOP and report the exact error rather than continuing on with more uncommitted work stacked on top.
4. Do not treat a successful `npm run build` as proof the work is saved — it only proves the code compiles in your current working directory. The only proof that survives past this session is a commit that has been pushed to `origin/main`.
5. Before writing your final summary, run and paste the actual output of: `git log --oneline -20`, `git status`, and `git log origin/main..HEAD` (this last one must be empty — if it isn't, your commits haven't actually reached GitHub yet and you're not done). Include this raw output in your report, not a paraphrase of it.
6. For at least 3 of the files you changed, include the actual `git show <commit>:<path>` or `git diff` output for the specific lines you changed as evidence in your final report — not just a prose description of what you did.

CURRENT STATE (confirmed by inspection, don't re-derive this):
- backend/middleware/auth.js has `authenticate` (verifies JWT, loads req.user with id/username/role/member_id) and `requireAdmin` (403s if req.user.role !== 'admin'). Every write endpoint (POST/PATCH/PUT/DELETE) across members, loans, contributions, transactions, investments, expenses, summary/fines, summary/welfare, rules, import, mailer already correctly uses requireAdmin.
- The problem is entirely on the READ side: GET /api/members, /api/members/:id, /api/loans, /api/contributions, /api/transactions, /api/investments, /api/summary only require `authenticate` — any logged-in member can fetch every other member's full financial detail, the whole transaction ledger, and the whole investment book. Where a `member_id` query filter exists (loans.js, contributions.js), it's client-supplied and never checked against req.user.member_id.
- Frontend: frontend/src/App.jsx routes and frontend/src/components/Sidebar.jsx nav are identical for both roles except the Settings link (adminOnly flag) and some inline `isAdmin` checks that hide Add/Edit/Import buttons in Members.jsx, Overview.jsx, etc. frontend/src/views/Transactions.jsx and Investments.jsx have zero role awareness. There is no member-scoped dashboard or "my profile" view — Members.jsx lets anyone click into anyone's detail card.
- Member model (backend/db/models.js) has a `role` field (chair/secretary/treasurer/member) that is unrelated to User.role (admin/member) — same field name, different concept. Rename Member.role to Member.office everywhere (schema, all routes/queries that read/write it, ROLE_COLORS map and badges in frontend/src/views/Members.jsx) to remove the naming collision. Do this as a clean rename, update every reference, don't leave a dangling alias.

BACKEND TASKS
1. In backend/middleware/auth.js, add a helper `requireSelfOrAdmin(getMemberId)` — a middleware factory that lets the request through if req.user.role === 'admin' OR req.user.member_id === getMemberId(req) (getMemberId is a function you pass per-route, e.g. `req => parseInt(req.params.id)`). 403 otherwise.
2. backend/routes/members.js:
   - Add `GET /me`, authenticate only, resolves via req.user.member_id (404 if the account has no linked member).
   - `GET /:id` — apply requireSelfOrAdmin so a member can only fetch their own detail via this route; admins unrestricted.
   - `GET /` (list) — keep authenticate only, but when req.user.role !== 'admin', return a trimmed shape for every entry that is NOT the caller's own member_id: only `{id, name, office, status}` — do not include a loan flag or any other financial signal about other members, that's the confirmed decision. The caller's own entry in the list can keep full financials, or just point them at /me — your call, document which you picked.
3. backend/routes/loans.js and backend/routes/contributions.js: on the list GET routes, when req.user.role !== 'admin', ignore any client-supplied member_id query param and force the Mongo query's member_id to req.user.member_id. Also apply requireSelfOrAdmin to the single-loan GET /:id route.
4. backend/routes/transactions.js and backend/routes/investments.js: change the GET / list route to requireAdmin (members lose direct ledger access entirely — they'll get aggregate figures via summary/growth endpoints instead).
5. backend/routes/summary.js: keep the existing GET / (full payload) behind requireAdmin now instead of authenticate. Add a new GET /snapshot route, authenticate only, that returns a trimmed payload for members: cash_at_bank, total loans outstanding (aggregate), total group contributions this fiscal year, total investment assets (aggregate, computed via the NAV logic in task 8 below), active_members count, net_group_position. Reuse the existing calculation logic in this file rather than duplicating it — refactor the shared computation into a function both routes call, and have each route select which fields to return.
6. Update backend/server.js only if new route files are added (needed for notifications, see task 7).
7. New "members needing attention" admin feature: add `GET /api/notifications/attention` (authenticate, requireAdmin) to backend/routes/notifications.js (created in task 8) that groups open/overdue notifications by member and returns `[{member_id, name, issues: [{type, message, due_date}]}]`. This is admin-only — never exposed to member tokens. Surface it on the existing admin Overview dashboard as a small widget (frontend task 6).
8. New Notification feature:
   - Add a `notificationSchema` to backend/db/models.js: `member_id (Number, required), type (String, enum: ['contribution_due','loan_due','fine_issued','fine_overdue','custom']), message (String, required), due_date (String, default: null), read (Boolean, default: false), created_by (String, default: null), created_at (Date, default: Date.now)`. Export as `Notification`. Give it an auto-increment id like the other models.
   - New backend/routes/notifications.js: `GET /` (authenticate; members get only their own via req.user.member_id, admins can pass ?member_id= to filter or get all), `POST /` (authenticate, requireAdmin — admin creates a targeted alert for one member, body: {member_id, type, message, due_date}), `PATCH /:id/read` (authenticate, requireSelfOrAdmin against the notification's member_id — marks read), plus the `GET /attention` route from task 7.
   - Mount it in backend/server.js: `app.use('/api/notifications', require('./routes/notifications'));`
   - Don't wire actual email sending yet — leave a clearly-commented stub function (e.g. `notifyByEmail(notification)`) that currently just logs, so it's a one-line swap once the mailer is reconnected post-migration. Do NOT attempt to fix the Google Forms/email integration in this pass — out of scope, already tracked separately.
   - Add a small node-cron job (package.json already has node-cron) in a new backend/jobs/deadlineScan.js that runs daily, checks for: contributions not yet paid for the current month past a configurable day-of-month, loans past due_date, fines unpaid past N days — and creates Notification records for the affected members (skip duplicates for the same member+type+period). Require and start it from backend/server.js only when process.env.VERCEL !== '1' (matches the existing pattern for app.listen) — note in a comment that on Vercel this needs a cron trigger (e.g. Vercel Cron hitting an endpoint) instead of an in-process timer, and stub that endpoint too: `POST /api/notifications/scan` (requireAdmin) that runs the same scan function on demand.
9. Investment NAV tracking (dynamic money-market valuation): the real Investment Register (`Checkpoint_Club_Reconciled_Financial_Report_Y1_Y3_June_2026.xlsx`, "Investment Register" tab) shows the club's investments are unit-based — e.g. iTrust "iGrowth": 23,137 units bought at TZS 216/unit on 18 June 2026 for TZS 5,000,000, later revalued to TZS 220/unit, giving a current value of units × latest NAV (23,137 × 220 = 5,090,140), not the original cost. The existing `investmentSchema` in backend/db/models.js has no unit fields — add them and build a NAV history:
   - Extend `investmentSchema` with `units_purchased (Number, default: null)` and `unit_cost_at_purchase (Number, default: null)`.
   - Add a new `navUpdateSchema` to backend/db/models.js: `provider (String, required), asset_class (String, required), unit_cost (Number, required), effective_date (String, required), source (String, default: null)` (e.g. "Monthly statement"), `recorded_by (String, default: null), created_at (Date, default: Date.now)`. Export as `NavUpdate`, auto-increment id.
   - In backend/routes/investments.js add `POST /nav` (authenticate, requireAdmin) for the admin to record a new monthly NAV reading per provider/asset_class, and `GET /nav-history?provider=&asset_class=` (requireAdmin) to list past readings.
   - Change how "current value" is computed for the admin GET / investments list: for each investment with `units_purchased` set, look up the latest `NavUpdate` for that provider+asset_class with `effective_date <= today` and compute `units_purchased * unit_cost`; fall back to the stored `carrying_value` for investments with no unit data (older/manual entries). Don't hardcode the fallback silently — flag it in the response so the UI can show "at cost" vs "at NAV".
   - New member-facing route `GET /api/investments/growth` (authenticate only): returns a time series per asset_class — `[{date, unit_cost}]` from `NavUpdate` history plus the resulting portfolio value at each point (units × that unit_cost, summed across all investments in that asset_class) — no transaction reference, evidence, or provider-route fields. This is what powers the member chart.

FRONTEND TASKS
1. frontend/src/api/index.js: add `members.me()`, `notifications.list()`, `notifications.markRead(id)`, `notifications.create(payload)` (admin), `notifications.attention()` (admin), `summary.snapshot()`, `investments.recordNav(payload)` (admin), `investments.growth()` alongside the existing calls.
2. frontend/src/App.jsx: for non-admin users, route `/` to a new `MemberDashboard` view instead of the existing `Overview`. Keep `Overview` (full KPI dashboard) for admins as-is. Remove member access to `/transactions` and `/investments` raw routes — either omit those routes for non-admins or redirect them to `/` — and remove those items from frontend/src/components/Sidebar.jsx's NAV array for non-admins (mark them `adminOnly: true` like Settings already is).
3. New frontend/src/views/MemberDashboard.jsx: build from `members.me()`, `summary.snapshot()`, and `investments.growth()`. Sections: my contributions (this FY + a small history list), my active loan(s) with balance/due date, my unpaid fines, my compliance streak (reuse the ProgressBar pattern already in Members.jsx), a notifications panel (list from `notifications.list()`, click to mark read), a compact "Group at a glance" card row using the snapshot figures (cash at bank, total loans outstanding, total contributions this FY, active members), and an investment growth chart (unit cost and portfolio value over time, using the existing recharts setup already in Overview.jsx as a pattern) — keep the existing static roadmap phases below it as-is. Match the existing visual language (StatCard, SectionHeader, card classes from components/UI.jsx) — don't invent new styling patterns, this isn't the redesign pass.
4. frontend/src/views/Investments.jsx (admin view): add a small "Record NAV update" form (provider, asset_class, unit_cost, effective_date, source) calling `investments.recordNav()`, and show current value per holding computed from the latest NAV alongside the existing content.
5. frontend/src/views/Members.jsx: for non-admin users, render the trimmed list shape the backend now returns (name, office/badge, status only — no loan flag, no contribution/compliance figures on other members' cards) and disable opening any detail modal except their own card. Rename all `role`/`ROLE_COLORS` references tied to Member.office to match the backend rename in this pass.
6. frontend/src/views/Overview.jsx (admin view): add a "Members needing attention" widget using `notifications.attention()` — small list of member name + issue chips (overdue fine / overdue loan / missed contribution). Admin-only, don't add it anywhere a member token could reach.
7. Add a small notification bell/indicator somewhere in the shared Layout (frontend/src/App.jsx's Layout component) showing unread count for the logged-in member, using `notifications.list()`.

NON-GOALS FOR THIS PASS
- No visual/branding redesign — that's a separate follow-up once this access layer is correct.
- No fix for the Google Forms webhook or outbound email delivery — those are already known-broken post Vercel→Cloudflare migration and tracked separately; just leave clean integration points as described above.
- Don't touch reconciliation.js, audit.js, rules.js, expenses.js write logic — already correctly admin-gated and out of scope.

VERIFICATION
- Log in as a seeded admin and a seeded member (check backend/db/seed.js for existing test accounts, or create one) and manually confirm: member's /api/members list omits other members' financials and loan status, /api/members/:id 403s for another member's id, /api/loans and /api/contributions only ever return the caller's own records for a member token, /api/transactions and /api/investments 403 for a member token, /api/summary 403s for a member token while /api/summary/snapshot works for both, /api/notifications only returns the caller's own for a member token, /api/notifications/attention 403s for a member token, and /api/investments/growth returns the same NAV-derived series regardless of role.
- Confirm the NAV math: seed a NavUpdate for iTrust/iGrowth at 220 and verify the computed current value for the existing 23,137-unit holding comes out to 5,090,140 (matches the real Investment Register).
- Confirm the admin experience is completely unchanged — every existing admin flow (Overview, full Members list/edit, Transactions, Investments, import, reconciliation, rules, mailer broadcasts) still works exactly as before.
- Run the frontend build (`npm run build` in frontend/) to make sure nothing broke from the Member.role → Member.office rename or route changes.
- Report back a short summary of every endpoint whose auth requirement changed, and flag the three open decisions listed in the "open decisions" note above rather than guessing silently.
- Final check, mandatory: `git log origin/main..HEAD` must print nothing. If it prints anything, your work is not actually saved yet — push again and re-check before reporting done.
```

---

## 3. Git recovery prompt (run this first, if not already clean)

Status as of this writing: the actual implementation is done, verified line-by-line, and safely pushed to GitHub on branch `claude/member-data-access-auth-20810f` (commit `2f7dcde`). A separate attempt to merge it into `main` from a permission-restricted environment left the local working copy in a broken half-merged state and dropped stale lock files. Nothing was lost — this is purely a git housekeeping task to finish on a machine with full filesystem access to the repo. Copy the block below into your coding agent and run it there (not in a sandboxed/restricted environment).

```
You're working directly in the Checkpoint dashboard repo on this machine, at its real location on disk — not in an isolated worktree or a permission-restricted sandbox. This must run somewhere with full read/write/delete access to the repo's .git directory.

CONTEXT: A previous session verified and pushed real, working code to branch `claude/member-data-access-auth-20810f` (commit 2f7dcde) — it implements a full admin/member data-access split (backend/routes/notifications.js, NAV endpoints in investments.js, frontend/src/views/MemberDashboard.jsx, the Member.role→office rename, etc.). That work is safe on GitHub, already reviewed, do not redo it or second-guess it. Separately, an attempt to merge it into `main` from a different, permission-restricted environment left this local working copy in a broken half-merged state: git status shows ~25 files as "modified" that shouldn't be, some files still have stale old content, and there may be leftover `.git/index.lock` / `.git/objects/maintenance.lock` files blocking further git operations.

DO THIS, IN ORDER, AND REPORT RAW COMMAND OUTPUT AT EACH STEP (not a paraphrase):
1. `git status` and `ls .git/index.lock .git/objects/maintenance.lock 2>/dev/null` — see what's actually there.
2. If either lock file exists, remove it: `rm -f .git/index.lock .git/objects/maintenance.lock`. No legitimate git process is running; these are stale leftovers from an interrupted operation.
3. `git fetch origin` — pull the latest refs, including `origin/claude/member-data-access-auth-20810f`.
4. `git checkout main` — if this errors because of the broken state, that's expected, proceed anyway.
5. `git reset --hard origin/main` — this discards the broken local working-copy content and snaps `main` to exactly match GitHub. Confirm with `git status` that the tree is now clean (you may see a handful of untracked leftover files like `backend/routes/audit.js`, `backend/routes/reconciliationV2.js`, some `backend/scripts/*.js` — leave those alone, don't delete anything yet).
6. `git merge origin/claude/member-data-access-auth-20810f` — this should fast-forward cleanly since `main` hasn't moved since that branch was created. If it reports a fast-forward, continue. If it reports a real three-way merge or any conflicts, STOP and report back rather than resolving conflicts yourself — that would mean `main` diverged in a way nobody expected, and I need to know before you touch anything.
7. `git push origin main`.
8. Verify the push actually landed: `git log origin/main..HEAD` must print nothing, and `git log --oneline -3` should show `2f7dcde` (or its fast-forward hash) at the tip.
9. Sanity-check the merged content is real, not just refs: `grep -n "requireAdmin" backend/routes/summary.js` (should show it on the `GET /` route) and `ls backend/routes/notifications.js frontend/src/views/MemberDashboard.jsx` (both must exist).
10. Report back the raw output of steps 7, 8, and 9 verbatim.

Do not attempt to redo, "improve," or second-guess any of the implementation itself — it's already done and verified. This is purely git housekeeping: clean up the broken local state, fast-forward main to the already-verified commit, and push it.
```
