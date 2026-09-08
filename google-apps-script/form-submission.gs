// ─────────────────────────────────────────────────────────────────────────────
// Checkpoint Investment Club — Google Form → Admin-verified Form Intake
//
// IMPORTANT: This script stages payments for review. It must point to
// /api/forms/intake, never the legacy direct-write /api/forms/contribution route.
//
// SETUP INSTRUCTIONS:
//   1. Open Google Form → ⋮ → Script editor.
//   2. Paste this file.
//   3. In Apps Script Project Settings → Script properties add:
//        CHECKPOINT_API_URL = https://<your-api-host>/api/forms/intake
//        CHECKPOINT_FORM_SECRET = <same FORM_SECRET used by the backend>
//   4. Triggers → Add Trigger:
//        Function: onFormSubmit | Event source: From form | Event type: On form submit
//   5. Authorize when prompted.
//   6. Run testConnection() manually, then remove its staged test row in Checkpoint.
// ─────────────────────────────────────────────────────────────────────────────

var SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
var API_URL = SCRIPT_PROPERTIES.getProperty('CHECKPOINT_API_URL')
  || 'https://backend-production-3d964.up.railway.app/api/forms/intake';
var FORM_SECRET = SCRIPT_PROPERTIES.getProperty('CHECKPOINT_FORM_SECRET')
  || 'REPLACE_WITH_YOUR_FORM_SECRET';

// ── Field titles (must match your form question text exactly) ─────────────────
var FIELD_MEMBER  = 'Jina la Mchangiaji';
var FIELD_AMOUNT  = 'Kiwango cha mchango';
var FIELD_DATE    = 'Tarehe ya Mchango';
var FIELD_TYPE    = 'Aina ya mchango';
var FIELD_MONTHS  = 'Kama ni mchango wa mwezi, Taja mwezi husika';
var FIELD_MPESA   = 'Namba ya muamala wa uthibitisho';
var FIELD_NOTES   = 'Maelezo ya ziada';

// ── Type mapping (member declaration only; Admin may reallocate later) ────────
var TYPE_MAP = {
  'Mchango wa mwezi': 'monthly',
  'Mchango wa Mwezi': 'monthly',
  'Monthly contribution': 'monthly',
  'Rejesho la deni': 'loan_repayment',
  'Rejesho la mkopo': 'loan_repayment',
  'Malipo ya mkopo': 'loan_repayment',
  'Loan repayment': 'loan_repayment',
  'Loan return': 'loan_repayment',
  'Loan Returns': 'loan_repayment',
  'Fine': 'fine',
  'Faini': 'fine',
  'Fine payment': 'fine',
};

function onFormSubmit(e) {
  try {
    var itemResponses = e.response.getItemResponses();
    var r = {};
    for (var i = 0; i < itemResponses.length; i++) {
      var ir = itemResponses[i];
      r[ir.getItem().getTitle()] = ir.getResponse();
    }

    var memberName = asString(r[FIELD_MEMBER]);
    var amount = asString(r[FIELD_AMOUNT]);
    var dateRaw = asString(r[FIELD_DATE]);
    var typeRaw = asString(r[FIELD_TYPE]);
    var monthsRaw = r[FIELD_MONTHS];
    var mpesaRef = asString(r[FIELD_MPESA]);
    var notes = asString(r[FIELD_NOTES]);

    var type = TYPE_MAP[typeRaw];
    Logger.log('Form contribution type received: "' + typeRaw + '" → "' + type + '"');
    if (!type) {
      logError('Unknown contribution type: "' + typeRaw + '"');
      return;
    }

    var months = [];
    if (Array.isArray(monthsRaw)) {
      months = monthsRaw.filter(Boolean);
    } else if (typeof monthsRaw === 'string' && monthsRaw) {
      months = monthsRaw.split(',').map(function(m) { return m.trim(); }).filter(Boolean);
    }

    var date = formatDate(dateRaw);
    if (!date) {
      logError('Could not parse date: "' + dateRaw + '"');
      return;
    }

    var numericAmount = parseFloat(amount.replace(/[^0-9.]/g, ''));
    if (!isFinite(numericAmount) || numericAmount <= 0) {
      logError('Invalid contribution amount: "' + amount + '"');
      return;
    }

    var payload = {
      memberName: memberName,
      amount: numericAmount,
      date: date,
      type: type,
      months: months,
      mpesaRef: mpesaRef || '',
      notes: notes || '',
      submittedAt: new Date().toISOString(),
    };

    Logger.log('Staging payment for Admin review: ' + JSON.stringify(payload));
    var result = postToApi(payload);
    Logger.log('Form Intake result: ' + JSON.stringify(result));
  } catch (err) {
    logError('onFormSubmit exception: ' + err.message);
  }
}

function postToApi(payload) {
  if (!API_URL || API_URL.indexOf('/api/forms/intake') === -1) {
    throw new Error('CHECKPOINT_API_URL must point to /api/forms/intake');
  }
  if (!FORM_SECRET || FORM_SECRET === 'REPLACE_WITH_YOUR_FORM_SECRET') {
    throw new Error('CHECKPOINT_FORM_SECRET is not configured');
  }

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Form-Secret': FORM_SECRET },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(API_URL, options);
  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code < 200 || code >= 300) {
    logError('API error ' + code + ': ' + body);
    throw new Error('API returned ' + code + ': ' + body);
  }

  return JSON.parse(body);
}

function asString(val) {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) return val[0] ? val[0].toString().trim() : '';
  return val.toString().trim();
}

function formatDate(str) {
  if (!str) return null;
  str = str.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  var d = new Date(str);
  if (isNaN(d.getTime())) return null;
  var yyyy = d.getFullYear();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

function logError(message) {
  Logger.log('ERROR: ' + message);
}

function testConnection() {
  var payload = {
    memberName: 'Joseph Masonda',
    amount: 75000,
    date: '2026-09-08',
    type: 'monthly',
    months: ['August'],
    mpesaRef: 'TEST-' + new Date().getTime(),
    notes: 'Connection test — staged only, do not post',
    submittedAt: new Date().toISOString(),
  };
  try {
    var result = postToApi(payload);
    Logger.log('Test passed: ' + JSON.stringify(result));
  } catch (err) {
    Logger.log('Test failed: ' + err.message);
  }
}
