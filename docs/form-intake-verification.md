# Form Intake Verification & Allocation

## Accounting principle

A Google Form submission is a **member declaration**, not an automatic ledger instruction. The administrator/treasurer verifies the evidence and creates the authoritative allocation.

A single receipt may be split across:

- one or more monthly contribution periods;
- existing unpaid fines;
- a late fine assessed when a late monthly contribution is posted;
- one or more outstanding loan repayments.

The system will not post until the sum of allocations equals the exact cash amount received.

## Example: TZS 172,000 lump-sum receipt

If a member submits TZS 172,000 and says it covers two months, the treasurer can inspect the member's notes and obligations. For example, the receipt could be allocated as:

- March contribution: TZS 75,000
- April contribution: TZS 75,000
- Existing fine: TZS 11,250
- Loan repayment: TZS 10,750

Total allocated: TZS 172,000.

The exact split is controlled by the obligations shown for that member. The example above is illustrative only; the workbench will reject allocations that exceed a contribution balance, fine amount, loan balance, or the cash received.

## Verification workflow

1. New Google Form payment is staged in `form_intake_submissions`.
2. Admin receives a red notification-bell count and, when SMTP is configured, an email alert.
3. Admin opens **Form Intake → Review & allocate**.
4. Original form response and member notes remain visible as evidence.
5. Admin can correct the matched member, reference, amount, date, claimed type/months, or notes. Corrections are retained in `correction_history` with actor, timestamp and reason.
6. Admin adds ledger obligations to the receipt allocation.
7. The allocation preview validates duplicates, balances and exact cash reconciliation.
8. **Verify & Post** writes contribution/repayment/fine records transactionally and creates categorized ledger transactions.
9. The intake is marked `posted` only after the posting reconciliation succeeds.

## Why the old Accept button could be grey

The previous UI silently disabled **Accept** when any of the following was true:

- member match was not `matched`;
- payment reference was missing;
- payment reference was flagged as a duplicate;
- another review action was already running.

The new workbench keeps those conditions as posting safeguards, but does not hide them behind a disabled first-step button. The payment can be opened, corrected and investigated; blocking reasons are shown explicitly before final posting.

## Admin email alerts

The intake alert uses the existing Gmail SMTP configuration:

```env
SMTP_USER=checkpointinvestors@gmail.com
SMTP_PASS=<gmail-app-password>
SMTP_FROM="Checkpoint Investment Club <checkpointinvestors@gmail.com>"
```

Optional additional alert recipients can be configured as a comma-separated list:

```env
ADMIN_ALERT_EMAILS=treasurer@example.com,chairperson@example.com
```

Recipients are deduplicated from:

1. `ADMIN_ALERT_EMAILS`;
2. email addresses on admin user accounts;
3. `SMTP_USER` as a fallback club mailbox.

## Google Apps Script

The Apps Script must stage payments through:

```text
/api/forms/intake
```

It must **not** use the legacy direct-write endpoint `/api/forms/contribution`.

Recommended Apps Script properties:

```text
CHECKPOINT_API_URL=https://<api-host>/api/forms/intake
CHECKPOINT_FORM_SECRET=<same FORM_SECRET configured in backend>
```

The repository script validates that the configured API URL contains `/api/forms/intake` before sending a form response.

## Safety constraints

- Duplicate payment references are checked during staging and rechecked immediately before posting.
- Existing fines must be settled in full because the current Fine model has paid/unpaid state rather than a partial-paid balance.
- A newly assessed late fine can only be paid in the same allocation as the contribution period that triggers it.
- Contribution and loan repayment allocations may be partial but cannot exceed the outstanding balance.
- Categorized transaction rows (`contribution`, `loan_repayment`, `fine_payment`) preserve the existing cash-position reporting model.
