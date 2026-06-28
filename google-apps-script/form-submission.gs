// ─────────────────────────────────────────────────────────────────────────────
// Checkpoint Investment Club — Google Form → MongoDB sync
//
// SETUP INSTRUCTIONS:
//   1. Open your Google Form → ⋮ menu → Script editor
//   2. Paste this entire file, replacing any existing code
//   3. Set the two constants below (API_URL and FORM_SECRET)
//   4. Click the clock icon (Triggers) → Add Trigger:
//        Function: onFormSubmit | Event source: From form | Event type: On form submit
//   5. Authorize when prompted
//   6. Run testConnection() manually first to verify, then submit a real form response
// ─────────────────────────────────────────────────────────────────────────────

var API_URL     = 'https://backend-production-3d964.up.railway.app/api/forms/contribution';
var FORM_SECRET = 'REPLACE_WITH_YOUR_FORM_SECRET'; // must match FORM_SECRET in Vercel env vars

// ── Field titles (must match your form question text exactly) ─────────────────
var FIELD_MEMBER  = 'Jina la Mchangiaji';
var FIELD_AMOUNT  = 'Kiwango cha mchango';
var FIELD_DATE    = 'Tarehe ya Mchango';
var FIELD_TYPE    = 'Aina ya mchango';
var FIELD_MONTHS  = 'Kama ni mchango wa mwezi, Taja mwezi husika';
var FIELD_MPESA   = 'Namba ya muamala wa uthibitisho';
var FIELD_NOTES   = 'Maelezo ya ziada';
var FIELD_LOAN    = 'Namba ya mkopo';

// ── Type mapping (Swahili form option → API value) ────────────────────────────
var TYPE_MAP = {
  'mchango wa mwezi': 'monthly',
  'monthly contribution': 'monthly',
  'rejesho la deni':  'loan_repayment',
  'rejesho la mkopo': 'loan_repayment',
  'loan repayment':   'loan_repayment',
  'loan return':      'loan_repayment',
  'fine':             'fine',
  'fine payment':     'fine',
  'entry fee':        'entry_fee',
  'welfare contribution': 'welfare',
  'other approved payment': 'other_approved',
};

// ── Main trigger — fires on every real form submission ────────────────────────
function onFormSubmit(e) {
  try {
    // Form-bound scripts receive e.response (a FormResponse object).
    // e.namedValues is only available in Sheets-bound scripts — don't use it.
    var itemResponses = e.response.getItemResponses();

    // Build a plain map: { questionTitle: responseValue }
    var r = {};
    for (var i = 0; i < itemResponses.length; i++) {
      var ir    = itemResponses[i];
      var title = ir.getItem().getTitle();
      var val   = ir.getResponse(); // string, array (checkboxes), or string[] (grid)
      r[title]  = val;
    }

    var memberName = asString(r[FIELD_MEMBER]);
    var amount     = asString(r[FIELD_AMOUNT]);
    var dateRaw    = asString(r[FIELD_DATE]);
    var typeRaw    = asString(r[FIELD_TYPE]);
    var monthsRaw  = r[FIELD_MONTHS]; // checkboxes → array or comma string
    var mpesaRef   = asString(r[FIELD_MPESA]);
    var notes      = asString(r[FIELD_NOTES]);
    var loanNumber = asString(r[FIELD_LOAN]);

    Logger.log('Raw form values: ' + JSON.stringify({
      memberName: memberName, amount: amount, dateRaw: dateRaw,
      typeRaw: typeRaw, monthsRaw: monthsRaw, mpesaRef: mpesaRef,
      loanNumber: loanNumber, notes: notes
    }));

    // Map Swahili type to API value
    var type = TYPE_MAP[normalizeLabel(typeRaw)];
    if (!type) {
      logError('Unknown contribution type: "' + typeRaw + '"');
      return;
    }

    // Months: Google Forms checkboxes return an array; guard against string too
    var months = [];
    if (Array.isArray(monthsRaw)) {
      months = monthsRaw.filter(Boolean);
    } else if (typeof monthsRaw === 'string' && monthsRaw) {
      months = monthsRaw.split(',').map(function(m) { return m.trim(); }).filter(Boolean);
    }

    // Format date to YYYY-MM-DD
    var date = formatDate(dateRaw);
    if (!date) {
      logError('Could not parse date: "' + dateRaw + '"');
      return;
    }

    var payload = {
      memberName: memberName,
      amount:     parseFloat(amount.replace(/[^0-9.]/g, '')),
      date:       date,
      type:       type,
      months:     months,
      mpesaRef:   mpesaRef || '',
      notes:      notes || '',
      loanNumber: loanNumber || '',
    };

    Logger.log('Submitting payload: ' + JSON.stringify(payload));
    var result = postToApi(payload);
    Logger.log('Success: ' + JSON.stringify(result));

  } catch (err) {
    logError('onFormSubmit exception: ' + err.message);
  }
}

// ── POST to Checkpoint API ────────────────────────────────────────────────────
function postToApi(payload) {
  var options = {
    method:             'post',
    contentType:        'application/json',
    headers:            { 'X-Form-Secret': FORM_SECRET },
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(API_URL, options);
  var code     = response.getResponseCode();
  var body     = response.getContentText();

  if (code < 200 || code >= 300) {
    logError('API error ' + code + ': ' + body);
    throw new Error('API returned ' + code + ': ' + body);
  }

  return JSON.parse(body);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Always return a trimmed string regardless of input type
function asString(val) {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) return val[0] ? val[0].toString().trim() : '';
  return val.toString().trim();
}

function normalizeLabel(val) {
  return asString(val).toLowerCase().replace(/\s+/g, ' ').trim();
}

// Convert any date string to YYYY-MM-DD
// Google Forms date fields return "2026-04-24" (ISO) — this handles that plus fallbacks
function formatDate(str) {
  if (!str) return null;
  str = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;  // already ISO
  var d = new Date(str);
  if (isNaN(d.getTime())) return null;
  var yyyy = d.getFullYear();
  var mm   = String(d.getMonth() + 1).padStart(2, '0');
  var dd   = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

function logError(message) {
  Logger.log('ERROR: ' + message);
}

// ── Run this manually to verify the API connection before going live ──────────
function testConnection() {
  var payload = {
    memberName: 'Joseph Masonda',
    amount:     75000,
    date:       '2026-04-24',
    type:       'monthly',
    months:     ['April'],
    mpesaRef:   'TEST123',
    notes:      'Connection test — delete this entry',
  };
  try {
    var result = postToApi(payload);
    Logger.log('Test passed: ' + JSON.stringify(result));
  } catch (err) {
    Logger.log('Test failed: ' + err.message);
  }
}
