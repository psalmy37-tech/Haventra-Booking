/**
 * Haventra Real Estate: Viewing Booking backend (Google Apps Script web app)
 * Sign in as psalmy37@gmail.com, create the Sheet, then Extensions > Apps Script and paste this file
 * (and appsscript.json via Project Settings > "Show appsscript.json"). Run setup() once, then deploy.
 */
const TZ = 'Africa/Lagos';
const TAB = { B: 'Bookings', T: 'Today and Upcoming', P: 'Properties', S: 'Settings' };
const HEAD = ['Booking ID', 'Timestamp', 'Viewing type', 'Property', 'Date', 'Start time', 'End time', 'Name', 'Phone', 'Email', 'People', 'Alternative date', 'Message', 'Status', 'Start (min)', 'End (min)'];
const SETTINGS_DEFAULTS = [
  ['Weekday opening time', '9:00 AM'], ['Weekday closing time', '5:00 PM'],
  ['Weekend opening time', '10:00 AM'], ['Weekend closing time', '4:00 PM'],
  ['In-person duration (minutes)', 60], ['Virtual duration (minutes)', 30], ['Time step (minutes)', 30]
];
const SETTING_KEYS = { 'Weekday opening time': 'wdOpen', 'Weekday closing time': 'wdClose', 'Weekend opening time': 'weOpen', 'Weekend closing time': 'weClose', 'In-person duration (minutes)': 'dIn', 'Virtual duration (minutes)': 'dVirt', 'Time step (minutes)': 'step' };
const WINDOW_DAYS = 60; // keep equal to BOOKING_WINDOW_DAYS in js/app.js
const STATUSES = ['Pending', 'Confirmed', 'Cancelled', 'Completed'];

/* ---------- web app entry points ---------- */
function doGet() {
  const ss = SpreadsheetApp.getActive();
  const today = todayStr(), last = addDays(today, WINDOW_DAYS);
  const blocked = readBookings().filter(b => b.status !== 'Cancelled' && b.date >= today && b.date <= last)
    .map(b => ({ date: b.date, start: b.start, end: b.end })); // no personal data
  return out({ settings: getSettings(), properties: getProperties(), blocked: blocked });
}

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (x) { return out({ result: 'error', code: 'SERVER' }); }
  if (d && d.website) return out({ result: 'ok', booking: { id: 'VW-0000', type: '', property: '', date: todayStr(), start: 540, end: 570, people: 1 } }); // honeypot: pretend success, save nothing
  const lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (x) { return out({ result: 'error', code: 'SERVER' }); }
  try {
    const s = getSettings(), props = getProperties();
    const v = validate(d || {}, s, props);
    if (v.fields) return out({ result: 'error', code: 'VALIDATION', fields: v.fields });
    const clash = readBookings().some(b => b.status !== 'Cancelled' && b.date === v.date && v.start < b.end && b.start < v.end);
    if (clash) return out({ result: 'error', code: 'SLOT_TAKEN' });
    const sh = SpreadsheetApp.getActive().getSheetByName(TAB.B);
    let max = 0;
    sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().forEach(r => { const m = /(\d+)/.exec(String(r[0])); if (m) max = Math.max(max, +m[1]); });
    const id = 'VW-' + ('0000' + (max + 1)).slice(-4);
    const ds = v.date.split('-').map(Number);
    const row = [id, new Date(), v.type, safe(d.property), new Date(ds[0], ds[1] - 1, ds[2]), mmText(v.start), mmText(v.end), safe(d.name.trim()), d.phone.trim(), safe(d.email.trim()),
      Number(d.people), v.alt ? dateOf(v.alt) : '', safe((d.message || '').trim()), 'Pending', v.start, v.end];
    sh.insertRowBefore(2);
    const r = sh.getRange(2, 1, 1, HEAD.length);
    r.setFontWeight('normal').setBackground(null).setFontColor('#1F2937');
    r.setNumberFormats([['@', 'yyyy-mm-dd hh:mm', '@', '@', 'ddd, d mmm yyyy', '@', '@', '@', '@', '@', '0', 'ddd, d mmm yyyy', '@', '@', '0', '0']]);
    r.setValues([row]);
    sh.getRange(2, 14).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
    SpreadsheetApp.flush();
    return out({ result: 'ok', booking: { id: id, type: v.type, property: d.property, date: v.date, start: v.start, end: v.end, people: Number(d.people) } });
  } catch (err) {
    console.error(err);
    return out({ result: 'error', code: 'SERVER' });
  } finally { lock.releaseLock(); }
}

/* ---------- validation: never trust the browser ---------- */
function validate(d, s, props) {
  const f = {};
  const type = d.type === 'In-person' || d.type === 'Virtual' ? d.type : null;
  if (!type) f.type = 'Choose a viewing type.';
  if (typeof d.property !== 'string' || props.indexOf(d.property) < 0) f.property = 'Select a property.';
  const name = typeof d.name === 'string' ? d.name.trim() : '';
  if (name.length < 2 || name.length > 100) f.name = 'Enter your full name (2 to 100 characters).';
  const ph = typeof d.phone === 'string' ? d.phone.trim() : '';
  if (!/^[\d\s+\-()]+$/.test(ph) || !/^\d{10,15}$/.test(ph.replace(/[\s+\-()]/g, ''))) f.phone = 'Enter a valid number with 10 to 15 digits.';
  if (typeof d.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email.trim()) || d.email.length > 200) f.email = 'Enter a valid email address.';
  const n = Number(d.people);
  if (!Number.isInteger(n) || n < 1 || n > 10) f.people = 'Enter a number from 1 to 10.';
  if (d.message && String(d.message).length > 500) f.message = 'Keep your message to 500 characters or fewer.';
  if (d.consent !== true) f.consent = 'Please agree to be contacted so we can confirm your booking.';
  const today = todayStr(), last = addDays(today, WINDOW_DAYS);
  const okDate = typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.date >= today && d.date <= last;
  let alt = '';
  if (d.altDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.altDate) || d.altDate < today || d.altDate > last || d.altDate === d.date) f.altDate = 'Choose a different date within the booking window.';
    else alt = d.altDate;
  }
  let start = Number(d.start), end = 0;
  if (!okDate) f.date = 'Choose a date within the booking window.';
  else if (type) {
    const dw = new Date(d.date + 'T12:00:00Z').getUTCDay();
    const dur = type === 'Virtual' ? s.dVirt : s.dIn;
    const open = dw === 6 ? s.weOpen : s.wdOpen, close = dw === 6 ? s.weClose : s.wdClose;
    end = start + dur;
    if (dw === 0 || !Number.isInteger(start) || (start - open) % s.step !== 0 || start < open || end > close) f.time = 'Choose a valid start time within opening hours.';
    else if (d.date === today && start <= nowMin()) f.time = 'That time has already passed.';
  }
  return Object.keys(f).length ? { fields: f } : { type: type, date: d.date, start: start, end: end, alt: alt };
}

/* ---------- sheet readers ---------- */
function getSettings() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.S), s = { wdOpen: 540, wdClose: 1020, weOpen: 600, weClose: 960, dIn: 60, dVirt: 30, step: 30 };
  sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 2).getValues().forEach(r => {
    const k = SETTING_KEYS[String(r[0]).trim()]; if (!k) return;
    const m = k === 'dIn' || k === 'dVirt' || k === 'step' ? Number(r[1]) : toMin(r[1]);
    if (isFinite(m) && m > 0) s[k] = m;
  });
  return s;
}
function getProperties() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.P);
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .filter(r => String(r[0]).trim() && String(r[1]).toString().toUpperCase() !== 'FALSE').map(r => String(r[0]).trim());
}
function readBookings() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.B);
  if (sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, HEAD.length).getValues(), res = [];
  rows.forEach(r => {
    if (!r[0]) return;
    const date = r[4] instanceof Date ? Utilities.formatDate(r[4], TZ, 'yyyy-MM-dd') : String(r[4]);
    const st = isFinite(Number(r[14])) && r[14] !== '' ? Number(r[14]) : toMin(r[5]);
    const en = isFinite(Number(r[15])) && r[15] !== '' ? Number(r[15]) : toMin(r[6]);
    if (isFinite(st) && isFinite(en)) res.push({ date: date, start: st, end: en, status: String(r[13] || 'Pending') });
  });
  return res;
}

/* ---------- utilities ---------- */
function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function safe(v) { v = String(v == null ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; }
function todayStr() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function nowMin() { const p = Utilities.formatDate(new Date(), TZ, 'HH:mm').split(':'); return +p[0] * 60 + +p[1]; }
function addDays(ds, n) { const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function dateOf(ds) { const p = ds.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function mmText(m) { const h = Math.floor(m / 60), mi = m % 60; return ((h + 11) % 12 + 1) + ':' + ('0' + mi).slice(-2) + ' ' + (h < 12 ? 'AM' : 'PM'); }
function toMin(v) {
  if (v instanceof Date) { const p = Utilities.formatDate(v, TZ, 'HH:mm').split(':'); return +p[0] * 60 + +p[1]; }
  if (typeof v === 'number') return v < 1 ? Math.round(v * 1440) : v;
  const m = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(v)); if (!m) return NaN;
  let h = +m[1]; const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12; if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + +m[2];
}

/* ---------- one-time setup: run this once from the editor ---------- */
function setup() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(TZ);
  const get = (n) => ss.getSheetByName(n) || ss.insertSheet(n);
  const b = get(TAB.B), t = get(TAB.T), p = get(TAB.P), st = get(TAB.S);
  const first = ss.getSheetByName('Sheet1'); if (first && ss.getSheets().length > 4) ss.deleteSheet(first);
  ss.setActiveSheet(b); ss.moveActiveSheet(1); ss.setActiveSheet(t); ss.moveActiveSheet(2); ss.setActiveSheet(p); ss.moveActiveSheet(3); ss.setActiveSheet(st); ss.moveActiveSheet(4);

  // Bookings
  b.getRange(1, 1, 1, HEAD.length).setValues([HEAD]).setFontWeight('bold').setBackground('#06301B').setFontColor('#FFFFFF');
  b.setFrozenRows(1);
  if (b.getFilter()) b.getFilter().remove();
  b.getRange(1, 1, Math.max(b.getMaxRows(), 2), HEAD.length).createFilter();
  const fmts = { 1: '@', 2: 'yyyy-mm-dd hh:mm', 3: '@', 4: '@', 5: 'ddd, d mmm yyyy', 6: '@', 7: '@', 8: '@', 9: '@', 10: '@', 11: '0', 12: 'ddd, d mmm yyyy', 13: '@', 14: '@', 15: '0', 16: '0' };
  Object.keys(fmts).forEach(c => b.getRange(2, +c, b.getMaxRows() - 1, 1).setNumberFormat(fmts[c]));
  b.getRange(2, 14, b.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build());
  [110, 130, 100, 210, 130, 90, 90, 160, 140, 200, 70, 130, 280, 110, 70, 70].forEach((w, i) => b.setColumnWidth(i + 1, w));
  b.hideColumns(15, 2);
  const rules = (sheet, cols) => {
    const rg = sheet.getRange(2, 1, 998, cols), mk = (s, c) => SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + (cols === 14 ? 'N' : 'N') + '2="' + s + '"').setBackground(c).setRanges([rg]).build();
    sheet.setConditionalFormatRules([mk('Pending', '#FFEDD5'), mk('Confirmed', '#DCFCE7'), mk('Completed', '#E5E7EB'), mk('Cancelled', '#FEE2E2')]);
  };
  rules(b, HEAD.length);

  // Today and Upcoming
  t.clear();
  t.getRange(1, 1, 1, 14).setValues([HEAD.slice(0, 14)]).setFontWeight('bold').setBackground('#06301B').setFontColor('#FFFFFF');
  t.setFrozenRows(1);
  t.getRange('A2').setFormula('=IFERROR(QUERY(SORT(FILTER(Bookings!A2:P,Bookings!E2:E>=TODAY(),Bookings!N2:N<>"Cancelled"),5,TRUE,15,TRUE),"select Col1,Col2,Col3,Col4,Col5,Col6,Col7,Col8,Col9,Col10,Col11,Col12,Col13,Col14",0),"No upcoming bookings")');
  t.getRange('B2:B').setNumberFormat('yyyy-mm-dd hh:mm'); t.getRange('E2:E').setNumberFormat('ddd, d mmm yyyy'); t.getRange('L2:L').setNumberFormat('ddd, d mmm yyyy');
  [110, 130, 100, 210, 130, 90, 90, 160, 140, 200, 70, 130, 280, 110].forEach((w, i) => t.setColumnWidth(i + 1, w));
  rules(t, 14);

  // Properties
  p.clear();
  p.getRange(1, 1, 1, 2).setValues([['Property', 'Active']]).setFontWeight('bold').setBackground('#06301B').setFontColor('#FFFFFF');
  p.getRange(2, 1, 3, 2).setValues([['3-Bedroom Flat, Lekki', true], ['4-Bedroom Duplex, Ikeja GRA', true], ['2-Bedroom Apartment, Yaba', true]]);
  p.setColumnWidth(1, 320); p.setFrozenRows(1);

  // Settings
  st.clear();
  st.getRange(1, 1, 1, 2).setValues([['Setting', 'Value']]).setFontWeight('bold').setBackground('#06301B').setFontColor('#FFFFFF');
  st.getRange(2, 2, SETTINGS_DEFAULTS.length, 1).setNumberFormat('@');
  st.getRange(2, 1, SETTINGS_DEFAULTS.length, 2).setValues(SETTINGS_DEFAULTS);
  st.setColumnWidth(1, 260); st.setColumnWidth(2, 120); st.setFrozenRows(1);
  SpreadsheetApp.flush();
}
