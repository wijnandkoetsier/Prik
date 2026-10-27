// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../js/parser.js');

// Tuesday 27 October 2026, 13:19
const NOW = new Date(2026, 9, 27, 13, 19);
const p = (t, kind) => parse(t, { now: NOW, kind });
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function check(text, { title, date, time, end, allDay, location, freq, interval, priority }) {
  const r = p(text);
  if (title !== undefined) assert.equal(r.title, title, `title for "${text}"`);
  if (date !== undefined) assert.equal(r.start && ymd(r.start), date, `date for "${text}"`);
  if (time !== undefined) assert.equal(r.start && hm(r.start), time, `time for "${text}"`);
  if (end !== undefined) assert.equal(r.end && hm(r.end), end, `end for "${text}"`);
  if (allDay !== undefined) assert.equal(r.allDay, allDay, `allDay for "${text}"`);
  if (location !== undefined) assert.equal(r.location, location, `location for "${text}"`);
  if (freq !== undefined) assert.equal(r.recurrence && r.recurrence.freq, freq, `freq for "${text}"`);
  if (interval !== undefined) assert.equal(r.recurrence && r.recurrence.interval, interval, `interval for "${text}"`);
  if (priority !== undefined) assert.equal(r.priority, priority, `priority for "${text}"`);
}

test('placeholder example', () => {
  check('lunch 20 oktober om 20u', { title: 'Lunch', date: '2027-10-20', time: '20:00', end: '21:00' });
});

test('month names and numeric dates', () => {
  check('tandarts 3 november 9:30', { title: 'Tandarts', date: '2026-11-03', time: '09:30' });
  check('verjaardag oma 12 dec', { title: 'Verjaardag oma', date: '2026-12-12', allDay: true });
  check('borrel 14/11 om 17.00', { title: 'Borrel', date: '2026-11-14', time: '17:00' });
  check('kapper op de 30e om 10 uur', { title: 'Kapper', date: '2026-10-30', time: '10:00' });
  check('congres 2 maart 2027', { title: 'Congres', date: '2027-03-02', allDay: true });
});

test('relative days and day parts', () => {
  check('bellen met Piet morgen om 10u', { title: 'Bellen met Piet', date: '2026-10-28', time: '10:00' });
  check('film vanavond', { title: 'Film', date: '2026-10-27', time: '20:00' });
  check('hardlopen morgenochtend 7 uur', { title: 'Hardlopen', date: '2026-10-28', time: '07:00' });
  check('overmorgen etentje half 8', { title: 'Etentje', date: '2026-10-29', time: '19:30' });
  check('vergadering over 3 dagen om 14:00', { title: 'Vergadering', date: '2026-10-30', time: '14:00' });
  check('koffie over 2 uur', { title: 'Koffie', date: '2026-10-27', time: '15:19' });
});

test('weekdays', () => {
  check('padel vrijdag 19u', { title: 'Padel', date: '2026-10-30', time: '19:00' });
  check('dinsdag 10:00 overleg', { title: 'Overleg', date: '2026-11-03', time: '10:00' }); // today's 10:00 passed
  check('dinsdag 16:00 overleg', { title: 'Overleg', date: '2026-10-27', time: '16:00' });
  check('volgende week woensdag sporten', { title: 'Sporten', date: '2026-11-04', allDay: true });
  check('donderdagavond pubquiz', { title: 'Pubquiz', date: '2026-10-29', time: '20:00' });
});

test('times', () => {
  check('afspraak morgen om 3 uur', { time: '15:00' });
  check('afspraak morgen kwart over 3', { time: '15:15' });
  check('afspraak morgen kwart voor 9 \'s ochtends', { time: '08:45' });
  check('afspraak morgen om acht uur \'s avonds', { time: '20:00' });
  check('meeting morgen van 14 tot 16u', { title: 'Meeting', time: '14:00', end: '16:00' });
  check('meeting morgen 9:00-10:30', { title: 'Meeting', time: '09:00', end: '10:30' });
  check('workshop morgen 10u duurt 2 uur', { title: 'Workshop', time: '10:00', end: '12:00' });
  check('call morgen 11u 30 minuten', { title: 'Call', time: '11:00', end: '11:30' });
  check('lunch om 12:30', { title: 'Lunch', date: '2026-10-28', time: '12:30' }); // already past today
  check('borrel om 17u', { title: 'Borrel', date: '2026-10-27', time: '17:00' });
});

test('location', () => {
  check('lunch morgen 12u @ Café de Zwaan', { title: 'Lunch', location: 'Café de Zwaan' });
  check('training vrijdag 20u in Utrecht', { title: 'Training', location: 'Utrecht' });
  check('etentje bij Jan zaterdag', { title: 'Etentje bij Jan', location: null });
});

test('recurrence', () => {
  check('standup elke werkdag om 9u', { title: 'Standup', freq: 'WEEKLY', time: '09:00' });
  check('yoga elke maandag 19:00', { title: 'Yoga', freq: 'WEEKLY', date: '2026-11-02', time: '19:00' });
  check('huur betalen maandelijks de 1e', { title: 'Huur betalen', freq: 'MONTHLY', date: '2026-11-01' });
  check('container buiten om de week donderdag', { title: 'Container buiten', freq: 'WEEKLY', interval: 2 });
});

test('tasks', () => {
  check('offerte versturen morgen', { title: 'Offerte versturen', date: '2026-10-28', allDay: true });
  check('belastingaangifte ! vrijdag', { title: 'Belastingaangifte', priority: true });
  check('boodschappen doen', { title: 'Boodschappen doen', date: null });
});
