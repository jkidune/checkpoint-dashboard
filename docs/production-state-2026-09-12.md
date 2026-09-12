# Production State and Automatic Fine Policy — 12 September 2026

This document records the current production architecture and the corrected automatic contribution-fine policy after the September 2026 reconciliation.

## Current production architecture

Checkpoint is currently deployed as a single Vercel project from the GitHub repository `jkidune/checkpoint-dashboard`.

| Layer | Current production service |
|---|---|
| Frontend | Vercel — React/Vite build |
| API | Vercel Functions — Express app through `api/index.js` |
| Database | MongoDB Atlas |
| Authentication | JWT + bcryptjs |
| Email | Nodemailer + Gmail SMTP |
| Scheduled automatic fines | Vercel Cron → `/api/cron/automatic-fines` |

The previous Cloudflare Pages + Railway deployment remains part of the project history, but it is not the active production path as of 12 September 2026.

The production Vercel project is `checkpoint-dashboard` under the `Checkpoint Investment Club` team. Git pushes to `main` are deployed through the GitHub/Vercel integration.

## Automatic contribution-fine policy

From FY2026/2027 onward, the constitutional fine amount remains a one-time 15% of the monthly contribution amount for each qualifying missed month. With the current monthly contribution of TZS 75,000, the fine is TZS 11,250 per qualifying month.

Automatic fine eligibility is based only on whether a contribution record exists for the member and contribution month after that month's deadline has passed.

The operational rule is:

1. Wait until the contribution deadline has passed.
2. Check whether the member was already required to contribute for that month.
3. If **any contribution record exists** for that member/month, do not create an automatic fine.
4. The contribution record may be full or partial. Its stored `paid_date` is not used to decide fine eligibility.
5. If no contribution record exists, check whether a fine for that same member/month already exists.
6. If no contribution and no existing fine exist, create one automatic fine for the month.
7. The fine is one-time per contribution month and does not compound.

This means a contribution entered or reconciled later must not generate a fine merely because its stored payment date appears after the deadline.

## Manual entry and Form Intake

The legacy date-based fine trigger is disabled globally. Manual contribution posting and Form Intake verification must not create a fine simply because a contribution is recorded with a late `paid_date`.

Form Intake remains an allocation workflow. A receipt can be allocated to contributions, existing unpaid fines and loan repayments, but the posting of a contribution does not itself assess a new late fine. New automatic contribution fines are created only by the missing-month scanner described above.

## September 2026 reconciliation

On 12 September 2026, production automatic fines were audited against the corrected rule.

Results:

- Automatic fines scanned: **33**
- Confirmed erroneous date-based fines: **14**
- Erroneous fines that were unpaid and safely removed: **14**
- Paid erroneous fines requiring cash-ledger reconciliation: **0**
- Legitimate missing-month fines retained: **19**
- Total erroneous unpaid fines removed: **TZS 157,500**

The 14 removed records were all created by the earlier date-based logic and had corresponding contribution evidence. No paid fine was deleted.

The cleanup was executed through a one-time exact-ID production operation. The temporary cleanup endpoint was removed immediately afterward and the final production deployment was verified as ready. The former cleanup route then returned HTTP 404.

## Reconciliation tooling

The repository retains the maintenance script:

```bash
cd backend
npm run fines:reconcile
```

This is the default dry-run audit. It reports automatic fines and classifies whether they are erroneous, valid/uncertain, or require manual review.

Applying cleanup requires the explicit command:

```bash
npm run fines:reconcile:apply
```

The apply mode is designed to remove only unpaid erroneous automatic fines identified by the reconciliation logic. Paid erroneous fines must not be silently deleted because a payment may already have affected the cash ledger.

## Historical notes

Older documentation may describe earlier deployments or the earlier rule that a fine was created when a contribution was saved after its deadline. Those entries are historical records of prior system behavior. They are superseded for current production operation by this document and by the September 2026 implementation.
