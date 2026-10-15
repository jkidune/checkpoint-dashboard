import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const COLORS = {
  ink: [15, 23, 42],
  muted: [100, 116, 139],
  blue: [37, 99, 235],
  blueSoft: [239, 246, 255],
  teal: [13, 148, 136],
  green: [22, 163, 74],
  amber: [217, 119, 6],
  red: [220, 38, 38],
  line: [226, 232, 240],
  paper: [248, 250, 252],
  white: [255, 255, 255],
};

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function money(value) {
  const number = Number(value || 0);
  return `TZS ${Math.round(number).toLocaleString('en-US')}`;
}

function pct(value) {
  if (value === null || value === undefined) return '—';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function longDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function shortDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function pageTitle(doc, title, subtitle) {
  const W = doc.internal.pageSize.getWidth();
  doc.setTextColor(...COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, 16, 20);
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.muted);
    doc.setFontSize(8);
    doc.text(subtitle, W - 16, 20, { align: 'right' });
  }
  doc.setDrawColor(...COLORS.line);
  doc.line(16, 25, W - 16, 25);
}

function sectionLabel(doc, text, x, y) {
  doc.setTextColor(...COLORS.blue);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(String(text).toUpperCase(), x, y);
}

function metricCard(doc, { x, y, w, label, value, detail, accent = COLORS.blue }) {
  doc.setFillColor(...COLORS.white);
  doc.setDrawColor(...COLORS.line);
  doc.roundedRect(x, y, w, 26, 2.5, 2.5, 'FD');
  doc.setFillColor(...accent);
  doc.roundedRect(x, y, 2.5, 26, 1.25, 1.25, 'F');
  doc.setTextColor(...COLORS.muted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.text(label.toUpperCase(), x + 7, y + 7);
  doc.setTextColor(...COLORS.ink);
  doc.setFontSize(10.5);
  doc.text(value, x + 7, y + 15);
  if (detail) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.muted);
    doc.setFontSize(6.5);
    doc.text(detail, x + 7, y + 21);
  }
}

function addCover(doc, report, version, snapshot) {
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  doc.setFillColor(...COLORS.paper);
  doc.rect(0, 0, W, H, 'F');
  doc.setFillColor(...COLORS.blue);
  doc.rect(0, 0, W, 8, 'F');

  doc.setTextColor(...COLORS.blue);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('CHECKPOINT', 18, 28);

  doc.setTextColor(...COLORS.ink);
  doc.setFontSize(28);
  doc.text('Quarterly', 18, 70);
  doc.text('Financial Report', 18, 82);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(10);
  doc.text(`Quarter ${report.quarter} · FY ${report.fiscal_year}/${String(report.fiscal_year + 1).slice(-2)}`, 18, 96);
  doc.text(`${longDate(report.period_start)} — ${longDate(report.period_end)}`, 18, 103);

  doc.setFillColor(...COLORS.blueSoft);
  doc.roundedRect(18, 124, W - 36, 58, 4, 4, 'F');
  sectionLabel(doc, 'Organization', 26, 139);
  doc.setTextColor(...COLORS.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(snapshot.organization?.name || 'Checkpoint Investment Club', 26, 150);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(8);
  doc.text(`Report ID: ${report.report_number}`, 26, 163);
  doc.text(`Version: ${version.version_number}`, 26, 170);
  doc.text(`Generated: ${longDate(version.generated_at)}`, 26, 177);
  doc.text(`Prepared by: ${version.generated_by || report.generated_by || 'Treasurer'}`, 26, 184);

  doc.setFillColor(254, 243, 199);
  doc.setTextColor(146, 64, 14);
  doc.roundedRect(18, 205, 44, 10, 5, 5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text('DRAFT — FOR REVIEW', 40, 211.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COLORS.muted);
  doc.setFontSize(7.5);
  const note = 'This draft is generated from a frozen Checkpoint financial snapshot. Financial figures are read-only; corrections must be made in the underlying records and the report regenerated.';
  doc.text(doc.splitTextToSize(note, W - 36), 18, 232);
}

function addExecutivePage(doc, report, version, snapshot) {
  doc.addPage();
  pageTitle(doc, 'Executive Summary', `Q${report.quarter} FY${report.fiscal_year} · Version ${version.version_number}`);
  const W = doc.internal.pageSize.getWidth();

  const metrics = [
    ['Quarter contributions', money(snapshot.headline?.contributions_quarter), 'Member contributions in the period', COLORS.teal],
    ['Closing cash', money(snapshot.headline?.cash_position), snapshot.cash_position?.reconciled_as_of ? `Reconciled from ${shortDate(snapshot.cash_position.reconciled_as_of)}` : 'Calculated fallback', COLORS.green],
    ['Loans outstanding', money(snapshot.headline?.outstanding_loans), `${snapshot.loans?.outstanding_count || 0} balances at period end`, COLORS.red],
    ['Investment assets', money(snapshot.headline?.investment_assets), 'Valued at report cut-off', COLORS.blue],
    ['Net group position', money(snapshot.headline?.net_group_position), 'Checkpoint group equity position', COLORS.blue],
    ['Active members', String(snapshot.headline?.active_members || 0), `${snapshot.contributions?.members_with_arrears || 0} with contribution arrears`, COLORS.amber],
  ];
  const gap = 5;
  const cardW = (W - 32 - gap * 2) / 3;
  metrics.forEach(([label, value, detail, accent], index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    metricCard(doc, { x: 16 + col * (cardW + gap), y: 34 + row * 32, w: cardW, label, value, detail, accent });
  });

  const H = doc.internal.pageSize.getHeight();
  const bottom = 22;
  const lineHeight = 4.5;
  let y = 105;
  sectionLabel(doc, 'Treasurer narrative', 16, y);
  y += 6;
  doc.setTextColor(...COLORS.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const executive = version.narrative?.executive_summary || snapshot.narrative_default?.executive_summary || '';
  const lines = doc.splitTextToSize(executive, W - 32);
  for (const line of lines) {
    if (y + lineHeight > H - bottom) {
      doc.addPage();
      pageTitle(doc, 'Executive Summary', `Q${report.quarter} FY${report.fiscal_year} · continued`);
      sectionLabel(doc, 'Treasurer narrative · continued', 16, 34);
      y = 41;
      doc.setTextColor(...COLORS.ink);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
    }
    doc.text(line, 16, y);
    y += lineHeight;
  }
  y += 8;

  if (y + 65 > H - bottom) {
    doc.addPage();
    pageTitle(doc, 'Executive Summary', `Q${report.quarter} FY${report.fiscal_year} · continued`);
    y = 34;
  }
  sectionLabel(doc, 'Financial position at period end', 16, y);
  autoTable(doc, {
    startY: y + 4,
    head: [['Position', 'Amount']],
    body: [
      ['Entry fees', money(snapshot.financial_position?.entry_fees)],
      ['Member contributions', money(snapshot.financial_position?.member_contributions)],
      ['Paid fines', money(snapshot.financial_position?.paid_fines)],
      ['Loan interest', money(snapshot.financial_position?.total_interest)],
      ['Less welfare', money(snapshot.financial_position?.welfare_paid)],
      ['Less operating expenses', money(snapshot.financial_position?.total_expenses)],
      ['Net group position', money(snapshot.financial_position?.net_group_position)],
    ],
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, textColor: COLORS.ink, lineColor: COLORS.line, lineWidth: 0.2 },
    headStyles: { fillColor: COLORS.blueSoft, textColor: COLORS.blue, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 16, right: 16 },
  });
}

function addContributionsPage(doc, report, snapshot) {
  doc.addPage();
  pageTitle(doc, 'Contributions', `Q${report.quarter} FY${report.fiscal_year}`);
  const W = doc.internal.pageSize.getWidth();

  metricCard(doc, { x: 16, y: 34, w: 54, label: 'Quarter received', value: money(snapshot.contributions?.quarter_received), detail: `Expected ${money(snapshot.contributions?.quarter_expected)}`, accent: COLORS.teal });
  metricCard(doc, { x: 78, y: 34, w: 54, label: 'Collection rate', value: pct(snapshot.contributions?.collection_rate), detail: `${snapshot.contributions?.fully_current_members || 0} fully current`, accent: COLORS.green });
  metricCard(doc, { x: 140, y: 34, w: W - 156, label: 'FY arrears', value: money(snapshot.contributions?.ytd_arrears), detail: `${snapshot.contributions?.members_with_arrears || 0} members`, accent: COLORS.amber });

  const rows = snapshot.contributions?.monthly || [];
  const max = Math.max(1, ...rows.map((row) => Math.max(Number(row.amount || 0), Number(row.expected || 0))));
  let y = 78;
  sectionLabel(doc, 'Quarter collection trend', 16, y);
  y += 8;
  rows.forEach((row) => {
    const label = `${MONTHS[row.month]} ${row.year}`;
    doc.setTextColor(...COLORS.muted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.text(label, 16, y + 3);
    const x = 42;
    const width = W - 74;
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(x, y - 1, width, 5, 2.5, 2.5, 'F');
    const amountWidth = width * (Number(row.amount || 0) / max);
    if (amountWidth > 0) {
      doc.setFillColor(...COLORS.teal);
      doc.roundedRect(x, y - 1, amountWidth, 5, Math.min(2.5, amountWidth / 2), 2.5, 'F');
    }
    doc.setTextColor(...COLORS.ink);
    doc.setFont('helvetica', 'normal');
    doc.text(money(row.amount), W - 16, y + 3, { align: 'right' });
    y += 13;
  });

  sectionLabel(doc, 'Member contribution standing', 16, y + 5);
  autoTable(doc, {
    startY: y + 9,
    head: [['Member', 'Quarter', 'FY to date', 'Expected', 'Arrears', 'Status']],
    body: (snapshot.member_standing || []).map((row) => [
      row.member_name,
      money(row.contributions_quarter),
      money(row.contributions_ytd),
      money(row.expected_ytd),
      money(row.contribution_arrears),
      row.status === 'current' ? 'Current' : 'Attention',
    ]),
    theme: 'striped',
    styles: { fontSize: 6.7, cellPadding: 2.4, textColor: COLORS.ink },
    headStyles: { fillColor: COLORS.blue, textColor: COLORS.white, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: 16, right: 16 },
  });
}

function addLoansPage(doc, report, snapshot) {
  doc.addPage();
  pageTitle(doc, 'Loan Portfolio', `Position at ${shortDate(report.period_end)}`);
  const W = doc.internal.pageSize.getWidth();
  const cards = [
    ['Loans issued', String(snapshot.loans?.issued_count || 0), money(snapshot.loans?.principal_issued), COLORS.blue],
    ['Repayments received', money(snapshot.loans?.repayments_received), 'During the quarter', COLORS.green],
    ['Outstanding balance', money(snapshot.loans?.outstanding_balance), `${snapshot.loans?.outstanding_count || 0} loan balances`, COLORS.red],
  ];
  cards.forEach(([label, value, detail, accent], index) => {
    metricCard(doc, { x: 16 + index * ((W - 32) / 3), y: 34, w: (W - 42) / 3, label, value, detail, accent });
  });

  sectionLabel(doc, 'Outstanding portfolio', 16, 72);
  autoTable(doc, {
    startY: 77,
    head: [['Loan #', 'Principal', 'Repayments', 'Penalty', 'Balance', 'Issued']],
    body: (snapshot.loans?.portfolio || []).map((loan) => [
      loan.loan_number || `#${loan.loan_id}`,
      money(loan.principal),
      money(loan.repayments_to_period_end),
      money(loan.penalty_at_period_end),
      money(loan.balance_at_period_end),
      shortDate(loan.issued_date),
    ]),
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 2.8, textColor: COLORS.ink, lineColor: COLORS.line, lineWidth: 0.2 },
    headStyles: { fillColor: COLORS.blueSoft, textColor: COLORS.blue, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 16, right: 16 },
  });

  const H = doc.internal.pageSize.getHeight();
  let y = doc.lastAutoTable.finalY + 12;
  if (y + 18 > H - 20) {
    doc.addPage();
    pageTitle(doc, 'Loan Portfolio', `Position at ${shortDate(report.period_end)} · continued`);
    y = 34;
  }
  sectionLabel(doc, 'Portfolio notes', 16, y);
  doc.setTextColor(...COLORS.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`${snapshot.loans?.overdue_count || 0} outstanding loan${snapshot.loans?.overdue_count === 1 ? '' : 's'} carried an overdue penalty at the report cut-off. Interest attached to loans issued during the quarter: ${money(snapshot.loans?.interest_on_quarter_loans)}.`, 16, y + 7, { maxWidth: W - 32 });
}

function addInvestmentsPage(doc, report, snapshot) {
  doc.addPage();
  pageTitle(doc, 'Investments', `Valuation at ${shortDate(report.period_end)}`);
  const W = doc.internal.pageSize.getWidth();

  metricCard(doc, { x: 16, y: 34, w: 55, label: 'Invested cost', value: money(snapshot.investments?.total_invested_cost), detail: 'Cost carried into period end', accent: COLORS.blue });
  metricCard(doc, { x: 78, y: 34, w: 55, label: 'Current value', value: money(snapshot.investments?.current_value), detail: 'NAV where available', accent: COLORS.teal });
  metricCard(doc, { x: 140, y: 34, w: W - 156, label: 'Gain / loss', value: money(snapshot.investments?.gain_loss), detail: 'Unrealised valuation movement', accent: Number(snapshot.investments?.gain_loss || 0) >= 0 ? COLORS.green : COLORS.red });

  sectionLabel(doc, 'Holdings', 16, 73);
  autoTable(doc, {
    startY: 78,
    head: [['Provider', 'Asset class', 'Cost', 'NAV / unit', 'Value', 'Basis']],
    body: (snapshot.investments?.holdings || []).map((holding) => [
      holding.provider,
      holding.asset_class || '—',
      money(holding.amount),
      holding.latest_unit_cost == null ? '—' : Number(holding.latest_unit_cost).toLocaleString('en-US'),
      money(holding.current_value),
      holding.valuation === 'at_nav' ? `NAV · ${shortDate(holding.nav_effective_date)}` : 'At cost',
    ]),
    theme: 'striped',
    styles: { fontSize: 7, cellPadding: 2.8, textColor: COLORS.ink },
    headStyles: { fillColor: COLORS.blue, textColor: COLORS.white, fontStyle: 'bold' },
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 16, right: 16 },
  });
}

function addCashOperationsPage(doc, report, snapshot) {
  doc.addPage();
  pageTitle(doc, 'Cash, Expenses & Welfare', `Q${report.quarter} FY${report.fiscal_year}`);

  sectionLabel(doc, 'Cash position', 16, 34);
  const cash = snapshot.cash_position || {};
  const cashRows = cash.source === 'reconciled_plus_ledger_movements'
    ? [
        ['Opening reconciled cash', money(cash.reconciled_balance)],
        ['Entry fees received', money(cash.entry_fees_received)],
        ['Contribution receipts', money(cash.contributions_received)],
        ['Loan repayments', money(cash.loan_repayments_received)],
        ['Fine receipts', money(cash.fines_received)],
        ['Loan disbursements', `(${money(cash.loan_disbursements)})`],
        ['Operating expenses', `(${money(cash.expenses_paid)})`],
        ['Welfare payouts', `(${money(cash.welfare_paid)})`],
        ['Investment transfers', `(${money(cash.investment_transfers)})`],
        ['Closing cash position', money(cash.closing_balance)],
      ]
    : [
        ['Closing cash position', money(cash.closing_balance)],
        ['Basis', 'Calculated fallback — no eligible reconciliation at cut-off'],
      ];
  autoTable(doc, {
    startY: 39,
    head: [['Cash bridge', 'Amount']],
    body: cashRows,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 3, textColor: COLORS.ink, lineColor: COLORS.line, lineWidth: 0.2 },
    headStyles: { fillColor: COLORS.blueSoft, textColor: COLORS.blue, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 16, right: 16 },
  });

  let y = doc.lastAutoTable.finalY + 12;
  sectionLabel(doc, 'Quarter operating activity', 16, y);
  y += 6;
  const W = doc.internal.pageSize.getWidth();
  metricCard(doc, { x: 16, y, w: 55, label: 'Expenses', value: money(snapshot.expenses?.quarter_total), detail: `FY to date ${money(snapshot.expenses?.ytd_total)}`, accent: COLORS.red });
  metricCard(doc, { x: 78, y, w: 55, label: 'Welfare', value: money(snapshot.welfare?.quarter_total), detail: `${snapshot.welfare?.event_count || 0} approved event(s)`, accent: COLORS.amber });
  metricCard(doc, { x: 140, y, w: W - 156, label: 'Fines collected', value: money(snapshot.fines?.paid_quarter), detail: `Outstanding ${money(snapshot.fines?.outstanding_at_period_end)}`, accent: COLORS.teal });

  y += 35;
  sectionLabel(doc, 'Expense categories', 16, y);
  autoTable(doc, {
    startY: y + 4,
    head: [['Category', 'Quarter amount']],
    body: (snapshot.expenses?.categories || []).map((row) => [row.category, money(row.amount)]),
    theme: 'striped',
    styles: { fontSize: 8, cellPadding: 3, textColor: COLORS.ink },
    headStyles: { fillColor: COLORS.blue, textColor: COLORS.white, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
    margin: { left: 16, right: 16 },
  });
}

function addControlsPage(doc, report, version, snapshot) {
  doc.addPage();
  pageTitle(doc, 'Controls & Member Standing', `Draft version ${version.version_number}`);
  const W = doc.internal.pageSize.getWidth();

  const H = doc.internal.pageSize.getHeight();
  const bottom = 22;
  const lineHeight = 4;
  const newContinuationPage = (section) => {
    doc.addPage();
    pageTitle(doc, 'Controls & Member Standing', `Draft version ${version.version_number} · continued`);
    sectionLabel(doc, section, 16, 34);
    return 41;
  };

  sectionLabel(doc, 'Management notes', 16, 34);
  doc.setTextColor(...COLORS.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const notes = version.narrative?.management_notes || 'No additional management notes have been added to this draft.';
  const noteLines = doc.splitTextToSize(notes, W - 32);
  let y = 41;
  for (const line of noteLines) {
    if (y + lineHeight > H - bottom) {
      y = newContinuationPage('Management notes · continued');
      doc.setTextColor(...COLORS.ink);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
    }
    doc.text(line, 16, y);
    y += lineHeight;
  }
  y += 8;
  if (y + 14 > H - bottom) y = newContinuationPage('Controls & exceptions');
  else sectionLabel(doc, 'Controls & exceptions', 16, y);
  y += 5;

  const controls = snapshot.controls?.flags || [];
  if (!controls.length) {
    doc.setTextColor(...COLORS.green);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('No material report controls or exceptions are recorded for this snapshot.', 16, y + 5);
    y += 14;
  } else {
    controls.forEach((control) => {
      const lines = doc.splitTextToSize(control.message || '', W - 42);
      const label = String(control.type || 'control').replaceAll('_', ' ').toUpperCase();
      let offset = 0;
      let segment = 0;

      while (offset < lines.length || (lines.length === 0 && segment === 0)) {
        if (y + 13 > H - bottom) y = newContinuationPage('Controls & exceptions · continued');
        const availableHeight = H - bottom - y;
        const maxLines = Math.max(1, Math.floor((availableHeight - 7) / 4));
        const chunk = lines.length ? lines.slice(offset, offset + maxLines) : [''];
        const boxHeight = Math.max(13, chunk.length * 4 + 7);

        doc.setFillColor(...(control.severity === 'attention' ? [255, 247, 237] : COLORS.blueSoft));
        doc.roundedRect(16, y, W - 32, boxHeight, 2, 2, 'F');
        doc.setTextColor(...(control.severity === 'attention' ? COLORS.amber : COLORS.blue));
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6.5);
        doc.text(segment === 0 ? label : `${label} · CONTINUED`, 20, y + 5);
        doc.setTextColor(...COLORS.ink);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.text(chunk, 20, y + 10);

        offset += chunk.length;
        segment += 1;
        y += boxHeight + 4;
        if (offset < lines.length) y = newContinuationPage('Controls & exceptions · continued');
      }
    });
  }

  if (y + 18 > H - bottom) y = newContinuationPage('Member financial standing');
  else sectionLabel(doc, 'Member financial standing', 16, y + 4);
  autoTable(doc, {
    startY: y + 9,
    head: [['Member', 'FY contributions', 'Arrears', 'Loan balance', 'Fines', 'Status']],
    body: (snapshot.member_standing || []).map((row) => [
      row.member_name,
      money(row.contributions_ytd),
      money(row.contribution_arrears),
      money(row.loan_balance),
      money(row.outstanding_fines),
      row.status === 'current' ? 'Current' : 'Attention',
    ]),
    theme: 'grid',
    styles: { fontSize: 6.7, cellPadding: 2.4, textColor: COLORS.ink, lineColor: COLORS.line, lineWidth: 0.15 },
    headStyles: { fillColor: COLORS.ink, textColor: COLORS.white, fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: 16, right: 16 },
  });
}

function decoratePages(doc, report, version) {
  const pages = doc.internal.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    if (page > 1) {
      doc.setFillColor(...COLORS.blue);
      doc.rect(0, 0, W, 3, 'F');
    }
    doc.setDrawColor(...COLORS.line);
    doc.line(16, H - 13, W - 16, H - 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...COLORS.muted);
    doc.text(`${report.report_number} · Version ${version.version_number} · DRAFT`, 16, H - 7);
    doc.text(`Page ${page} of ${pages}`, W - 16, H - 7, { align: 'right' });
  }
}

export function buildQuarterlyReportDoc(report, version) {
  if (!report || !version?.financial_snapshot) throw new Error('Quarterly report data is incomplete');
  const snapshot = version.financial_snapshot;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  addCover(doc, report, version, snapshot);
  addExecutivePage(doc, report, version, snapshot);
  addContributionsPage(doc, report, snapshot);
  addLoansPage(doc, report, snapshot);
  addInvestmentsPage(doc, report, snapshot);
  addCashOperationsPage(doc, report, snapshot);
  addControlsPage(doc, report, version, snapshot);
  decoratePages(doc, report, version);
  return doc;
}

export function downloadQuarterlyReportPdf(report, version) {
  const doc = buildQuarterlyReportDoc(report, version);
  const filename = `${String(report.report_number || 'quarterly-report').toLowerCase()}-v${version.version_number}.pdf`;
  doc.save(filename);
  return filename;
}
