// Checkpoint Google Form Intake v2
//
// IMPORTANT:
// 1. This script sends submissions to the SAFE intake inbox only.
// 2. It does NOT write contributions, repayments or fines directly.
// 3. Store CHECKPOINT_API_URL and FORM_SECRET in Apps Script Properties.
// 4. Rotate the old FORM_SECRET before enabling this version.

var FIELD_MEMBER = 'Jina la Mchangiaji';
var FIELD_AMOUNT = 'Kiwango cha mchango';
var FIELD_DATE   = 'Tarehe ya Mchango';
var FIELD_TYPE   = 'Aina ya mchango';
var FIELD_MONTHS = 'Kama ni mchango wa mwezi, Taja mwezi husika';
var FIELD_MPESA  = 'Namba ya muamala wa uthibitisho';
var FIELD_NOTES  = 'Maelezo ya ziada';

var TYPE_MAP = {
  'Mchango wa mwezi': 'monthly',
  'Rejesho la deni': 'loan_repayment',
  'Fine': 'fine',
};

function config() {
  var props = PropertiesService.getScriptProperties();
  var apiBase = String(props.getProperty('CHECKPOINT_API_URL') || '').trim().replace(/\/$/, '');
  var secret = String(props.getProperty('FORM_SECRET') || '').trim();

  if (!apiBase) throw new Error('CHECKPOINT_API_URL is not configured in Apps Script Properties.');
  if (!secret) throw new Error('FORM_SECRET is not configured in Apps Script Properties.');

  return {
    apiUrl: apiBase + '/api/forms/intake',
    formSecret: secret,
  };
}

function onFormSubmit(e) {
  try {
    if (!e || !e.response) throw new Error('This trigger must be installed on the Google Form itself.');

    var itemResponses = e.response.getItemResponses();
    var r = {};
    for (var i = 0; i < itemResponses.length; i++) {
      var itemResponse = itemResponses[i];
      r[itemResponse.getItem().getTitle()] = itemResponse.getResponse();
    }

    var memberName = asString(r[FIELD_MEMBER]);
    var amountRaw = asString(r[FIELD_AMOUNT]);
    var dateRaw = asString(r[FIELD_DATE]);
    var typeRaw = asString(r[FIELD_TYPE]);
    var monthsRaw = r[FIELD_MONTHS];
    var mpesaRef = asString(r[FIELD_MPESA]).toUpperCase();
    var notes = asString(r[FIELD_NOTES]);

    var type = TYPE_MAP[typeRaw];
    if (!type) throw new Error('Unknown contribution type: "' + typeRaw + '"');

    var amount = parseFloat(amountRaw.replace(/[^0-9.]/g, ''));
    if (!isFinite(amount) || amount <= 0) throw new Error('Invalid amount: "' + amountRaw + '"');

    var date = formatDate(dateRaw);
    if (!date) throw new Error('Could not parse date: "' + dateRaw + '"');

    var months = normalizeMonths(monthsRaw);
    if (type === 'monthly' && months.length === 0) {
      throw new Error('Monthly contribution requires at least one selected contribution month.');
    }

    var sourceId = '';
    try {
      sourceId = e.response.getId ? String(e.response.getId() || '') : '';
    } catch (ignore) {}

    var submittedAt = '';
    try {
      submittedAt = e.response.getTimestamp ? e.response.getTimestamp().toISOString() : new Date().toISOString();
    } catch (ignoreTimestamp) {
      submittedAt = new Date().toISOString();
    }

    var payload = {
      sourceId: sourceId || ('form-' + submittedAt + '-' + mpesaRef + '-' + memberName),
      submittedAt: submittedAt,
      memberName: memberName,
      amount: amount,
      date: date,
      type: type,
      months: months,
      mpesaRef: mpesaRef || '',
      notes: notes || '',
    };

    Logger.log('Staging Checkpoint intake: ' + JSON.stringify(payload));
    var result = postToIntake(payload);
    Logger.log('Checkpoint intake response: ' + JSON.stringify(result));
  } catch (err) {
    logError('onFormSubmit exception: ' + err.message);
    throw err;
  }
}

function postToIntake(payload) {
  var cfg = config();
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
    logError('API error ' + code + ': ' + body);
    throw new Error('Checkpoint API returned ' + code + ': ' + body);
  }

  return JSON.parse(body);
}

function normalizeMonths(value) {
  if (Array.isArray(value)) return value.map(asString).filter(Boolean);
  if (typeof value === 'string' && value) {
    return value.split(',').map(function (month) { return month.trim(); }).filter(Boolean);
  }
  return [];
}

function asString(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.length ? String(value[0]).trim() : '';
  return String(value).trim();
}

function formatDate(value) {
  if (!value) return null;
  var text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  var date = new Date(text);
  if (isNaN(date.getTime())) return null;
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Africa/Dar_es_Salaam', 'yyyy-MM-dd');
}

function logError(message) {
  Logger.log('ERROR: ' + message);
}

// Run manually only after Script Properties are configured.
// This stages a clearly-labeled test record in Admin → Form Intake; it does not
// touch financial records. Reject the test record after confirming connectivity.
function testConnection() {
  var now = new Date();
  var payload = {
    sourceId: 'manual-test-' + now.getTime(),
    submittedAt: now.toISOString(),
    memberName: 'Joseph Masonda',
    amount: 1,
    date: Utilities.formatDate(now, Session.getScriptTimeZone() || 'Africa/Dar_es_Salaam', 'yyyy-MM-dd'),
    type: 'fine',
    months: [],
    mpesaRef: 'INTAKE-TEST-' + now.getTime(),
    notes: 'SAFE INTAKE CONNECTION TEST — reject this record in Admin Form Intake',
  };
  Logger.log(JSON.stringify(postToIntake(payload)));
}
