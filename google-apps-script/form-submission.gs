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
//   6. Submit a test response to verify
// ─────────────────────────────────────────────────────────────────────────────

var API_URL     = 'https://checkpoint-dashboard-roan.vercel.app/api/forms/contribution';
var FORM_SECRET = 'REPLACE_WITH_YOUR_FORM_SECRET'; // must match FORM_SECRET in Vercel env vars

// ── Field titles (must match your form exactly) ───────────────────────────────
var FIELD_MEMBER  = 'Jina la Mchangiaji';
var FIELD_AMOUNT  = 'Kiwango cha mchango';
var FIELD_DATE    = 'Tarehe ya Mchango';
var FIELD_TYPE    = 'Aina ya mchango';
var FIELD_MONTHS  = 'Kama ni mchango wa mwezi, Taja mwezi husika';
var FIELD_MPESA   = 'Namba ya muamala wa uthibitisho';
var FIELD_NOTES   = 'Maelezo ya ziada';

// ── Type mapping (Swahili → API value) ───────────────────────────────────────
var TYPE_MAP = {
  'Mchango wa mwezi': 'monthly',
  'Rejesho la deni':  'loan_repayment',
  'Fine':             'fine',
};

// ── Main trigger function ─────────────────────────────────────────────────────
function onFormSubmit(e) {
  try {
    var responses = e.namedValues;

    var memberName = getValue(responses, FIELD_MEMBER);
    var amount     = getValue(responses, FIELD_AMOUNT);
    var dateRaw    = getValue(responses, FIELD_DATE);
    var typeRaw    = getValue(responses, FIELD_TYPE);
    var monthsRaw  = getValue(responses, FIELD_MONTHS);
    var mpesaRef   = getValue(responses, FIELD_MPESA);
    var notes      = getValue(responses, FIELD_NOTES);

    // Map type from Swahili to API value
    var type = TYPE_MAP[typeRaw];
    if (!type) {
      logError('Unknown contribution type: ' + typeRaw);
      return;
    }

    // Parse months (checkbox field returns comma-separated string)
    var months = monthsRaw
      ? monthsRaw.split(',').map(function(m) { return m.trim(); }).filter(Boolean)
      : [];

    // Parse and format date (Google Forms gives "Month Day, Year" e.g. "April 24, 2026")
    var date = formatDate(dateRaw);
    if (!date) {
      logError('Could not parse date: ' + dateRaw);
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
    };

    var result = postToApi(payload);
    Logger.log('Success: ' + JSON.stringify(result));

  } catch (err) {
    logError('onFormSubmit exception: ' + err.message);
  }
}

// ── POST to Checkpoint API ────────────────────────────────────────────────────
function postToApi(payload) {
  var options = {
    method:      'post',
    contentType: 'application/json',
    headers:     { 'X-Form-Secret': FORM_SECRET },
    payload:     JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(API_URL, options);
  var code     = response.getResponseCode();
  var body     = response.getContentText();

  if (code < 200 || code >= 300) {
    logError('API error ' + code + ': ' + body);
    throw new Error('API returned ' + code);
  }

  return JSON.parse(body);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Safely get the first value from a named-values map
function getValue(responses, fieldName) {
  var vals = responses[fieldName];
  return (vals && vals.length > 0) ? vals[0].trim() : '';
}

// Convert Google Forms date string to YYYY-MM-DD
// Google gives "April 24, 2026" or already ISO "2026-04-24"
function formatDate(str) {
  if (!str) return null;
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(str.trim())) return str.trim();
  // Try parsing
  var d = new Date(str);
  if (isNaN(d.getTime())) return null;
  var yyyy = d.getFullYear();
  var mm   = String(d.getMonth() + 1).padStart(2, '0');
  var dd   = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

// Log errors to a "Form Errors" Google Sheet (optional but useful)
function logError(message) {
  Logger.log('ERROR: ' + message);
  // Uncomment to also write errors to a spreadsheet:
  // var ss = SpreadsheetApp.openById('YOUR_SHEET_ID');
  // var sheet = ss.getSheetByName('Errors') || ss.insertSheet('Errors');
  // sheet.appendRow([new Date(), message]);
}

// ── Test function — run manually to verify connection ─────────────────────────
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
