/*
 * Prik parser: turns Dutch free text ("lunch 20 oktober om 20u") into a
 * structured appointment or task. Pure functions, no DOM, so it runs in the
 * browser and in Node tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PrikParser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MONTHS = {
    januari: 0, jan: 0, februari: 1, feb: 1, maart: 2, mrt: 2, april: 3, apr: 3,
    mei: 4, juni: 5, jun: 5, juli: 6, jul: 6, augustus: 7, aug: 7,
    september: 8, sept: 8, sep: 8, oktober: 9, okt: 9, november: 10, nov: 10,
    december: 11, dec: 11,
  };
  const DAYS = {
    zondag: 0, maandag: 1, dinsdag: 2, woensdag: 3, donderdag: 4, vrijdag: 5, zaterdag: 6,
  };
  const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const NUMS = {
    een: 1, 'één': 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, zeven: 7, acht: 8,
    negen: 9, tien: 10, elf: 11, twaalf: 12, dertien: 13, veertien: 14, vijftien: 15,
    zestien: 16, zeventien: 17, achttien: 18, negentien: 19, twintig: 20,
  };
  const PART_DEFAULT_HOUR = { ochtend: 9, middag: 14, avond: 20, nacht: 23 };

  const byLength = (a, b) => b.length - a.length;
  const MONTH_RE = Object.keys(MONTHS).sort(byLength).join('|');
  const DAY_RE = Object.keys(DAYS).join('|');
  const NUM_RE = Object.keys(NUMS).sort(byLength).join('|');
  const HOUR = `(\\d{1,2}|${NUM_RE})`;
  const B0 = '(?<![\\p{L}\\d])'; // word start (unicode aware)
  const B1 = '(?![\\p{L}\\d])';  // word end
  const PART_RE = '(ochtend|morgen|middag|avond|nacht|vroeg)';

  const EVENING_RE = /(?<![\p{L}])(diner|dineren|eten|etentje|uit eten|borrel|feest|feestje|party|film|bios|bioscoop|concert|voorstelling|theater|pubquiz|kroeg|cocktails?)(?![\p{L}])/iu;

  const rx = (src) => new RegExp(src, 'giu');

  function num(v) {
    if (v == null) return NaN;
    const s = String(v).toLowerCase();
    if (/^\d+([.,]\d+)?$/.test(s)) return parseFloat(s.replace(',', '.'));
    return NUMS[s] ?? NaN;
  }

  function normPart(p) {
    if (!p) return null;
    p = p.toLowerCase().replace(/s$/, '');
    if (p === 'morgen' || p === 'vroeg') return 'ochtend';
    return p;
  }

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const addMonths = (d, n) => {
    const r = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
    r.setDate(Math.min(d.getDate(), last));
    return r;
  };

  // Blank out the first match (accepted by `check`) so it is not reused and
  // drops out of the title. Keeps string length stable so indices stay valid.
  function take(w, re, check) {
    if (!re.global) re = new RegExp(re.source, re.flags + "g");
    re.lastIndex = 0;
    for (const m of w.s.matchAll(re)) {
      if (check && !check(m)) continue;
      const a = m.index, b = a + m[0].length;
      w.s = w.s.slice(0, a) + ' '.repeat(b - a) + w.s.slice(b);
      return m;
    }
    return null;
  }

  function adjustHour(h, part, rawHour) {
    if (part === 'avond' || part === 'middag') {
      if (h < 12) h += 12;
    } else if (part === 'nacht') {
      if (h >= 7 && h < 12) h += 12;
    } else if (!part && h >= 1 && h <= 6 && !/^0/.test(String(rawHour))) {
      // "om 3 uur" for an appointment almost always means 15:00
      h += 12;
    }
    return h;
  }

  function parse(text, opts) {
    opts = opts || {};
    const now = opts.now ? new Date(opts.now) : new Date();
    const today = startOfDay(now);
    const w = { s: ' ' + String(text || '').replace(/[’‘`]/g, "'") + ' ' };

    let date = null;          // Date at 00:00
    let weekdayMode = null;   // for "today, or a week later if the time passed"
    let part = null;          // ochtend | middag | avond | nacht
    let time = null;          // {h, m, raw}
    let endTime = null;
    let durationMin = null;
    let recurrence = null;
    let location = null;
    let priority = false;
    let m;

    // ---- recurrence -------------------------------------------------------
    if ((m = take(w, rx(`${B0}(?:elke|iedere)\\s+werkdag${B1}`)))) {
      recurrence = { freq: 'WEEKLY', interval: 1, byday: ['MO', 'TU', 'WE', 'TH', 'FR'] };
    } else if ((m = take(w, rx(`${B0}(?:(?:elke|iedere)\\s+dag|dagelijks)${B1}`)))) {
      recurrence = { freq: 'DAILY', interval: 1 };
    } else if ((m = take(w, rx(`${B0}(?:elke|iedere|om\\s+de\\s+(?:(\\d+|${NUM_RE})\\s+)?)\\s*(?:(week|weken|maand|maanden|jaar|dag|dagen)|(${DAY_RE})${PART_RE}?)${B1}`)))) {
      const n = m[1] ? num(m[1]) : 1;
      const unit = (m[2] || '').toLowerCase();
      const freq = m[3] ? 'WEEKLY'
        : /^(week|weken)$/.test(unit) ? 'WEEKLY'
          : /^maand/.test(unit) ? 'MONTHLY'
            : unit === 'jaar' ? 'YEARLY' : 'DAILY';
      recurrence = { freq, interval: n || 1 };
      // "om de week" means every other week in Dutch
      if (/^om\s+de/i.test(m[0]) && !m[1]) recurrence.interval = 2;
      if (m[3]) {
        const wd = DAYS[m[3].toLowerCase()];
        date = nextWeekday(today, wd, null);
        weekdayMode = 'plain';
        recurrence.byday = [DAY_CODES[wd]];
        if (m[4]) part = normPart(m[4]);
      }
    } else if ((m = take(w, rx(`${B0}(wekelijks|maandelijks|jaarlijks|tweewekelijks)${B1}`)))) {
      const k = m[1].toLowerCase();
      recurrence = k === 'wekelijks' ? { freq: 'WEEKLY', interval: 1 }
        : k === 'tweewekelijks' ? { freq: 'WEEKLY', interval: 2 }
          : k === 'maandelijks' ? { freq: 'MONTHLY', interval: 1 }
            : { freq: 'YEARLY', interval: 1 };
    }

    // ---- compound day + part words -----------------------------------------
    if (!date && (m = take(w, rx(`${B0}van(ochtend|morgen|middag|avond|nacht)${B1}`)))) {
      date = today; part = normPart(m[1]);
    }
    if (!date && (m = take(w, rx(`${B0}overmorgen(?:\\s?(ochtend|middag|avond|nacht|vroeg))?${B1}`)))) {
      date = addDays(today, 2); part = normPart(m[1]) || part;
    }
    if (!date && (m = take(w, rx(`${B0}morgen\\s?(ochtend|middag|avond|nacht|vroeg)${B1}`)))) {
      date = addDays(today, 1); part = normPart(m[1]);
    }

    // ---- loose day parts ---------------------------------------------------
    if ((m = take(w, rx(`(?:^|\\s)'?s\\s?(ochtends|morgens|middags|avonds|nachts)${B1}`)))
      || (m = take(w, rx(`${B0}in\\s+de\\s+(ochtend|morgen|middag|avond|nacht)${B1}`)))) {
      part = normPart(m[1]);
    }

    // ---- relative days -----------------------------------------------------
    if (!date && (m = take(w, rx(`${B0}(?:(?:op|voor)\\s+)?(vandaag|morgen)${B1}`)))) {
      date = m[1].toLowerCase() === 'vandaag' ? today : addDays(today, 1);
    }
    if (!date && (m = take(w, rx(`${B0}(?:(volgende|komende)\\s+week\\s+)?(?:(volgende|komende|aanstaande|a\\.s\\.|deze)\\s+)?(?:op\\s+)?(${DAY_RE})${PART_RE}?(?:\\s+(volgende|komende)\\s+week)?${B1}`)))) {
      const wd = DAYS[m[3].toLowerCase()];
      const mode = (m[1] || m[5]) ? 'nextweek' : (m[2] && !/deze/i.test(m[2])) ? 'next' : null;
      date = nextWeekday(today, wd, mode);
      weekdayMode = mode ? null : 'plain';
      if (m[4]) part = normPart(m[4]);
    }
    if (!date && (m = take(w, rx(`${B0}over\\s+(?:een\\s+)?(\\d+|${NUM_RE}|een)?\\s*(dag|dagen|week|weken|maand|maanden|jaar)${B1}`)))) {
      const n = m[1] ? num(m[1]) : 1;
      const u = m[2].toLowerCase();
      date = /^dag/.test(u) ? addDays(today, n)
        : /^we/.test(u) ? addDays(today, 7 * n)
          : /^maand/.test(u) ? addMonths(today, n)
            : addMonths(today, 12 * n);
    }
    if (!date && (m = take(w, rx(`${B0}(volgende|komende)\\s+(week|maand)${B1}`)))) {
      date = m[2].toLowerCase() === 'week' ? addDays(today, 7) : addMonths(today, 1);
    }
    if (!date && (m = take(w, rx(`${B0}(?:in\\s+)?(?:het|dit)\\s+weekend${B1}|${B0}weekend${B1}`)))) {
      date = today.getDay() === 6 || today.getDay() === 0 ? today : nextWeekday(today, 6, null);
    }

    // ---- relative start: "over 2 uur", "over 30 minuten" -------------------
    let relStart = null;
    if (!date && (m = take(w, rx(`${B0}over\\s+(?:een\\s+)?(\\d+(?:[.,]\\d+)?|${NUM_RE}|anderhalf|half)?\\s*(uur|minuten|minuut|min|kwartier)${B1}`)))) {
      relStart = addMinutes(now, toMinutes(m[1] || 'een', m[2]));
      relStart.setSeconds(0, 0);
    }

    // ---- durations (before times: "duurt 2 uur" is not 14:00) ---------------
    if ((m = take(w, rx(`${B0}(?:duurt|duur:?|gedurende)\\s+(?:een\\s+)?(\\d+(?:[.,]\\d+)?|${NUM_RE}|anderhalf|half)\\s*(uur|uren|u|minuten|minuut|min|kwartier)${B1}`)))
      || (m = take(w, rx(`${B0}(?:een\\s+)?(\\d+(?:[.,]\\d+)?|${NUM_RE})\\s*(uur|uren|minuten|minuut|min)\\s+lang${B1}`)))) {
      durationMin = toMinutes(m[1], m[2]);
    } else if ((m = take(w, rx(`${B0}(?:een\\s+)?(anderhalf|half)\\s+uur${B1}|${B0}(\\d+)\\s*(minuten|min)${B1}|${B0}(?:een\\s+)?(kwartier)${B1}`)))) {
      if (m[1]) durationMin = m[1].toLowerCase() === 'anderhalf' ? 90 : 30;
      else if (m[2]) durationMin = parseInt(m[2], 10);
      else durationMin = 15;
    }

    // ---- time ranges: "van 14 tot 16u", "14:00-15:30", "9 tot half 11" -------
    if ((m = take(w,
      rx(`${B0}(?:(?:van(?:af)?|om)\\s+)?(half\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:uur|u)?\\s*(?:-|–|tot(?:\\s+en\\s+met)?)\\s*(half\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(?:uur|u)?${B1}`),
      (x) => /tot|[:.]|\d\s*u|half/i.test(x[0]) && +x[2] < 25 && +x[5] < 25 && (x[3] || 0) < 60 && (x[6] || 0) < 60))) {
      const mk = (half, h, mm) => half ? { h: +h - 1, m: 30, raw: String(+h - 1) } : { h: +h, m: +(mm || 0), raw: h };
      time = mk(m[1], m[2], m[3]);
      endTime = mk(m[4], m[5], m[6]);
    }

    // ---- explicit dates ----------------------------------------------------
    if (!date && (m = take(w, rx(`${B0}(?:(?:op|de|op\\s+de)\\s+)?(\\d{1,2})(?:e|ste|de)?\\s+(${MONTH_RE})\\.?(?:\\s+('?\\d{2,4}))?${B1}`),
      (x) => +x[1] >= 1 && +x[1] <= 31))) {
      date = makeDate(today, +m[1], MONTHS[m[2].toLowerCase()], m[3]);
    }
    if (!date && (m = take(w, rx(`${B0}(?:op\\s+)?(\\d{1,2})[/-](\\d{1,2})(?:[/-](\\d{4}|\\d{2}))?${B1}`),
      (x) => +x[2] >= 1 && +x[2] <= 12 && +x[1] >= 1 && +x[1] <= 31))) {
      date = makeDate(today, +m[1], +m[2] - 1, m[3]);
    }
    if (!date && (m = take(w, rx(`${B0}(?:op\\s+)?de\\s+(\\d{1,2})(?:e|ste|de)${B1}`), (x) => +x[1] >= 1 && +x[1] <= 31))) {
      let d = new Date(today.getFullYear(), today.getMonth(), +m[1]);
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, +m[1]);
      date = d;
    }

    // ---- times ---------------------------------------------------------------
    if (!time && (m = take(w,
      rx(`${B0}(?:(?:om|rond|tegen|omstreeks|vanaf)\\s+)?(?:(kwart|\\d{1,2}|${NUM_RE})\\s+(over|voor)\\s+)?(half\\s+)?${HOUR}(?:\\s*uur)?${B1}`),
      (x) => x[1] || x[3]))) {
      let h = num(m[4]), min = 0;
      if (m[3]) { h -= 1; min = 30; }
      if (m[1]) {
        const off = m[1].toLowerCase() === 'kwart' ? 15 : num(m[1]);
        min += m[2].toLowerCase() === 'over' ? off : -off;
      }
      if (min < 0) { min += 60; h -= 1; }
      if (h < 0) h += 12;
      time = { h, m: min, raw: String(h) };
    }
    if (!time && (m = take(w, rx(`${B0}(?:(?:om|rond|tegen|omstreeks|vanaf)\\s+)?(\\d{1,2})[:.](\\d{2})(?:\\s*(?:uur|u))?${B1}`),
      (x) => +x[1] < 25 && +x[2] < 60))) {
      time = { h: +m[1], m: +m[2], raw: m[1] };
    }
    if (!time && (m = take(w, rx(`${B0}(?:(?:om|rond|tegen|omstreeks|vanaf)\\s+)?${HOUR}\\s*(?:uur|u)${B1}`),
      (x) => num(x[1]) < 25))) {
      time = { h: num(m[1]), m: 0, raw: m[1] };
    }
    if (!time && (m = take(w, rx(`${B0}(?:om|rond|tegen|omstreeks)\\s+${HOUR}${B1}`), (x) => num(x[1]) < 25))) {
      time = { h: num(m[1]), m: 0, raw: m[1] };
    }
    if (endTime == null && time && (m = take(w, rx(`${B0}(?:tot|t/m|-)\\s*${HOUR}(?:[:.](\\d{2}))?\\s*(?:uur|u)?${B1}`),
      (x) => num(x[1]) < 25))) {
      endTime = { h: num(m[1]), m: +(m[2] || 0), raw: m[1] };
    }

    // ---- location ------------------------------------------------------------
    if ((m = take(w, /@\s?(.+?)(?=\s{2,}|,|\s*$)/u))) {
      location = m[1].trim();
    } else if ((m = take(w, /(?<![\p{L}\d])(?:in|locatie:?|adres:?)\s+(\p{Lu}[\p{L}\d'.&-]*(?:\s+(?:\p{Lu}[\p{L}\d'.&-]*|\d+[a-z]?|de|het|van|den|der|aan|op|'t))*)/u))) {
      location = m[1].replace(/\s+(?:de|het|van|den|der|aan|op|'t)$/i, '').trim();
    }

    // ---- priority (tasks) ------------------------------------------------------
    if ((m = take(w, /(?:^|\s)(!{1,3})(?=\s|$)/u))
      || (m = take(w, rx(`${B0}(belangrijk|urgent|spoed|prio)${B1}`)))) {
      priority = true;
    }

    // ---- resolve --------------------------------------------------------------
    let timeGuessed = false;
    // Evening activities: "etentje half 8" means 19:30, not 07:30
    if (!part && time && time.h < 12 && EVENING_RE.test(w.s)) part = 'avond';
    if (time) {
      const h = adjustHour(time.h, part, time.raw);
      time = { h: h === 24 ? 0 : h, m: time.m };
    } else if (part) {
      time = { h: PART_DEFAULT_HOUR[part], m: 0 };
      timeGuessed = true;
    }
    if (endTime) {
      let eh = adjustHour(endTime.h, part, endTime.raw);
      if (time && eh * 60 + endTime.m <= time.h * 60 + time.m && eh < 12) eh += 12;
      endTime = { h: eh === 24 ? 0 : eh, m: endTime.m };
    }

    const hasDate = !!date;
    if (!date && time) {
      date = today;
      if (time.h * 60 + time.m <= now.getHours() * 60 + now.getMinutes()) date = addDays(today, 1);
    }
    if (date && weekdayMode === 'plain' && time && +date === +today
      && time.h * 60 + time.m <= now.getHours() * 60 + now.getMinutes()) {
      date = addDays(date, 7);
    }

    let start = null, end = null;
    if (relStart && !time) {
      start = relStart;
      end = addMinutes(start, durationMin || 60);
      return finish(start, end, true, false);
    }
    if (date) {
      start = new Date(date);
      if (time) start.setHours(time.h, time.m, 0, 0);
      if (time && endTime) {
        end = new Date(date);
        end.setHours(endTime.h, endTime.m, 0, 0);
        if (end <= start) end = addMinutes(end, 24 * 60);
        durationMin = Math.round((end - start) / 60000);
      } else if (time) {
        end = addMinutes(start, durationMin || 60);
      } else {
        end = addDays(start, 1);
      }
    }

    return finish(start, end, hasDate, !!time);

    function finish(st, en, hd, ht) {
      return {
        title: cleanTitle(w.s),
        start: st,
        end: en,
        allDay: !!st && !ht,
        hasDate: hd,
        hasTime: ht,
        timeGuessed,
        durationMin: ht ? (durationMin || Math.round((en - st) / 60000)) : null,
        location,
        recurrence,
        priority,
      };
    }
  }

  function addMinutes(d, n) { return new Date(d.getTime() + n * 60000); }

  function toMinutes(n, unit) {
    const v = /^anderhalf$/i.test(n) ? 1.5 : /^half$/i.test(n) ? 0.5 : num(n);
    unit = unit.toLowerCase();
    if (unit === 'kwartier') return Math.round(v * 15);
    if (/^min/.test(unit)) return Math.round(v);
    return Math.round(v * 60);
  }

  function makeDate(today, day, month, yearRaw) {
    if (yearRaw) {
      let y = parseInt(String(yearRaw).replace("'", ''), 10);
      if (y < 100) y += 2000;
      return new Date(y, month, day);
    }
    let d = new Date(today.getFullYear(), month, day);
    if (d < today) d = new Date(today.getFullYear() + 1, month, day);
    return d;
  }

  function nextWeekday(today, wd, mode) {
    if (mode === 'nextweek') {
      const monday = addDays(today, -((today.getDay() + 6) % 7));
      return addDays(monday, 7 + ((wd + 6) % 7));
    }
    let diff = (wd - today.getDay() + 7) % 7;
    if (mode === 'next' && diff === 0) diff = 7;
    return addDays(today, diff);
  }

  const FILLER = '(?:op|om|van|vanaf|tot|in|de|en|het|voor|rond|tegen|a\\.s\\.|aanstaande|komende|deze|,|-|–|:|;)';
  function cleanTitle(s) {
    let t = s.replace(/\s+/g, ' ').trim();
    const lead = new RegExp(`^${FILLER}(?:\\s+|$)`, 'i');
    const trail = new RegExp(`(?:^|\\s+)${FILLER}$`, 'i');
    let prev;
    do {
      prev = t;
      t = t.replace(lead, '').replace(trail, '').replace(/[,;:\-–]+$/, '').trim();
    } while (t !== prev);
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }

  return { parse, cleanTitle, DAY_CODES };
});
