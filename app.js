/* ===== CONFIGURATION: change values here only. Placeholders until the agent provides real ones. ===== */
const AGENCY_NAME = 'Haventra Real Estate';
const WHATSAPP_NUMBER = '2340000000000';          // international format, no plus sign
const PHONE_DISPLAY = '+234 000 000 0000';
const CONTACT_EMAIL = 'hello@example.com';
const OFFICE_ADDRESS = 'Office address to be added';
const SOCIAL_LINKS = [];                          // e.g. [{ name: 'Instagram', url: 'https://instagram.com/...' }]
const APPS_SCRIPT_URL = 'paste web app URL here';
const BOOKING_WINDOW_DAYS = 60;
/* ===== END CONFIGURATION ===== */

(function () {
  'use strict';
  const TZ = 'Africa/Lagos';
  const $ = (id) => document.getElementById(id);
  const state = { data: null, type: '', date: '', time: null, cal: null };

  /* ---------- helpers ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (m) => { const h = Math.floor(m / 60), mi = m % 60; return ((h + 11) % 12 + 1) + ':' + pad(mi) + ' ' + (h < 12 ? 'AM' : 'PM'); };
  const utc = (ds) => new Date(ds + 'T12:00:00Z');
  const fmtDate = (ds) => utc(ds).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const dow = (ds) => utc(ds).getUTCDay();
  const addDays = (ds, n) => { const d = utc(ds); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  function lagosNow() {
    const p = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, min: +p.hour * 60 + +p.minute };
  }
  const waLink = (text) => 'https://wa.me/' + WHATSAPP_NUMBER + (text ? '?text=' + encodeURIComponent(text) : '');
  const telHref = () => 'tel:+' + WHATSAPP_NUMBER;

  /* ---------- availability (mirrors the backend) ---------- */
  function hoursFor(ds) {
    const s = state.data.settings, d = dow(ds);
    if (d === 0) return null;                                       // Sunday closed
    return d === 6 ? { open: s.weOpen, close: s.weClose } : { open: s.wdOpen, close: s.wdClose };
  }
  const durationFor = (type) => (type === 'Virtual' ? state.data.settings.dVirt : state.data.settings.dIn);
  function slotsFor(ds, type) {
    if (!state.data || !type) return [];
    const h = hoursFor(ds); if (!h) return [];
    const dur = durationFor(type), step = state.data.settings.step || 30, now = lagosNow(), out = [];
    for (let st = h.open; st <= h.close - dur; st += step) {
      const past = ds === now.date && st <= now.min;
      const clash = state.data.blocked.some((b) => b.date === ds && st < b.end && b.start < st + dur);
      out.push({ start: st, ok: !past && !clash });
    }
    return out;
  }
  function range() { const t = lagosNow().date; return { min: t, max: addDays(t, BOOKING_WINDOW_DAYS) }; }
  const dateOK = (ds) => { const r = range(); return ds >= r.min && ds <= r.max && slotsFor(ds, state.type).some((s) => s.ok); };

  /* ---------- static content from config ---------- */
  function fillConfig() {
    document.title = 'Book a Viewing | ' + AGENCY_NAME;
    $('hdrWa').href = waLink(); $('errWa').href = waLink();
    $('infoTel').textContent = PHONE_DISPLAY; $('infoTel').href = telHref();
    $('fAgency').textContent = AGENCY_NAME;
    $('fTel').textContent = PHONE_DISPLAY; $('fTel').href = telHref();
    $('fMail').textContent = CONTACT_EMAIL; $('fMail').href = 'mailto:' + CONTACT_EMAIL;
    $('fAddr').textContent = OFFICE_ADDRESS;
    SOCIAL_LINKS.forEach((l) => {
      const li = document.createElement('li'), a = document.createElement('a');
      a.href = l.url; a.textContent = l.name; a.target = '_blank'; a.rel = 'noopener'; li.appendChild(a); $('fSocial').appendChild(li);
    });
  }
  function renderHours() {
    const s = state.data.settings;
    const rows = ['Monday to Friday: ' + fmtTime(s.wdOpen) + ' to ' + fmtTime(s.wdClose), 'Saturday: ' + fmtTime(s.weOpen) + ' to ' + fmtTime(s.weClose), 'Sunday: Closed'];
    $('infoHours').innerHTML = '';
    rows.forEach((r) => { const li = document.createElement('li'); li.textContent = r; $('infoHours').appendChild(li); });
    $('introHours').textContent = 'Open ' + rows[0].replace(': ', ' ').replace('Monday to Friday', 'Mon to Fri') + '  |  Sat ' + fmtTime(s.weOpen) + ' to ' + fmtTime(s.weClose);
  }

  /* ---------- loading ---------- */
  async function load() {
    $('loadError').hidden = true; $('bookingForm').classList.add('loading'); $('bookingForm').inert = true;
    try {
      if (/paste/i.test(APPS_SCRIPT_URL)) throw new Error('APPS_SCRIPT_URL is not set');
      const r = await fetch(APPS_SCRIPT_URL);
      const d = await r.json();
      if (!d || !d.settings) throw new Error('Bad response');
      state.data = d;
      const sel = $('property'); sel.length = 1;
      d.properties.forEach((p) => sel.add(new Option(p, p)));
      renderHours(); initCal(); renderTimes();
      $('bookingForm').classList.remove('loading'); $('bookingForm').inert = false;
    } catch (e) {
      console.error(e);
      $('loadError').hidden = false; $('introHours').textContent = '';
    }
  }

  /* ---------- calendar ---------- */
  function initCal() { const t = range().min; state.cal = { y: +t.slice(0, 4), m: +t.slice(5, 7) - 1 }; renderCal(); }
  function renderCal() {
    const box = $('cal'), { y, m } = state.cal, r = range(), enabled = !!state.type;
    box.className = 'cal' + (enabled ? '' : ' off');
    $('dateHint').textContent = enabled ? 'Greyed-out dates have no free times.' : 'Choose a viewing type first.';
    const first = new Date(Date.UTC(y, m, 1)), lead = (first.getUTCDay() + 6) % 7, days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const title = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const minM = +r.min.slice(0, 4) * 12 + +r.min.slice(5, 7) - 1, maxM = +r.max.slice(0, 4) * 12 + +r.max.slice(5, 7) - 1, cur = y * 12 + m;
    let h = '<div class="cal-head"><button type="button" class="cal-nav" data-nav="-1" aria-label="Previous month"' + (cur <= minM ? ' disabled' : '') + '>‹</button><strong aria-live="polite">' + title + '</strong><button type="button" class="cal-nav" data-nav="1" aria-label="Next month"' + (cur >= maxM ? ' disabled' : '') + '>›</button></div><div class="cal-grid">';
    ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].forEach((d) => { h += '<span class="dow" aria-hidden="true">' + d + '</span>'; });
    for (let i = 0; i < lead; i++) h += '<span></span>';
    for (let d = 1; d <= days; d++) {
      const ds = y + '-' + pad(m + 1) + '-' + pad(d), ok = enabled && dateOK(ds);
      h += '<button type="button" class="cal-day' + (ds === r.min ? ' today' : '') + '" data-d="' + ds + '" aria-label="' + fmtDate(ds) + (ok ? '' : ', unavailable') + '" aria-pressed="' + (ds === state.date) + '"' + (ok ? '' : ' disabled') + '>' + d + '</button>';
    }
    box.innerHTML = h + '</div>';
  }
  $('cal').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.nav) { state.cal.m += +b.dataset.nav; if (state.cal.m < 0) { state.cal.m = 11; state.cal.y--; } if (state.cal.m > 11) { state.cal.m = 0; state.cal.y++; } renderCal(); const n = $('cal').querySelector('[data-nav="' + b.dataset.nav + '"]:not(:disabled)') || $('cal').querySelector('.cal-nav:not(:disabled)'); if (n) n.focus(); return; }
    if (b.dataset.d) { state.date = b.dataset.d; clearErr('date'); revalidateTime(); renderCal(); renderTimes(); $('cal').querySelector('[data-d="' + state.date + '"]').focus(); }
  });

  /* ---------- time chips ---------- */
  function revalidateTime() {
    if (state.time !== null && !slotsFor(state.date, state.type).some((s) => s.start === state.time && s.ok)) state.time = null;
    if (state.date && !dateOK(state.date)) { state.date = ''; state.time = null; }
  }
  function renderTimes() {
    const box = $('times'), hint = $('timeHint'); box.innerHTML = '';
    if (!state.type || !state.date) { hint.textContent = 'Choose a viewing type and date first.'; return; }
    const slots = slotsFor(state.date, state.type);
    hint.textContent = slots.some((s) => s.ok) ? 'Times are shown in Lagos time (WAT). Start times in 30-minute steps.' : 'No times are free on this date. Please pick another date.';
    slots.forEach((s) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(s.start === state.time)); b.dataset.t = s.start;
      b.innerHTML = '<span>' + fmtTime(s.start) + '</span>' + (s.ok ? '' : '<small>Unavailable</small>');
      if (!s.ok) b.disabled = true;
      box.appendChild(b);
    });
  }
  $('times').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b || b.disabled) return;
    state.time = +b.dataset.t; clearErr('time');
    $('times').querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-checked', String(c === b)));
  });

  /* ---------- viewing type ---------- */
  document.querySelectorAll('input[name=vtype]').forEach((r) => r.addEventListener('change', () => {
    state.type = r.value; clearErr('type'); revalidateTime(); renderCal(); renderTimes();
  }));

  /* ---------- validation ---------- */
  const V = {
    type: () => (state.type ? '' : 'Choose a viewing type.'),
    property: () => ($('property').value ? '' : 'Select a property.'),
    date: () => (state.date ? '' : 'Choose a date.'),
    time: () => (state.time !== null ? '' : 'Choose a start time.'),
    altDate: () => {
      const v = $('altDate').value, r = range(); if (!v) return '';
      if (v < r.min || v > r.max) return 'Choose a date within the next ' + BOOKING_WINDOW_DAYS + ' days.';
      return v === state.date ? 'Alternative date must be different from your preferred date.' : '';
    },
    name: () => { const n = $('name').value.trim().length; return n >= 2 && n <= 100 ? '' : 'Enter your full name (2 to 100 characters).'; },
    phone: () => {
      const v = $('phone').value.trim(), digits = v.replace(/[\s+\-()]/g, '');
      return /^[\d\s+\-()]+$/.test(v) && /^\d{10,15}$/.test(digits) ? '' : 'Enter a valid number with 10 to 15 digits, e.g. 08012345678 or +2348012345678.';
    },
    email: () => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test($('email').value.trim()) ? '' : 'Enter a valid email address.'),
    people: () => { const n = Number($('people').value); return Number.isInteger(n) && n >= 1 && n <= 10 ? '' : 'Enter a number from 1 to 10.'; },
    message: () => ($('message').value.length <= 500 ? '' : 'Keep your message to 500 characters or fewer.'),
    consent: () => ($('consent').checked ? '' : 'Please agree to be contacted so we can confirm your booking.')
  };
  const ORDER = ['type', 'property', 'date', 'time', 'altDate', 'name', 'phone', 'email', 'people', 'message', 'consent'];
  const inputOf = { property: 'property', altDate: 'altDate', name: 'name', phone: 'phone', email: 'email', people: 'people', message: 'message', consent: 'consent' };
  function showErr(f, msg) {
    $('err-' + f).textContent = msg;
    const el = inputOf[f] && $(inputOf[f]); if (el) { if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); }
  }
  const clearErr = (f) => showErr(f, '');
  const check = (f) => { const m = V[f](); showErr(f, m); return !m; };
  ['property', 'altDate', 'name', 'phone', 'email', 'people', 'message'].forEach((f) => {
    const el = $(inputOf[f]);
    el.addEventListener('blur', () => check(f));
    el.addEventListener('input', () => { if (el.getAttribute('aria-invalid')) check(f); });
  });
  $('consent').addEventListener('change', () => check('consent'));
  $('altDate').addEventListener('change', () => check('altDate'));
  $('message').addEventListener('input', () => { $('msgCount').textContent = $('message').value.length + ' / 500'; });
  $('pMinus').addEventListener('click', () => { $('people').value = Math.max(1, (+$('people').value || 1) - 1); check('people'); });
  $('pPlus').addEventListener('click', () => { $('people').value = Math.min(10, (+$('people').value || 1) + 1); check('people'); });
  function focusField(f) {
    const el = f === 'type' ? document.querySelector('input[name=vtype]') : f === 'date' ? ($('cal').querySelector('.cal-day:not(:disabled)') || $('cal')) : f === 'time' ? ($('times').querySelector('.chip:not(:disabled)') || $('times')) : $(inputOf[f]);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true });
  }

  /* ---------- submit ---------- */
  function setBusy(b) { $('submitBtn').disabled = b; $('submitBtn').classList.toggle('is-busy', b); $('submitLabel').textContent = b ? 'Booking…' : 'Book Viewing'; }
  function formAlert(msg) { const a = $('formAlert'); a.textContent = msg; a.hidden = !msg; if (msg) { a.scrollIntoView({ behavior: 'smooth', block: 'center' }); a.focus({ preventScroll: true }); } }

  $('bookingForm').addEventListener('submit', async (e) => {
    e.preventDefault(); formAlert('');
    if ($('submitBtn').disabled) return;
    let first = null; ORDER.forEach((f) => { if (!check(f) && !first) first = f; });
    if (first) { focusField(first); return; }
    setBusy(true);
    const payload = {
      type: state.type, property: $('property').value, date: state.date, start: state.time,
      altDate: $('altDate').value, name: $('name').value.trim(), phone: $('phone').value.trim(), email: $('email').value.trim(),
      people: Number($('people').value), message: $('message').value.trim(), consent: true, website: $('website').value
    };
    try {
      const r = await fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (j.result === 'ok') { showSuccess(j.booking); return; }
      if (j.code === 'SLOT_TAKEN') {
        state.time = null; await refreshData();
        formAlert('Sorry, that time was just booked. Please choose another time.'); focusField('time');
      } else if (j.code === 'VALIDATION' && j.fields) {
        let f1 = null; Object.keys(j.fields).forEach((k) => { if (V[k]) { showErr(k, j.fields[k]); if (!f1) f1 = k; } });
        if (f1) focusField(f1); else formAlert('Please check your details and try again.');
      } else throw new Error('server');
    } catch (err) {
      formAlert('Something went wrong. Please try again, or contact us on WhatsApp.');
    } finally { setBusy(false); }
  });
  async function refreshData() {
    try { const d = await (await fetch(APPS_SCRIPT_URL)).json(); if (d && d.settings) state.data = d; } catch (e) { /* keep old data */ }
    revalidateTime(); renderCal(); renderTimes();
  }

  /* ---------- confirmation ---------- */
  function showSuccess(b) {
    const ds = b.date || state.date, label = b.type || state.type, end = b.end, st = b.start;
    const dt = (m) => ds.replace(/-/g, '') + 'T' + pad(Math.floor(m / 60)) + pad(m % 60) + '00';
    const title = AGENCY_NAME + ' ' + label.toLowerCase() + ' viewing: ' + (b.property || '');
    const gcal = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(title) + '&dates=' + dt(st) + '/' + dt(end) + '&ctz=' + TZ + '&details=' + encodeURIComponent('Booking ID: ' + b.id + '. Status: Pending until confirmed.');
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Haventra//Booking//EN', 'BEGIN:VEVENT', 'UID:' + b.id + '@haventra', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]|\.\d{3}/g, ''), 'DTSTART;TZID=' + TZ + ':' + dt(st), 'DTEND;TZID=' + TZ + ':' + dt(end), 'SUMMARY:' + title.replace(/[,;]/g, ' '), 'DESCRIPTION:Booking ID ' + b.id, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const sec = $('success'); sec.innerHTML = '';
    const mk = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt) n.textContent = txt; return n; };
    const logo = mk('img', 's-logo'); logo.src = 'assets/logo.png'; logo.alt = 'Haventra Real Estate logo'; sec.appendChild(logo);
    sec.insertAdjacentHTML('beforeend', '<svg class="s-icon" viewBox="0 0 24 24" width="52" height="52" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#16A34A"/><path d="M7 12.5l3.2 3.2L17 8.8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    sec.appendChild(mk('h2', '', 'Your viewing request has been received'));
    const dl = mk('dl', 's-sum');
    [['Viewing type', label], ['Property', b.property || payloadProp()], ['Date', fmtDate(ds)], ['Time', fmtTime(st) + ' to ' + fmtTime(end)], ['People', String(b.people || $('people').value)], ['Booking ID', b.id]]
      .forEach(([k, v]) => { dl.appendChild(mk('dt', '', k)); dl.appendChild(mk('dd', '', v)); });
    sec.appendChild(dl);
    sec.appendChild(mk('p', '', 'Your time is reserved as Pending. We will contact you on WhatsApp or by phone to confirm.'));
    const row = mk('div', 'row');
    const a1 = mk('a', 'btn-sec', 'Add to Calendar'); a1.href = gcal; a1.target = '_blank'; a1.rel = 'noopener';
    const a2 = mk('a', 'btn-sec', 'Download .ics'); a2.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a2.download = 'haventra-viewing.ics';
    const a3 = mk('a', 'btn-sec btn-solid', 'Message us on WhatsApp'); a3.target = '_blank'; a3.rel = 'noopener';
    a3.href = waLink('Hello ' + AGENCY_NAME + ', I just requested a viewing. My Booking ID is ' + b.id + ' (' + fmtDate(ds) + ', ' + fmtTime(st) + ').');
    [a1, a2, a3].forEach((a) => row.appendChild(a)); sec.appendChild(row);
    const again = mk('button', 's-again', 'Book another viewing'); again.type = 'button'; again.addEventListener('click', resetForm); sec.appendChild(again);
    $('bookingForm').hidden = true; sec.hidden = false; sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); sec.focus({ preventScroll: true });
  }
  const payloadProp = () => $('property').value;
  function resetForm() {
    $('bookingForm').reset(); state.type = ''; state.date = ''; state.time = null; $('msgCount').textContent = '0 / 500';
    ORDER.forEach(clearErr); formAlert('');
    $('success').hidden = true; $('bookingForm').hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
    $('bookingForm').classList.add('loading'); load();
  }

  $('retryBtn').addEventListener('click', load);
  fillConfig(); load();
})();
