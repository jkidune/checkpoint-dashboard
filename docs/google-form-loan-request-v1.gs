// Checkpoint Loan Request Form Intake v1
//
// Safe flow:
// Google Form / response Sheet -> Checkpoint Loan Requests inbox -> Admin review
// -> pending loan -> deliberate Admin disbursement.
//
// Required Script Properties (same values as contribution intake):
//   CHECKPOINT_API_URL = https://your-checkpoint-domain
//   FORM_SECRET        = same secret configured in Vercel
//
// Optional Script Properties let you override exact question/column titles:
//   LOAN_FIELD_MEMBER, LOAN_FIELD_AMOUNT, LOAN_FIELD_DATE,
//   LOAN_FIELD_PURPOSE, LOAN_FIELD_TERM, LOAN_FIELD_NOTES

var FIELD_ALIASES = {
  member: [
    'Jina la Mwombaji',
    'Jina la Mwanachama',
    'Jina la Mkopaji',
    'Jina',
  ],
  amount: [
    'Kiasi cha Mkopo',
    'Kiasi cha mkopo unaoomba',
    'Kiasi cha Mkopo unaoomba',
    'Kiwango cha Mkopo',
  ],
  date: [
    'Tarehe ya Ombi',
    'Tarehe ya kuomba mkopo',
    'Tarehe ya Maombi',
    'Tarehe',
  ],
  purpose: [
    'Madhumuni ya Mkopo',
    'Sababu ya Mkopo',
    'Matumizi ya Mkopo',
  ],
  term: [
    'Muda wa Mkopo (miezi)',
    'Muda wa Mkopo',
    'Miezi ya Marejesho',
  ],
  notes: [
    'Maelezo ya ziada',
    'Maelezo',
    'Maoni ya ziada',
  ],
};

function config() {
  var props = PropertiesService.getScriptProperties();
  var apiBase = String(props.getProperty('CHECKPOINT_API_URL') || '').trim().replace(/\/$/, '');
  var secret = String(props.getProperty('FORM_SECRET') || '').trim();

  if (!apiBase) throw new Error('CHECKPOINT_API_URL is not configured in Script Properties.');
  if (!secret) throw new Error('FORM_SECRET is not configured in Script Properties.');

  return {
    apiUrl: apiBase + '/api/forms/loan-request',
    formSecret: secret,
    fields: {
      member: propertyOrAliases(props, 'LOAN_FIELD_MEMBER', FIELD_ALIASES.member),
      amount: propertyOrAliases(props, 'LOAN_FIELD_AMOUNT', FIELD_ALIASES.amount),
      date: propertyOrAliases(props, 'LOAN_FIELD_DATE', FIELD_ALIASES.date),
      purpose: propertyOrAliases(props, 'LOAN_FIELD_PURPOSE', FIELD_ALIASES.purpose),
      term: propertyOrAliases(props, 'LOAN_FIELD_TERM', FIELD_ALIASES.term),
      notes: propertyOrAliases(props, 'LOAN_FIELD_NOTES', FIELD_ALIASES.notes),
    },
  };
}

function propertyOrAliases(props, propertyName, aliases) {
  var exact = String(props.getProperty(propertyName) || '').trim();
  return exact ? [exact] : aliases;
}

// Supports BOTH:
// 1) Form-bound trigger: e.response
// 2) Response-Sheet-bound trigger: e.namedValues
function onFormSubmit(e) {
  try {
    if (!e) throw new Error('This function must run from an On form submit trigger.');
    var cfg = config();
    var responses = responseMap(e);

    var memberName = firstValue(responses, cfg.fields.member);
    var amountRaw = firstValue(responses, cfg.fields.amount);
    var dateRaw = firstValue(responses, cfg.fields.date);
    var purpose = firstValue(responses, cfg.fields.purpose);
    var termRaw = firstValue(responses, cfg.fields.term);
    var notes = firstValue(responses, cfg.fields.notes);

    if (!memberName) throw new Error('Could not find the member-name field. Set LOAN_FIELD_MEMBER in Script Properties to the exact Form/Sheet title.');
    if (!amountRaw) throw new Error('Could not find the loan-amount field. Set LOAN_FIELD_AMOUNT in Script Properties to the exact Form/Sheet title.');

    var amountRequested = parseFloat(String(amountRaw).replace(/[^0-9.]/g, ''));
    if (!isFinite(amountRequested) || amountRequested <= 0) throw new Error('Invalid requested amount: "' + amountRaw + '"');

    var requestedDate = formatDate(dateRaw) || Utilities.formatDate(new Date(), scriptTimezone(), 'yyyy-MM-dd');
    var requestedTermMonths = termRaw ? parseInt(String(termRaw).replace(/[^0-9]/g, ''), 10) : null;
    if (!isFinite(requestedTermMonths)) requestedTermMonths = null;

    var submittedAt = eventTimestamp(e);
    var sourceId = eventSourceId(e) || ('loan-form-' + submittedAt + '-' + memberName + '-' + amountRequested);

    var payload = {
      sourceId: sourceId,
      submittedAt: submittedAt,
      memberName: memberName,
      amountRequested: amountRequested,
      requestedDate: requestedDate,
      purpose: purpose || '',
      requestedTermMonths: requestedTermMonths,
      notes: notes || '',
    };

    Logger.log('Staging loan request: ' + JSON.stringify(payload));
    var result = postLoanRequest(payload);
    Logger.log('Checkpoint response: ' + JSON.stringify(result));
  } catch (err) {
    Logger.log('ERROR: ' + err.message);
    throw err;
  }
}

function responseMap(e) {
  var map = {};

  if (e.response && e.response.getItemResponses) {
    var items = e.response.getItemResponses();
    for (var i = 0; i < items.length; i++) {
      map[items[i].getItem().getTitle()] = items[i].getResponse();
    }
    return map;
  }

  if (e.namedValues) {
    Object.keys(e.namedValues).forEach(function (key) {
      map[key] = e.namedValues[key];
    });
    return map;
  }

  throw new Error('Unsupported trigger event. Use On form submit from the Form or its response Sheet.');
}

function firstValue(map, candidateTitles) {
  for (var i = 0; i < candidateTitles.length; i++) {
    var title = candidateTitles[i];
    if (Object.prototype.hasOwnProperty.call(map, title)) {
      return asString(map[title]);
    }
  }
  return '';
}

function postLoanRequest(payload) {
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
    throw new Error('Checkpoint API returned ' + code + ': ' + body);
  }
  return JSON.parse(body);
}

function eventTimestamp(e) {
  try {
    if (e.response && e.response.getTimestamp) return e.response.getTimestamp().toISOString();
  } catch (ignore) {}
  return new Date().toISOString();
}

function eventSourceId(e) {
  try {
    if (e.response && e.response.getId) return String(e.response.getId() || '');
  } catch (ignore) {}
  try {
    if (e.range) return 'sheet-row-' + e.range.getSheet().getSheetId() + '-' + e.range.getRow();
  } catch (ignoreSheet) {}
  return '';
}

function asString(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.length ? String(value[0]).trim() : '';
  return String(value).trim();
}

function scriptTimezone() {
  return Session.getScriptTimeZone() || 'Africa/Dar_es_Salaam';
}

function formatDate(value) {
  if (!value) return null;
  var text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  var date = new Date(text);
  if (isNaN(date.getTime())) return null;
  return Utilities.formatDate(date, scriptTimezone(), 'yyyy-MM-dd');
}

// Safe connection test. Creates a TZS 1 pending request in Admin -> Loan Requests.
// Reject it after verifying connectivity.
function testConnection() {
  var now = new Date();
  var payload = {
    sourceId: 'loan-request-test-' + now.getTime(),
    submittedAt: now.toISOString(),
    memberName: 'Joseph Masonda',
    amountRequested: 1,
    requestedDate: Utilities.formatDate(now, scriptTimezone(), 'yyyy-MM-dd'),
    purpose: 'SAFE LOAN REQUEST CONNECTION TEST',
    requestedTermMonths: null,
    notes: 'Reject this test record in Checkpoint Admin -> Loan Requests',
  };
  Logger.log(JSON.stringify(postLoanRequest(payload)));
}
