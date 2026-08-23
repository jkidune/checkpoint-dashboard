function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) {
    throw new Error(`[loan-transform] Could not find ${label}; Loans.jsx changed and the transform must be reviewed.`)
  }
  return source.replace(from, to)
}

export function checkpointLoanEnhancements() {
  return {
    name: 'checkpoint-loan-enhancements',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/views/Loans.jsx')) return null

      let source = code

      source = replaceRequired(
        source,
        "  const [saving, setSaving] = useState(false);\n\n  const selMember = (membersData || []).find((m) => String(m.id) === form.member_id);\n  const maxEligible = selMember ? Math.round((selMember.total_contributions || 0) * 0.8) : 0;\n  const reqPrincipal = parseInt(form.principal || 0, 10);\n  const isFY2026 = parseInt(form.fiscal_year || 2026, 10) >= 2026;\n  const isExceeding = selMember && isFY2026 && reqPrincipal > maxEligible;",
        `  const [saving, setSaving] = useState(false);\n  const [eligibility, setEligibility] = useState(null);\n  const [eligibilityLoading, setEligibilityLoading] = useState(false);\n\n  const selMember = (membersData || []).find((m) => String(m.id) === form.member_id);\n  const reqPrincipal = parseInt(form.principal || 0, 10);\n  const isFY2026 = parseInt(form.fiscal_year || 2026, 10) >= 2026;\n  const maxEligible = eligibility?.max_eligible ?? 0;\n  const isExceeding = !!selMember && eligibility?.max_eligible != null && reqPrincipal > maxEligible;\n\n  useEffect(() => {\n    if (!form.issued_date) return;\n    const issued = new Date(\\`${'${form.issued_date}'}T12:00:00Z\\`);\n    if (Number.isNaN(issued.getTime())) return;\n    const month = issued.getUTCMonth() + 1;\n    const derivedFY = month >= 3 ? issued.getUTCFullYear() : issued.getUTCFullYear() - 1;\n    if (String(derivedFY) !== String(form.fiscal_year)) {\n      setForm((current) => ({ ...current, fiscal_year: String(derivedFY) }));\n    }\n  }, [form.issued_date]);\n\n  useEffect(() => {\n    let cancelled = false;\n    if (!form.member_id) {\n      setEligibility(null);\n      return () => { cancelled = true; };\n    }\n    setEligibilityLoading(true);\n    loans.eligibility(form.member_id, { fiscal_year: parseInt(form.fiscal_year || 2026, 10) })\n      .then((response) => { if (!cancelled) setEligibility(response.data); })\n      .catch(() => { if (!cancelled) setEligibility(null); })\n      .finally(() => { if (!cancelled) setEligibilityLoading(false); });\n    return () => { cancelled = true; };\n  }, [form.member_id, form.fiscal_year]);`,
        'eligibility state block',
      )

      source = replaceRequired(
        source,
        "                Total contributions: <strong>{fmt(selMember.total_contributions || 0)}</strong> · Max 80% limit: <strong style={{ color: 'var(--admin-teal)' }}>{fmt(maxEligible)}</strong>",
        `                {eligibilityLoading ? (\n                  <span>Calculating member net worth…</span>\n                ) : eligibility ? (\n                  <>\n                    Net worth: <strong>{fmt(eligibility.net_worth)}</strong>\n                    {' '}= Contributions {fmt(eligibility.total_contributions)} + Interest {fmt(eligibility.total_loan_interest)} + Paid fines {fmt(eligibility.paid_fines)}\n                    {' '}· Max {Math.round((eligibility.loan_max_ratio || 0) * 100)}%: <strong style={{ color: 'var(--admin-teal)' }}>{fmt(maxEligible)}</strong>\n                    {' '}· FY{eligibility.fiscal_year} interest: <strong>{((eligibility.interest_rate || 0) * 100).toFixed(0)}%</strong>\n                  </>\n                ) : (\n                  <span>Eligibility unavailable.</span>\n                )}`,
        'member eligibility description',
      )

      source = replaceRequired(
        source,
        "                onChange={(e) => setForm({ ...form, fiscal_year: e.target.value })}\n                required",
        "                disabled\n                title=\"Fiscal year is derived from the issued date\"\n                required",
        'FY selector behavior',
      )

      source = replaceRequired(
        source,
        "Maximum loan eligibility capped at 80% of total member contributions",
        "Maximum loan eligibility uses the FY borrowing ratio against member net worth (contributions + historical loan interest + paid fines)",
        'FY rule notice',
      )

      source = replaceRequired(
        source,
        "      if (!acc[l.member_id]) acc[l.member_id] = { name: (l.member_name || 'Member').split(' ')[0], total: 0 };\n      acc[l.member_id].total += l.principal || 0;",
        "      if (!acc[l.member_id]) acc[l.member_id] = { name: (l.member_name || 'Member').split(' ')[0], principal: 0, interest: 0 };\n      acc[l.member_id].principal += l.principal || 0;\n      acc[l.member_id].interest += l.interest_amount || 0;",
        'loan volume aggregation',
      )

      source = replaceRequired(
        source,
        "              <Bar dataKey=\"total\" name=\"Total Borrowed\" fill=\"var(--admin-blue)\" radius={[4, 4, 0, 0]} />",
        `              <Bar dataKey="principal" name="Principal" fill="var(--admin-blue)" radius={[4, 4, 0, 0]} />\n              <Bar dataKey="interest" name="Interest" fill="var(--admin-amber)" radius={[4, 4, 0, 0]} />`,
        'loan volume bars',
      )

      source = replaceRequired(
        source,
        "            Loans Volume by Member · FY{fiscalYear}",
        "            Loan Principal & Interest by Member · FY{fiscalYear}",
        'loan chart heading',
      )

      return { code: source, map: null }
    },
  }
}
