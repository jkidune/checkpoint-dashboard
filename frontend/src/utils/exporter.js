import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── RFC 4180 CSV Builder ────────────────────────────────────────────────────

function escapeCell(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function toCSVRow(cells) {
  return cells.map(escapeCell).join(',');
}

function triggerDownload(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Summary CSV ─────────────────────────────────────────────────────────────

export function exportSummaryCSV(data) {
  const { equity, liabilities, cash_at_bank, active_members, active_loans, active_loan_list } = data;
  const now = new Date().toLocaleDateString('en-GB');

  const rows = [
    ['CHECKPOINT INVESTMENT CLUB - FINANCIAL SUMMARY'],
    ['Generated: ' + now],
    [],
    ['EQUITY BREAKDOWN'],
    ['Metric', 'Amount (TZS)'],
    ['Total Equity',         equity.total],
    ['Member Contributions', equity.member_contributions],
    ['Entry Fees',           equity.entry_fees],
    ['Net Profit',           equity.net_profit],
    ['Cash at Bank',         cash_at_bank],
    ['Loans in Circulation', liabilities.in_circulation],
    [],
    ['Active Members', active_members],
    ['Active Loans',   active_loans],
    [],
    ['ACTIVE LOANS'],
    ['Member', 'Loan #', 'Principal (TZS)', 'Interest (TZS)', 'Issued Date', 'Balance (TZS)', 'Status'],
    ...(active_loan_list || []).map((l) => [
      l.member_name, l.loan_number,
      Math.round(l.principal), Math.round(l.interest_amount),
      l.issued_date, Math.round(l.balance), l.status,
    ]),
  ];

  triggerDownload(
    'checkpoint-summary-' + now.replace(/\//g, '-') + '.csv',
    rows.map(toCSVRow).join('\r\n'),
  );
}

// ─── Contributions CSV ────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function exportContributionsCSV(gridData, year) {
  const { grid, monthlyTotals } = gridData;
  const now = new Date().toLocaleDateString('en-GB');

  const rows = [
    ['CHECKPOINT INVESTMENT CLUB - CONTRIBUTIONS FY' + year],
    ['Generated: ' + now],
    [],
    ['Member', 'Role', ...MONTHS, 'Total (TZS)'],
    ...grid.map((row) => [
      row.member_name, row.role,
      ...Array.from({ length: 12 }, (_, i) => row.months[i + 1]?.amount || 0),
      row.total,
    ]),
    ['TOTAL', '',
      ...Array.from({ length: 12 }, (_, i) => monthlyTotals[i + 1] || 0),
      grid.reduce((s, r) => s + r.total, 0),
    ],
  ];

  triggerDownload(
    'checkpoint-contributions-fy' + year + '-' + now.replace(/\//g, '-') + '.csv',
    rows.map(toCSVRow).join('\r\n'),
  );
}

// ─── Checkpoint-Branded PDF ───────────────────────────────────────────────────

const C = {
  dark:    [15,  23,  42],
  surface: [30,  41,  59],
  alt:     [22,  33,  52],
  border:  [51,  65,  85],
  blue:    [14, 165, 233],
  teal:    [20, 184, 166],
  amber:   [245,158,  11],
  red:     [239,  68,  68],
  text:    [226,232, 240],
  muted:   [148,163, 184],
};

function fmtTZS(n) {
  if (n === null || n === undefined) return '-';
  return 'TZS ' + Math.round(n).toLocaleString();
}

function buildSummaryDoc(data) {
  const doc     = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W       = doc.internal.pageSize.getWidth();
  const now     = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // Header banner
  doc.setFillColor(...C.dark);
  doc.rect(0, 0, W, 42, 'F');
  doc.setFillColor(...C.blue);
  doc.rect(0, 38, W, 4, 'F');

  doc.setTextColor(...C.text);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('CHECKPOINT', 14, 19);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...C.muted);
  doc.text('INVESTMENT CLUB', 14, 26);

  doc.setTextColor(...C.blue);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('FINANCIAL SUMMARY', W - 14, 17, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...C.muted);
  doc.text(dateStr, W - 14, 23, { align: 'right' });

  // KPI boxes — 2 rows x 3 cols
  let y = 54;
  const kpis = [
    { label: 'Total Equity',        value: fmtTZS(data.equity.total),                color: C.blue  },
    { label: 'Contributions',       value: fmtTZS(data.equity.member_contributions),  color: C.teal  },
    { label: 'Net Profit',          value: fmtTZS(data.equity.net_profit),             color: C.amber },
    { label: 'Cash at Bank',        value: fmtTZS(data.cash_at_bank),                  color: C.teal  },
    { label: 'Loans Outstanding',   value: fmtTZS(data.liabilities.in_circulation),    color: C.red   },
    { label: 'Active Members',      value: String(data.active_members),                color: C.blue  },
  ];

  const cols = 3;
  const gap  = 5;
  const boxW = (W - 28 - gap * (cols - 1)) / cols;
  const boxH = 18;

  kpis.forEach((kpi, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x   = 14 + col * (boxW + gap);
    const by  = y + row * (boxH + 4);

    doc.setFillColor(...C.surface);
    doc.roundedRect(x, by, boxW, boxH, 2, 2, 'F');

    doc.setDrawColor(...kpi.color);
    doc.setLineWidth(0.7);
    doc.line(x + 1, by + boxH - 0.8, x + boxW - 1, by + boxH - 0.8);

    doc.setTextColor(...C.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text(kpi.label.toUpperCase(), x + 5, by + 6.5);

    doc.setTextColor(...C.text);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(kpi.value, x + 5, by + 13.5);
  });

  y += 2 * (boxH + 4) + 10;

  // Capital Structure table
  doc.setTextColor(...C.text);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Capital Structure', 14, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [['Component', 'Amount (TZS)']],
    body: [
      ['Member Contributions',          Math.round(data.equity.member_contributions).toLocaleString()],
      ['Entry Fees',                    Math.round(data.equity.entry_fees).toLocaleString()],
      ['Net Profit (Interest + Fines)', Math.round(data.equity.net_profit).toLocaleString()],
      ['Welfare Paid Out',              Math.round(data.equity.welfare_paid || 0).toLocaleString()],
      ['Total Equity',                  Math.round(data.equity.total).toLocaleString()],
    ],
    styles:             { fontSize: 8, cellPadding: 4, fillColor: C.surface, textColor: C.text, lineColor: C.border, lineWidth: 0.2 },
    headStyles:         { fillColor: C.dark, textColor: C.blue, fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: C.alt },
    columnStyles:       { 0: { cellWidth: 115 }, 1: { halign: 'right', fontStyle: 'bold' } },
    margin:             { left: 14, right: 14 },
  });

  y = doc.lastAutoTable.finalY + 10;

  // Active Loans table
  doc.setTextColor(...C.text);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Active Loans  (' + (data.active_loans || 0) + ')', 14, y);
  y += 3;

  const loanRows = (data.active_loan_list || []).map((l) => [
    l.member_name, l.loan_number,
    Math.round(l.principal).toLocaleString(),
    Math.round(l.interest_amount).toLocaleString(),
    l.issued_date,
    Math.round(l.balance).toLocaleString(),
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Member', 'Loan #', 'Principal', 'Interest', 'Issued', 'Balance']],
    body:  loanRows.length ? loanRows : [['No active loans', '', '', '', '', '']],
    styles:             { fontSize: 7.5, cellPadding: 3, fillColor: C.surface, textColor: C.text, lineColor: C.border, lineWidth: 0.2 },
    headStyles:         { fillColor: C.dark, textColor: C.blue, fontStyle: 'bold', fontSize: 7.5 },
    alternateRowStyles: { fillColor: C.alt },
    columnStyles:       { 2: { halign: 'right' }, 3: { halign: 'right', textColor: C.amber }, 5: { halign: 'right', textColor: C.red, fontStyle: 'bold' } },
    margin:             { left: 14, right: 14 },
  });

  // Footer on every page
  const pageCount = doc.internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    const PH = doc.internal.pageSize.getHeight();
    doc.setFillColor(...C.dark);
    doc.rect(0, PH - 12, W, 12, 'F');
    doc.setTextColor(...C.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text('Checkpoint Investment Club - Confidential Financial Document', 14, PH - 5);
    doc.text('Page ' + p + ' of ' + pageCount, W - 14, PH - 5, { align: 'right' });
  }

  return doc;
}

/** Download the summary PDF to the browser. */
export function exportSummaryPDF(data) {
  const doc      = buildSummaryDoc(data);
  const filename = 'checkpoint-summary-' + new Date().toISOString().slice(0, 10) + '.pdf';
  doc.save(filename);
  return filename;
}

/**
 * Return the summary as Base64 (for email attachment) WITHOUT downloading.
 * @returns {{ base64: string, filename: string }}
 */
export function getSummaryPDFBase64(data) {
  const doc      = buildSummaryDoc(data);
  const filename = 'checkpoint-summary-' + new Date().toISOString().slice(0, 10) + '.pdf';
  const base64   = doc.output('datauristring').split(',')[1];
  return { base64, filename };
}
