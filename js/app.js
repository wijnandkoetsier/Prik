(() => {
  'use strict';

  const P = window.PrikParser;
  const C = window.PrikCal;
  const KEY = 'prik:v1';
  const $ = (s, r = document) => r.querySelector(s);
  const pad = (n) => String(n).padStart(2, '0');
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#i-${id}"/></svg>`;

  const fmtDay = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtLong = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtMonth = new Intl.DateTimeFormat('nl-NL', { month: 'long', year: 'numeric' });
  const fmtMonthShort = new Intl.DateTimeFormat('nl-NL', { month: 'short', year: 'numeric' });

  // ---------------------------------------------------------------- state
  const defaults = () => ({
    events: [],
    tasks: [],
    settings: { open: { events: false, calendar: false, tasks: false } },
  });
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && Array.isArray(d.events)) {
        const base = defaults();
        return { ...base, ...d, settings: { ...base.settings, ...d.settings, open: { ...base.settings.open, ...(d.settings || {}).open } } };
      }
    } catch (e) { /* storage unavailable */ }
    return defaults();
  }
  const state = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- helpers
  function dayLabel(d, now = new Date()) {
    const diff = Math.round((startOfDay(d) - startOfDay(now)) / 864e5);
    if (diff === 0) return 'Vandaag';
    if (diff === 1) return 'Morgen';
    if (diff === 2) return 'Overmorgen';
    if (diff === -1) return 'Gisteren';
    return fmtDay.format(d);
  }
  function repeatLabel(r) {
    if (!r) return '';
    const iv = r.interval || 1;
    if (r.byday && r.byday.length === 5) return 'Elke werkdag';
    if (r.freq === 'DAILY') return iv > 1 ? `Om de ${iv} dagen` : 'Elke dag';
    if (r.freq === 'WEEKLY') {
      if (r.byday && r.byday.length === 1) {
        const names = { MO: 'maandag', TU: 'dinsdag', WE: 'woensdag', TH: 'donderdag', FR: 'vrijdag', SA: 'zaterdag', SU: 'zondag' };
        return iv === 2 ? `Om de week op ${names[r.byday[0]]}` : iv > 2 ? `Elke ${iv} weken` : `Elke ${names[r.byday[0]]}`;
      }
      return iv === 2 ? 'Om de week' : iv > 2 ? `Elke ${iv} weken` : 'Elke week';
    }
    if (r.freq === 'MONTHLY') return iv > 1 ? `Elke ${iv} maanden` : 'Elke maand';
    if (r.freq === 'YEARLY') return 'Elk jaar';
    return 'Herhaalt';
  }
  function durationLabel(min) {
    if (!min) return '';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}u${pad(m)}` : `${h} uur`;
  }

  // ---------------------------------------------------------------- toast
  const toastEl = $('#toast');
  let toastTimer;
  function toast(msg, actionLabel, onAction) {
    toastEl.querySelector('span').textContent = msg;
    const b = toastEl.querySelector('button');
    b.textContent = actionLabel || '';
    b.onclick = () => { hideToast(); onAction && onAction(); };
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, actionLabel ? 5000 : 2600);
  }
  function hideToast() { toastEl.classList.remove('show'); }

  function celebrate() {
    const logo = $('.logo');
    logo.classList.remove('pop'); void logo.offsetWidth; logo.classList.add('pop');
    if (navigator.vibrate) navigator.vibrate(12);
  }

  // ---------------------------------------------------------------- Google Agenda
  // Opens Google Agenda with the appointment filled in; one tap on Opslaan saves it.
  function openInGoogle(ev) {
    const url = C.googleUrl(ev);
    const win = window.open(url, '_blank');
    if (!win) location.href = url; // popup blocked: open in the same tab
  }

  // ---------------------------------------------------------------- composers
  const composers = {
    event: { input: $('#eventInput'), form: $('#eventForm'), preview: $('#eventPreview'), parsed: null },
    task: { input: $('#taskInput'), form: $('#taskForm'), preview: $('#taskPreview'), parsed: null },
  };

  function renderPreview(kind) {
    const c = composers[kind];
    const text = c.input.value.trim();
    const btn = c.form.querySelector('.action');
    btn.classList.toggle('has-text', !!text);
    btn.setAttribute('aria-label', text ? (kind === 'event' ? 'Afspraak prikken' : 'Taak toevoegen') : 'Inspreken');
    if (!text) { c.parsed = null; c.preview.classList.remove('show'); c.preview.innerHTML = ''; return; }

    const r = P.parse(text, { kind });
    c.parsed = r;
    const chips = [];
    if (kind === 'event') {
      if (r.start) {
        chips.push(`<span class="chip">${icon('cal')}${escapeHtml(dayLabel(r.start))}${dayLabel(r.start) === fmtDay.format(r.start) ? '' : ' · ' + escapeHtml(fmtDay.format(r.start))}</span>`);
        chips.push(r.allDay
          ? `<span class="chip">${icon('clock')}Hele dag</span>`
          : `<span class="chip${r.timeGuessed ? ' muted' : ''}">${icon('clock')}${hm(r.start)}–${hm(r.end)}${r.timeGuessed ? ' (geschat)' : ''}</span>`);
      } else {
        chips.push(`<span class="chip muted">${icon('cal')}Geen datum: vandaag, hele dag</span>`);
      }
      if (r.location) chips.push(`<span class="chip">${icon('pin')}${escapeHtml(r.location)}</span>`);
      if (r.recurrence) chips.push(`<span class="chip">${icon('repeat')}${escapeHtml(repeatLabel(r.recurrence))}</span>`);
    } else {
      if (r.start) chips.push(`<span class="chip">${icon('cal')}${escapeHtml(dayLabel(r.start))}${r.hasTime ? ' ' + hm(r.start) : ''}</span>`);
      else chips.push(`<span class="chip muted">${icon('cal')}Geen deadline</span>`);
      if (r.priority) chips.push(`<span class="chip hot">${icon('flag')}Belangrijk</span>`);
      if (r.recurrence) chips.push(`<span class="chip">${icon('repeat')}${escapeHtml(repeatLabel(r.recurrence))}</span>`);
    }
    const hint = kind === 'event'
      ? 'Druk op <kbd>Enter</kbd> om in Google Agenda te zetten'
      : 'Druk op <kbd>Enter</kbd> om toe te voegen';
    c.preview.innerHTML = `
      <p class="preview-title${r.title ? '' : ' empty'}">${r.title ? escapeHtml(r.title) : 'Nog geen titel'}</p>
      <div class="chips">${chips.join('')}</div>
      <p class="preview-hint">${hint}</p>`;
    c.preview.classList.add('show');
  }

  function submit(kind) {
    const c = composers[kind];
    const text = c.input.value.trim();
    if (!text) return;
    const r = c.parsed || P.parse(text, { kind });
    if (kind === 'event') {
      const start = r.start || startOfDay(new Date());
      const end = r.end || addDays(start, 1);
      const ev = {
        id: uid(),
        title: r.title || text,
        start: C.toLocal(start),
        end: C.toLocal(end),
        allDay: r.start ? r.allDay : true,
        location: r.location || '',
        rrule: r.recurrence || null,
        reminder: 15,
        notes: '',
        raw: text,
        created: Date.now(),
      };
      state.events.push(ev);
      save();
      openInGoogle(ev);
      toast('Geprikt! Tik in Google Agenda op Opslaan', 'Ongedaan', () => removeItem('events', ev.id, true));
    } else {
      const task = {
        id: uid(),
        title: r.title || text,
        due: r.start ? ymd(r.start) : null,
        time: r.start && r.hasTime ? hm(r.start) : null,
        priority: !!r.priority,
        rrule: r.recurrence || null,
        notes: '',
        done: false,
        created: Date.now(),
      };
      state.tasks.push(task);
      save();
      toast('Taak geprikt!', 'Ongedaan', () => removeItem('tasks', task.id, true));
    }
    c.input.value = '';
    renderPreview(kind);
    renderAll();
    celebrate();
  }

  for (const kind of ['event', 'task']) {
    const c = composers[kind];
    c.input.addEventListener('input', () => renderPreview(kind));
    c.form.addEventListener('submit', (e) => { e.preventDefault(); submit(kind); });
    c.form.querySelector('.action').addEventListener('click', () => {
      if (listening && listening.kind === kind) return stopListening();
      if (c.input.value.trim()) return submit(kind);
      startListening(kind);
    });
  }

  // ---------------------------------------------------------------- voice
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let listening = null;
  function startListening(kind) {
    if (!SR) {
      toast('Spraak werkt niet in deze browser. Probeer Chrome, of gebruik de microfoon op je toetsenbord.');
      composers[kind].input.focus();
      return;
    }
    stopListening();
    const c = composers[kind];
    const rec = new SR();
    rec.lang = 'nl-NL';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    const btn = c.form.querySelector('.action');
    listening = { kind, rec };
    btn.classList.add('listening');
    btn.setAttribute('aria-label', 'Stop met luisteren');
    rec.onresult = (e) => {
      let txt = '';
      for (const res of e.results) txt += res[0].transcript;
      c.input.value = txt.trim();
      renderPreview(kind);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') toast('Geef Prik toegang tot je microfoon om in te spreken');
      else if (e.error === 'no-speech') toast('Ik hoorde niets. Probeer het nog eens.');
    };
    rec.onend = () => {
      btn.classList.remove('listening');
      if (listening && listening.rec === rec) listening = null;
      renderPreview(kind);
      if (c.input.value.trim()) c.input.focus();
    };
    try { rec.start(); } catch (e) { btn.classList.remove('listening'); listening = null; }
  }
  function stopListening() {
    if (listening) { try { listening.rec.stop(); } catch (e) { /* ignore */ } }
  }

  // ---------------------------------------------------------------- remove + undo
  function removeItem(list, id, silent) {
    const i = state[list].findIndex((x) => x.id === id);
    if (i < 0) return;
    const [item] = state[list].splice(i, 1);
    save(); renderAll();
    if (!silent) {
      toast(list === 'events' ? 'Afspraak verwijderd' : 'Taak verwijderd', 'Ongedaan', () => {
        state[list].splice(i, 0, item); save(); renderAll();
      });
    }
  }

  // ---------------------------------------------------------------- events list
  let showPast = false;
  function renderEvents() {
    const now = new Date();
    const upcoming = [];
    const past = [];
    for (const ev of state.events) {
      const next = C.nextOccurrence(ev, now);
      if (next) upcoming.push({ ev, at: next });
      else past.push({ ev, at: C.fromLocal(ev.start) });
    }
    upcoming.sort((a, b) => a.at - b.at);
    past.sort((a, b) => b.at - a.at);
    $('#eventsCount').textContent = upcoming.length;

    const list = $('#eventsList');
    if (!state.events.length) {
      list.innerHTML = '<p class="empty-state">Nog niets geprikt. Typ hierboven iets als <b>“koffie met Sam vrijdag 10u”</b>.</p>';
      return;
    }
    let html = '';
    let lastLabel = null;
    for (const { ev, at } of upcoming) {
      const label = dayLabel(at, now);
      if (label !== lastLabel) { html += `<div class="group-label">${escapeHtml(label)}</div>`; lastLabel = label; }
      html += eventRow(ev, at);
    }
    if (!upcoming.length) html += '<p class="empty-state">Geen komende afspraken. Lekker rustig.</p>';
    if (past.length) {
      html += `<button type="button" class="more-btn" data-toggle-past>${showPast ? 'Verberg' : 'Toon'} eerdere afspraken (${past.length})</button>`;
      if (showPast) for (const { ev, at } of past) html += eventRow(ev, at, true);
    }
    list.innerHTML = html;
  }
  function eventRow(ev, at, isPast) {
    const end = C.fromLocal(ev.end);
    const when = ev.allDay ? 'Hele<small>dag</small>' : `${hm(at)}<small>${hm(new Date(at.getTime() + (end - C.fromLocal(ev.start))))}</small>`;
    const meta = [];
    if (isPast) meta.push(`<span>${escapeHtml(fmtDay.format(at))}</span>`);
    if (ev.location) meta.push(`<span>${icon('pin')}${escapeHtml(ev.location)}</span>`);
    if (ev.rrule) meta.push(`<span>${icon('repeat')}${escapeHtml(repeatLabel(ev.rrule))}</span>`);
    return `<button type="button" class="item${isPast ? ' past' : ''}" data-event="${ev.id}">
      <span class="bar"></span>
      <span class="when">${when}</span>
      <span class="what"><span class="t">${escapeHtml(ev.title)}</span>${meta.length ? `<span class="m">${meta.join('')}</span>` : ''}</span>
    </button>`;
  }
  $('#eventsList').addEventListener('click', (e) => {
    if (e.target.closest('[data-toggle-past]')) { showPast = !showPast; renderEvents(); return; }
    const b = e.target.closest('[data-event]');
    if (b) openEventDialog(b.dataset.event);
  });

  // ---------------------------------------------------------------- tasks list
  let showDone = false;
  function taskSortKey(t) {
    return (t.due || '9999-99-99') + 'T' + (t.time || '99:99') + (t.priority ? '0' : '1') + t.created;
  }
  function renderTasks() {
    const open = state.tasks.filter((t) => !t.done).sort((a, b) => taskSortKey(a).localeCompare(taskSortKey(b)));
    const done = state.tasks.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    $('#tasksCount').textContent = `${open.length} open`;
    const list = $('#tasksList');
    if (!state.tasks.length) {
      list.innerHTML = '<p class="empty-state">Geen taken. Prik er hierboven een, bijvoorbeeld <b>“btw-aangifte vrijdag !”</b>.</p>';
      return;
    }
    let html = open.map(taskRow).join('') || '<p class="empty-state">Alles af. Goed bezig!</p>';
    if (done.length) {
      html += `<button type="button" class="more-btn" data-toggle-done>${showDone ? 'Verberg' : 'Toon'} voltooid (${done.length})</button>`;
      if (showDone) {
        html += done.map(taskRow).join('');
        html += '<button type="button" class="more-btn" data-clear-done>Voltooide taken wissen</button>';
      }
    }
    list.innerHTML = html;
  }
  function taskRow(t) {
    const today = ymd(new Date());
    const meta = [];
    if (t.due) {
      const d = C.fromLocal(t.due);
      const cls = !t.done && t.due < today ? 'late' : t.due === today ? 'today' : '';
      meta.push(`<span class="due ${cls}">${icon('cal')}${escapeHtml(cls === 'late' ? 'Verlopen · ' + fmtDay.format(d) : dayLabel(d))}${t.time ? ' ' + t.time : ''}</span>`);
    }
    if (t.priority) meta.push(`<span class="prio-flag">${icon('flag')}Belangrijk</span>`);
    if (t.rrule) meta.push(`<span>${icon('repeat')}${escapeHtml(repeatLabel(t.rrule))}</span>`);
    return `<div class="item task${t.done ? ' done' : ''}${t.priority ? ' prio' : ''}" data-task="${t.id}">
      <button type="button" class="check" data-check aria-label="${t.done ? 'Markeer als open' : 'Markeer als klaar'}">${icon('check')}</button>
      <span class="what" data-open role="button" tabindex="0"><span class="t">${escapeHtml(t.title)}</span>${meta.length ? `<span class="m">${meta.join('')}</span>` : ''}</span>
    </div>`;
  }
  function toggleTask(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    t.done = !t.done;
    t.doneAt = t.done ? Date.now() : null;
    // Recurring task: tick it off and plan the next one.
    if (t.done && t.rrule && t.due) {
      const next = nextDue(t);
      if (next) {
        state.tasks.push({ ...t, id: uid(), done: false, doneAt: null, due: ymd(next), created: Date.now() });
      }
    }
    save();
    const row = document.querySelector(`[data-task="${id}"]`);
    if (row) row.classList.toggle('done', t.done);
    if (t.done) { celebrate(); toast('Afgevinkt!', 'Ongedaan', () => toggleTask(id)); }
    setTimeout(renderAll, t.done ? 450 : 0);
  }
  function nextDue(t) {
    const ev = { start: t.due + 'T00:00', end: t.due + 'T00:00', rrule: t.rrule, allDay: true };
    let d = addDays(C.fromLocal(t.due), 1);
    for (let i = 0; i < 800; i++, d = addDays(d, 1)) if (C.occursOn(ev, d)) return d;
    return null;
  }
  $('#tasksList').addEventListener('click', (e) => {
    if (e.target.closest('[data-toggle-done]')) { showDone = !showDone; renderTasks(); return; }
    if (e.target.closest('[data-clear-done]')) {
      const removed = state.tasks.filter((t) => t.done);
      state.tasks = state.tasks.filter((t) => !t.done);
      save(); renderAll();
      toast(`${removed.length} ${removed.length === 1 ? 'taak' : 'taken'} gewist`, 'Ongedaan', () => { state.tasks.push(...removed); save(); renderAll(); });
      return;
    }
    const row = e.target.closest('[data-task]');
    if (!row) return;
    if (e.target.closest('[data-check]')) toggleTask(row.dataset.task);
    else if (e.target.closest('[data-open]')) openTaskDialog(row.dataset.task);
  });
  $('#tasksList').addEventListener('keydown', (e) => {
    const o = e.target.closest('[data-open]');
    if (o && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTaskDialog(o.closest('[data-task]').dataset.task); }
  });

  // ---------------------------------------------------------------- month view
  let viewMonth = startOfDay(new Date()); viewMonth.setDate(1);
  let selectedDay = startOfDay(new Date());
  function renderMonth() {
    const today = startOfDay(new Date());
    $('#calMonthLabel').textContent = fmtMonthShort.format(viewMonth).replace('.', '');
    $('#calToday').textContent = fmtMonth.format(viewMonth);
    const first = new Date(viewMonth);
    const startGrid = addDays(first, -((first.getDay() + 6) % 7));
    let html = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((d) => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = addDays(startGrid, i);
      if (i === 35 && d.getMonth() !== viewMonth.getMonth()) break;
      const evs = state.events.filter((ev) => C.occursOn(ev, d)).length;
      const tks = state.tasks.filter((t) => !t.done && t.due === ymd(d)).length;
      const cls = ['day'];
      if (d.getMonth() !== viewMonth.getMonth()) cls.push('out');
      if (+d === +today) cls.push('today');
      if (+d === +selectedDay) cls.push('sel');
      if (d.getDay() === 0 || d.getDay() === 6) cls.push('weekend');
      const dots = '<i></i>'.repeat(Math.min(evs, 3)) + (tks ? '<i class="task-dot"></i>' : '');
      html += `<button type="button" class="${cls.join(' ')}" data-day="${ymd(d)}" aria-label="${fmtLong.format(d)}${evs ? `, ${evs} afspraken` : ''}${tks ? `, ${tks} taken` : ''}">
        ${d.getDate()}<span class="dots">${dots}</span></button>`;
    }
    $('#calGrid').innerHTML = html;
    renderDayDetail();
  }
  function renderDayDetail() {
    const d = selectedDay;
    const evs = state.events.filter((ev) => C.occursOn(ev, d))
      .sort((a, b) => (a.allDay ? -1 : 0) - (b.allDay ? -1 : 0) || a.start.slice(11).localeCompare(b.start.slice(11)));
    const tks = state.tasks.filter((t) => t.due === ymd(d));
    let html = `<h4>${escapeHtml(fmtLong.format(d))}</h4>`;
    for (const ev of evs) {
      const s = C.fromLocal(ev.start);
      html += eventRow(ev, new Date(d.getFullYear(), d.getMonth(), d.getDate(), s.getHours(), s.getMinutes()));
    }
    html += tks.map(taskRow).join('');
    if (!evs.length && !tks.length) html += '<p class="empty-state">Niets gepland.</p>';
    html += `<button type="button" class="add-on-day" data-add-day>${icon('plus')}Afspraak op deze dag</button>`;
    $('#dayDetail').innerHTML = html;
  }
  $('#calGrid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-day]');
    if (!b) return;
    selectedDay = C.fromLocal(b.dataset.day);
    if (selectedDay.getMonth() !== viewMonth.getMonth()) viewMonth = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), 1);
    renderMonth();
  });
  $('#calPrev').addEventListener('click', () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1); renderMonth(); });
  $('#calNext').addEventListener('click', () => { viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1); renderMonth(); });
  $('#calToday').addEventListener('click', () => {
    selectedDay = startOfDay(new Date());
    viewMonth = new Date(selectedDay.getFullYear(), selectedDay.getMonth(), 1);
    renderMonth();
  });
  // swipe between months
  let touchX = null;
  $('#calGrid').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('#calGrid').addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 60) (dx < 0 ? $('#calNext') : $('#calPrev')).click();
  });
  $('#dayDetail').addEventListener('click', (e) => {
    if (e.target.closest('[data-add-day]')) {
      const d = selectedDay;
      const months = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
      const inp = composers.event.input;
      inp.value = `${d.getDate()} ${months[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''} `;
      renderPreview('event');
      inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
      inp.focus();
      inp.setSelectionRange(0, 0);
      return;
    }
    const ev = e.target.closest('[data-event]');
    if (ev) return openEventDialog(ev.dataset.event);
    const row = e.target.closest('[data-task]');
    if (!row) return;
    if (e.target.closest('[data-check]')) toggleTask(row.dataset.task);
    else openTaskDialog(row.dataset.task);
  });

  // ---------------------------------------------------------------- dialogs
  const evDlg = $('#eventDialog');
  const evForm = $('#eventEdit');
  let editingEvent = null;
  function openEventDialog(id) {
    const ev = state.events.find((x) => x.id === id);
    if (!ev) return;
    editingEvent = ev;
    const f = evForm.elements;
    f.title.value = ev.title;
    f.date.value = ev.start.slice(0, 10);
    f.allDay.checked = !!ev.allDay;
    f.start.value = ev.allDay ? '09:00' : ev.start.slice(11, 16);
    f.end.value = ev.allDay ? '10:00' : ev.end.slice(11, 16);
    f.location.value = ev.location || '';
    f.notes.value = ev.notes || '';
    f.reminder.value = String(ev.reminder ?? 15);
    const r = ev.rrule;
    f.repeat.value = !r ? '' : r.byday && r.byday.length === 5 ? 'WORKDAYS'
      : r.freq === 'WEEKLY' && r.interval === 2 ? 'BIWEEKLY' : r.freq;
    syncAllDay();
    evDlg.showModal();
  }
  function syncAllDay() { evForm.querySelector('.times').classList.toggle('hidden', evForm.elements.allDay.checked); }
  evForm.elements.allDay.addEventListener('change', syncAllDay);
  evForm.elements.start.addEventListener('change', () => {
    // keep the duration when moving the start time
    const ev = editingEvent; const f = evForm.elements;
    if (!ev || ev.allDay || !f.start.value) return;
    const dur = C.fromLocal(ev.end) - C.fromLocal(ev.start);
    const s = C.fromLocal(`${f.date.value}T${f.start.value}`);
    f.end.value = hm(new Date(s.getTime() + dur));
  });
  function readEventForm(ev) {
    const f = evForm.elements;
    ev.title = f.title.value.trim() || ev.title;
    ev.allDay = f.allDay.checked;
    const date = f.date.value || ev.start.slice(0, 10);
    if (ev.allDay) {
      ev.start = `${date}T00:00`;
      ev.end = C.toLocal(addDays(C.fromLocal(date), 1));
    } else {
      const s = C.fromLocal(`${date}T${f.start.value || '09:00'}`);
      let e = C.fromLocal(`${date}T${f.end.value || hm(new Date(s.getTime() + 36e5))}`);
      if (e <= s) e = addDays(e, 1);
      ev.start = C.toLocal(s);
      ev.end = C.toLocal(e);
    }
    ev.location = f.location.value.trim();
    ev.notes = f.notes.value.trim();
    ev.reminder = +f.reminder.value;
    const rep = f.repeat.value;
    const wd = P.DAY_CODES[C.fromLocal(ev.start).getDay()];
    ev.rrule = !rep ? null
      : rep === 'WORKDAYS' ? { freq: 'WEEKLY', interval: 1, byday: ['MO', 'TU', 'WE', 'TH', 'FR'] }
        : rep === 'BIWEEKLY' ? { freq: 'WEEKLY', interval: 2, byday: [wd] }
          : rep === 'WEEKLY' ? { freq: 'WEEKLY', interval: 1, byday: [wd] }
            : { freq: rep, interval: 1 };
  }
  evForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!editingEvent) return;
    readEventForm(editingEvent);
    save(); renderAll(); evDlg.close();
    toast('Opgeslagen. Ook in Google Agenda aanpassen?', 'Openen', () => openInGoogle(editingEvent));
  });
  evForm.querySelector('[data-export]').addEventListener('click', () => {
    if (!editingEvent) return;
    readEventForm(editingEvent); save(); renderAll();
    openInGoogle(editingEvent);
    evDlg.close();
  });
  evForm.querySelector('[data-delete]').addEventListener('click', () => {
    if (!editingEvent) return;
    evDlg.close(); removeItem('events', editingEvent.id);
  });

  const tkDlg = $('#taskDialog');
  const tkForm = $('#taskEdit');
  let editingTask = null;
  function openTaskDialog(id) {
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    editingTask = t;
    const f = tkForm.elements;
    f.title.value = t.title;
    f.date.value = t.due || '';
    f.time.value = t.time || '';
    f.priority.checked = !!t.priority;
    f.notes.value = t.notes || '';
    tkDlg.showModal();
  }
  function readTaskForm(t) {
    const f = tkForm.elements;
    t.title = f.title.value.trim() || t.title;
    t.due = f.date.value || null;
    t.time = t.due && f.time.value ? f.time.value : null;
    t.priority = f.priority.checked;
    t.notes = f.notes.value.trim();
  }
  tkForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!editingTask) return;
    readTaskForm(editingTask); save(); renderAll(); tkDlg.close();
  });
  tkForm.querySelector('[data-export]').addEventListener('click', () => {
    if (!editingTask) return;
    readTaskForm(editingTask); save(); renderAll();
    const t = editingTask;
    const date = t.due || ymd(new Date());
    const ev = t.time
      ? { id: t.id, title: t.title, start: `${date}T${t.time}`, end: C.toLocal(new Date(C.fromLocal(`${date}T${t.time}`).getTime() + 30 * 60000)), allDay: false, notes: t.notes, reminder: 15 }
      : { id: t.id, title: t.title, start: `${date}T00:00`, end: C.toLocal(addDays(C.fromLocal(date), 1)), allDay: true, notes: t.notes };
    openInGoogle(ev);
    tkDlg.close();
  });
  tkForm.querySelector('[data-delete]').addEventListener('click', () => {
    if (!editingTask) return;
    tkDlg.close(); removeItem('tasks', editingTask.id);
  });

  for (const dlg of [evDlg, tkDlg]) {
    dlg.querySelector('[data-close]').addEventListener('click', () => dlg.close());
    // tap on the backdrop closes the sheet
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  }

  // ---------------------------------------------------------------- panels
  for (const d of document.querySelectorAll('details.panel')) {
    d.open = !!state.settings.open[d.dataset.key];
    d.addEventListener('toggle', () => { state.settings.open[d.dataset.key] = d.open; save(); });
  }

  // ---------------------------------------------------------------- footer
  $('#backup').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ ...state, exported: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `prik-backup-${ymd(new Date())}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  $('#restore').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!Array.isArray(d.events) || !Array.isArray(d.tasks)) throw new Error('bad');
      const known = new Set([...state.events, ...state.tasks].map((x) => x.id));
      const ne = d.events.filter((x) => x && x.id && x.start && !known.has(x.id));
      const nt = d.tasks.filter((x) => x && x.id && x.title && !known.has(x.id));
      state.events.push(...ne); state.tasks.push(...nt);
      save(); renderAll();
      toast(`${ne.length} afspraken en ${nt.length} taken teruggezet`);
    } catch (err) {
      toast('Dit is geen geldige Prik back-up');
    }
  });

  // ---------------------------------------------------------------- boot
  function renderAll() { renderEvents(); renderTasks(); renderMonth(); }
  renderAll();
  renderPreview('event');
  // refresh "Vandaag/Morgen" labels when the app comes back into view
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderAll(); renderPreview('event'); renderPreview('task'); } });

  // share target / deep link: ?q=lunch morgen 12u
  const q = new URLSearchParams(location.search).get('q') || new URLSearchParams(location.search).get('text');
  const params = new URLSearchParams(location.search);
  if (q) composers.event.input.value = q;
  if (q || params.get('focus')) {
    renderPreview('event');
    composers.event.input.focus();
    history.replaceState(null, '', location.pathname);
  }

  // ---------------------------------------------------------------- install button
  const installBtn = $('#installBtn');
  const installHelp = $('#installHelp');
  const isInstalled = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let installPrompt = null;
  installBtn.hidden = isInstalled();
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // show our own button instead of the browser banner
    installPrompt = e;
    installBtn.hidden = isInstalled();
  });
  window.addEventListener('appinstalled', () => {
    installBtn.hidden = true;
    installHelp.hidden = true;
    installPrompt = null;
    toast('Prik staat nu op je startscherm');
  });
  installBtn.addEventListener('click', async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      installPrompt = null;
      if (outcome === 'accepted') installBtn.hidden = true;
      return;
    }
    installHelp.innerHTML = isIOS
      ? 'Tik in Safari op de <b>Deel</b>-knop (vierkantje met pijl) en kies <b>Zet op beginscherm</b>.'
      : 'Open het menu van je browser (⋮) en kies <b>App installeren</b> of <b>Toevoegen aan startscherm</b>.';
    installHelp.hidden = false;
    installHelp.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
