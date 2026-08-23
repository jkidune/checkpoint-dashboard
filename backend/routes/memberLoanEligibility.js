const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { computeMemberLoanEligibility } = require('../services/memberLoanEligibility');

function getFiscalYear(month, year) {
  return month >= 3 ? year : year - 1;
}

router.get('/', authenticate, async (req, res) => {
  if (req.user.member_id == null) {
    return res.status(404).json({ error: 'This account has no linked member record' });
  }

  const now = new Date();
  const defaultFY = getFiscalYear(now.getMonth() + 1, now.getFullYear());
  const fiscalYear = Number(req.query.fiscal_year || defaultFY);
  const result = await computeMemberLoanEligibility(req.user.member_id, fiscalYear);

  if (!result) return res.status(404).json({ error: 'Member not found' });

  res.json({
    fiscal_year: result.fiscal_year,
    total_contributions: result.total_contributions,
    total_loan_interest: result.total_loan_interest,
    paid_fines: result.paid_fines,
    net_worth: result.net_worth,
    loan_max_ratio: result.loan_max_ratio,
    max_eligible: result.max_eligible,
    interest_rate: result.interest_rate,
    repayment_months: result.repayment_months,
  });
});

module.exports = router;
