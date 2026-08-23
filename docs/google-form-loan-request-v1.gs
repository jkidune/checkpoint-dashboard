// Checkpoint Loan Request Form Intake v2
// Exact integration for: FOMU YA MAOMBI YA MKOPO CHECKPOINT INVESTORS CLUB
//
// Safe flow:
// Google Form / response Sheet -> Checkpoint Loan Requests inbox -> Admin review
// -> pending loan -> deliberate Admin disbursement.
//
// Required Script Properties (same values used by contribution intake):
//   CHECKPOINT_API_URL = https://your-current-checkpoint-domain
//   FORM_SECRET        = same FORM_SECRET configured in Vercel
//
// This script supports BOTH a Form-bound "On form submit" trigger and a
// response-Sheet-bound "On form submit" trigger.

var FIELDS = {
  member: ['Jina la Mwombaji'],
  amount: ['Kiasi cha mkopo unaoombwa'],
  interest: ['Riba'],
  term: ['Marejesho yatakuwa ni kwa miezi'],
  monthlyRepayment: ['Kiasi cha rejesho kila mwezi ni shilingi (Jumuisha na riba)'],
  hasOtherDebt: ['Mwombaji ana deni lingine'],
  lastLoanMonth: ['Mwezi wa mwisho kukopa'],
  lastLoanAmount: ['Ulikopa kiasi gani mwezi wa mwisho kukopa'],
  repaymentsCompletedBy: ['Marejesho yalikamilika kwa miezi'],
  committeeApproved: ['Ombi la mkopo mpya limepitishwa na kamati tendaji'],
  disbursementPhone: ['Kiasi cha mkopo kitatumwa kwenda namba'],
  oathAccepted: [
    'KIAPO: Naahidi kulipa mkopo huu kwa wakati',
    'KIAPO:  Naahidi kulipa mkopo huu kwa wakati',
  ],
  date: ['Tarehe'],
};

function checkpointConfig() {
  var props = PropertiesService.getScriptProperties();
  var apiBase = String(props.getProperty('CHECKPOINT_API_URL') || '').trim().replace(/\/$/, '');
  var secret = String(props.getProperty('FORM_SECRET') || '').trim();

  if (!apiBase) throw new Error('CHECKPOINT_API_URL is not configured in Script Properties.');
  if (!secret) throw new Error('FORM_SECRET is not configured in Script Properties.');

  return {
    apiUrl: apiBase + '/api/forms/loan-request',
    formSecret: secret,
  };
}

function onFormSubmit(e) {
  if (!e) throw new Error('onFormSubmit must run from an On form submit trigger.');

  var responses = responseMap(e);
  var memberName = firstValue(responses, FIELDS.member);
  var amountRaw = firstValue(responses, FIELDS.amount);
  var dateRaw = firstValue(responses, FIELDS.date);

  if (!memberName) {
    throw new Error('Could not find "Jina la Mwombaji". Check that this script is attached to the correct loan request Form or response Sheet.');
  }
  if (!amountRaw) {
    throw new Error('Could not find "Kiasi cha mkopo unaoombwa". Check the Form question title.');
  }

  var amountRequested = moneyNumber(amountRaw);
  if (!isFinite(amountRequested) || amountRequested <= 0) {
    throw new Error('Invalid requested loan amount: "' + amountRaw + '"');
  }

  var submittedInterest = nullableMoney(firstValue(responses, FIELDS.interest));
  var termMonths = nullableInteger(firstValue(responses, FIELDS.term));
  var monthlyRepayment = nullableMoney(firstValue(responses, FIELDS.monthlyRepayment));
  var lastLoanAmount = nullableMoney(firstValue(responses, FIELDS.lastLoanAmount));
  var requestedDate = formatDate(dateRaw) || Utilities.formatDate(new Date(), scriptTimezone(), 'yyyy-MM-dd');
  var submittedAt = eventTimestamp(e);
  var sourceId = eventSourceId(e) || ('loan-form-' + submittedAt + '-' + memberName + '-' + amountRequested);

  var payload = {
    sourceId: sourceId,
    submittedAt: submittedAt,
    memberName: memberName,
    amountRequested: amountRequested,
    requestedDate: requestedDate,
    requestedTermMonths: termMonths,
    submittedInterestAmount: submittedInterest,
    submittedMonthlyRepayment: monthlyRepayment,
    hasOtherDebt: yesNo(firstValue(responses, FIELDS.hasOtherDebt)),
    lastLoanMonth: firstValue(responses, FIELDS.lastLoanMonth) || '',
    lastLoanAmount: lastLoanAmount,
    repaymentsCompletedBy: firstValue(responses, FIELDS.repaymentsCompletedBy) || '',
    committeeApproved: yesNo(firstValue(responses, FIELDS.committeeApproved)),
    disbursementPhone: firstValue(responses, FIELDS.disbursementPhone) || '',
    oathAccepted: yesNo(firstValue(responses, FIELDS.oathAccepted)),
    notes: '',
  };

  Logger.log('Staging Checkpoint loan request: ' + JSON.stringify(payload));
  var result = postLoanRequest(payload);
  Logger.log('Checkpoint response: ' + JSON.stringify(result));
  return result;
}

// Builds a map from either a Google Form event or a linked response Sheet event.
function responseMap(e) {
  var map = {};

  if (e.response && e.response.getItemResponses) {
    var items = e.response.getItemResponses();
    for (var i = 0; i < items.length; i++) {
      putResponse(map, items[i].getItem().getTitle(), items[i].getResponse());
    }
    return map;
  }

  if (e.namedValues) {
    Object.keys(e.namedValues).forEach(function (key) {
      putResponse(map, key, e.namedValues[key]);
    });
    return map;
  }

  throw new Error('Unsupported trigger event. Use "On form submit" from the loan Form or its linked response Sheet.');
}

function putResponse(map, title, value) {
  map[normalizeTitle(title)] = value;
}

// Form titles can contain extra spaces/non-breaking spaces. Normalize them so
// the script does not break because Google renders whitespace slightly differently.
function normalizeTitle(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function firstValue(map, candidateTitles) {
  for (var i = 0; i < candidateTitles.length; i++) {
    var key = normalizeTitle(candidateTitles[i]);
    if (Object.prototype.hasOwnProperty.call(map, key)) return asString(map[key]);
  }
  return '';
}

function postLoanRequest(payload) {
  var cfg = checkpointConfig();
  var response = UrlFetchApp.fetch(cfg.apiUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Form-Secret': cfg.formSecret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('Checkpoint API returned ' + code + ': ' + body);
  }

  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error('Checkpoint returned a non-JSON response: ' + body);
  }
}

function moneyNumber(value) {
  var cleaned = String(value || '').replace(/,/g, '').replace(/[^0-9.-]/g, '');
  return parseFloat(cleaned);
}

function nullableMoney(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  var number = moneyNumber(value);
  return isFinite(number) ? number : null;
}

function nullableInteger(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  var number = parseInt(String(value).replace(/[^0-9-]/g, ''), 10);
  return isFinite(number) ? number : null;
}

function yesNo(value) {
  var text = String(value || '').trim().toLowerCase();
  if (text === 'ndio' || text === 'yes') return true;
  if (text === 'hapana' || text === 'no') return false;
  return null;
}

function eventTimestamp(e) {
  try {
    if (e.response && e.response.getTimestamp) return e.response.getTimestamp().toISOString();
  } catch (ignore) {}
  return new Date().toISOString();
}

function eventSourceId(e) {
  try {
    if (e.response && e.response.getId) {
      var responseId = String(e.response.getId() || '');
      if (responseId) return 'form-response-' + responseId;
    }
  } catch (ignore) {}

  try {
    if (e.range) return 'sheet-row-' + e.range.getSheet().getSheetId() + '-' + e.range.getRow();
  } catch (ignoreSheet) {}

  return '';
}

function asString(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.length ? asString(value[0]) : '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, scriptTimezone(), 'yyyy-MM-dd');
  }
  return String(value).trim();
}

function scriptTimezone() {
  return Session.getScriptTimeZone() || 'Africa/Dar_es_Salaam';
}

function formatDate(value) {
  if (!value) return null;

  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, scriptTimezone(), 'yyyy-MM-dd');
  }

  var text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  // Handles common Google Forms/Sheets date formats such as 08/23/2026,
  // 8/23/26, and "August 23, 2026".
  var date = new Date(text);
  if (isNaN(date.getTime())) return null;
  return Utilities.formatDate(date, scriptTimezone(), 'yyyy-MM-dd');
}

// Safe connectivity test. It creates a TZS 1 pending request only.
// Reject the test record afterwards in Admin -> Loan Requests.
function testConnection() {
  var now = new Date();
  var payload = {
    sourceId: 'loan-request-test-' + now.getTime(),
    submittedAt: now.toISOString(),
    memberName: 'Joseph Masonda',
    amountRequested: 1,
    requestedDate: Utilities.formatDate(now, scriptTimezone(), 'yyyy-MM-dd'),
    requestedTermMonths: 6,
    submittedInterestAmount: 0,
    submittedMonthlyRepayment: 0,
    hasOtherDebt: false,
    lastLoanMonth: '',
    lastLoanAmount: null,
    repaymentsCompletedBy: '',
    committeeApproved: true,
    disbursementPhone: '+255000000000',
    oathAccepted: true,
    notes: 'SAFE LOAN REQUEST CONNECTION TEST — REJECT THIS RECORD',
  };

  var result = postLoanRequest(payload);
  Logger.log(JSON.stringify(result));
  return result;
}
