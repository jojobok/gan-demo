'use strict';
// Data model, schedules, local storage load/save and the db object.
// (loaded as a classic script; see index.html for the load order)

const STORE_KEY = 'gan_crm_v1';
const SESSION_KEY = 'gan_crm_session';

/* ---------------------------- נתונים ---------------------------- */
function emptyDb() {
  return {
    version: 1,
    settings: { gardenName: 'גן ילדי ישראל', managerName: 'דקלה חיים', managerPin: '1234', demo: false, bank: defaultBank() },
    classes: [], staff: [], children: [], childAttendance: {}, shifts: [], reports: [],
    complaints: [], schedules: {}, messages: [], reminders: [], log: []
  };
}

const DEFAULT_SCHED = [['07:00', 'קבלת ילדים ומשחק חופשי'], ['08:00', 'ארוחת בוקר'], ['08:45', 'מפגש בוקר – שירים וסיפור'], ['09:30', 'פעילות מרכזית / יצירה'], ['10:15', 'משחק בחצר'], ['11:00', 'פרי ושתייה'], ['11:30', 'ארוחת צהריים'], ['12:15', 'שנת צהריים'], ['14:30', 'ארוחת מנחה'], ['15:00', 'משחק חופשי ופעילות שקטה'], ['16:00', 'איסוף ילדים']];
const BABY_SCHED = [['07:00', 'קבלת תינוקות'], ['07:30', 'בקבוק / ארוחת בוקר'], ['08:30', 'שנת בוקר (לפי צורך)'], ['09:30', 'החתלה ופעילות חושית'], ['10:30', 'טיול בעגלה / חצר'], ['11:15', 'ארוחת צהריים'], ['12:00', 'שנת צהריים'], ['14:00', 'החתלה ובקבוק'], ['14:30', 'משחק על השטיח'], ['16:00', 'איסוף']];

// Account details for parents' payments (editable in the manager's settings).
function defaultBank() { return { bank: 'בנק לאומי', branch: '865', account: '252800/30', beneficiary: 'גן ילדי ישראל בע״מ' }; }

function baseClasses() {
  return [
    { id: 'c1', name: 'תינוקייה', age: 'עד שנה', capacity: 8, color: '#f4a3c8', minStaff: 2 },
    { id: 'c2', name: 'גיל שנה וחצי', age: 'שנה וחצי', capacity: 12, color: '#f5c74f', minStaff: 2 },
    { id: 'c3', name: 'גיל שנתיים', age: 'שנתיים', capacity: 14, color: '#7fd19a', minStaff: 2 },
    { id: 'c4', name: 'גיל שנתיים וחצי', age: 'שנתיים וחצי', capacity: 16, color: '#86b6f2', minStaff: 2 }
  ];
}

function migrate(d) {
  const base = emptyDb();
  for (const k in base) if (d[k] === undefined) d[k] = base[k];
  for (const k in base.settings) if (d.settings[k] === undefined) d.settings[k] = base.settings[k];
  // demo data saved before the rebranding: show the new garden name
  if (d.settings.demo && d.settings.gardenName === 'גן השמש') Object.assign(d.settings, { gardenName: base.settings.gardenName, managerName: base.settings.managerName });
  return d;
}
function load() {
  if (REMOTE) { const d = emptyDb(); d.settings.managerPin = ''; return d; } // shared mode: data comes from the server after sign-in
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) { console.error(e); }
  return seed();
}
function save() {
  if (REMOTE) return; // shared mode: every change is saved on the server, never on the device
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { toast('שמירה נכשלה: ' + e.message, true); }
}

let db = load();
save();
