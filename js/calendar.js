/*
 * Calendar helpers: links for Google / Outlook, .ics files for Apple,
 * Samsung and everything else, plus recurrence expansion for the month view.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrikCal = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

  // Local date strings ("2026-10-27T20:00") avoid time-zone drift in storage.
  function toLocal(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function fromLocal(s) {
    const [date, time = '00:00'] = s.split('T');
    const [y, mo, d] = date.split('-').map(Number);
    const [h, mi] = time.split(':').map(Number);
    return new Date(y, mo - 1, d, h, mi);
  }
  const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const utc = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 864e5);

  function rruleString(r) {
    if (!r) return '';
    let s = `FREQ=${r.freq}`;
    if (r.interval && r.interval > 1) s += `;INTERVAL=${r.interval}`;
    if (r.byday && r.byday.length) s += `;BYDAY=${r.byday.join(',')}`;
    return s;
  }

  function times(ev) {
    const start = fromLocal(ev.start);
    const end = ev.end ? fromLocal(ev.end) : new Date(start.getTime() + 36e5);
    return { start, end };
  }

  function googleUrl(ev) {
    const { start, end } = times(ev);
    const dates = ev.allDay
      ? `${ymd(start)}/${ymd(end > start ? end : addDays(start, 1))}`
      : `${utc(start)}/${utc(end)}`;
    const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.title || 'Afspraak', dates });
    if (ev.location) q.set('location', ev.location);
    if (ev.notes) q.set('details', ev.notes);
    if (ev.rrule) q.set('recur', 'RRULE:' + rruleString(ev.rrule));
    return 'https://calendar.google.com/calendar/render?' + q.toString();
  }

  function outlookUrl(ev, office) {
    const { start, end } = times(ev);
    const q = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: ev.title || 'Afspraak',
      startdt: ev.allDay ? toLocal(start).slice(0, 10) : start.toISOString(),
      enddt: ev.allDay ? toLocal(end > start ? end : addDays(start, 1)).slice(0, 10) : end.toISOString(),
    });
    if (ev.allDay) q.set('allday', 'true');
    if (ev.location) q.set('location', ev.location);
    if (ev.notes) q.set('body', ev.notes);
    const host = office ? 'https://outlook.office.com' : 'https://outlook.live.com';
    return `${host}/calendar/0/deeplink/compose?${q.toString()}`;
  }

  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

  // RFC 5545 says lines longer than 75 octets must be folded.
  function fold(line) {
    const out = [];
    let cur = '';
    let bytes = 0;
    for (const ch of line) {
      const b = new TextEncoder().encode(ch).length;
      if (bytes + b > 74) { out.push(cur); cur = ' '; bytes = 1; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join('\r\n');
  }

  function icsEvent(ev) {
    const { start, end } = times(ev);
    const lines = [
      'BEGIN:VEVENT',
      `UID:${ev.id}@prik.app`,
      `DTSTAMP:${utc(new Date())}`,
    ];
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${ymd(start)}`, `DTEND;VALUE=DATE:${ymd(end > start ? end : addDays(start, 1))}`);
    } else {
      lines.push(`DTSTART:${utc(start)}`, `DTEND:${utc(end)}`);
    }
    lines.push(`SUMMARY:${esc(ev.title || 'Afspraak')}`);
    if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
    if (ev.notes) lines.push(`DESCRIPTION:${esc(ev.notes)}`);
    if (ev.rrule) lines.push(`RRULE:${rruleString(ev.rrule)}`);
    if (!ev.allDay && ev.reminder !== 0) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(ev.title)}`,
        `TRIGGER:-PT${ev.reminder || 15}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
    return lines;
  }

  function ics(events) {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Prik//Snel in je agenda//NL', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (const ev of events) lines.push(...icsEvent(ev));
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
  }

  // Does a (possibly recurring) event happen on `day`?
  function occursOn(ev, day) {
    const s = startOfDay(fromLocal(ev.start));
    day = startOfDay(day);
    if (day < s) return false;
    const r = ev.rrule;
    if (!r) {
      if (ev.allDay && ev.end) {
        const e = fromLocal(ev.end);
        return day < e || +day === +s;
      }
      return +day === +s;
    }
    const iv = r.interval || 1;
    const dd = daysBetween(s, day);
    switch (r.freq) {
      case 'DAILY': return dd % iv === 0;
      case 'WEEKLY': {
        const days = r.byday && r.byday.length ? r.byday.map((c) => DAY_CODES.indexOf(c)) : [s.getDay()];
        if (!days.includes(day.getDay())) return false;
        const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
        return (daysBetween(monday(s), monday(day)) / 7) % iv === 0;
      }
      case 'MONTHLY': {
        const md = (day.getFullYear() - s.getFullYear()) * 12 + day.getMonth() - s.getMonth();
        return md % iv === 0 && day.getDate() === s.getDate();
      }
      case 'YEARLY':
        return day.getMonth() === s.getMonth() && day.getDate() === s.getDate()
          && (day.getFullYear() - s.getFullYear()) % iv === 0;
      default: return +day === +s;
    }
  }

  // Next start (Date) of an event at or after `now`; null if it is over.
  function nextOccurrence(ev, now) {
    const { start, end } = times(ev);
    if (!ev.rrule) return end > now ? start : null;
    const dur = end - start;
    let day = startOfDay(start > now ? start : now);
    for (let i = 0; i < 800; i++, day = addDays(day, 1)) {
      if (!occursOn(ev, day)) continue;
      const occ = new Date(day.getFullYear(), day.getMonth(), day.getDate(), start.getHours(), start.getMinutes());
      if (occ.getTime() + dur > now.getTime()) return occ;
    }
    return null;
  }

  return { googleUrl, outlookUrl, ics, occursOn, nextOccurrence, toLocal, fromLocal, rruleString };
});
