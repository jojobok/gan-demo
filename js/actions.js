'use strict';
// All button actions (the ACTIONS map).
// (loaded as a classic script; see index.html for the load order)

/* ============================ פעולות ============================ */
// Shared mode: run a server change; record it in the activity log only if it succeeded.
const remoteDo = (promise, logText) => promise.then(r => { if (r !== false && logText) logAction(logText); return r; });

const ACTIONS = {
  nav: d => { if (!document.getElementById('modal').hidden) closeModal(); state.view = d.v; state.p = {}; render(); window.scrollTo(0, 0); },
  openMore: () => {
    const u = currentUser();
    const items = NAV.filter(n => (u.isManager ? n.m : n.s));
    openModal('כל המסכים', `<div class="more-list">${items.map(n => `<button type="button" class="more-item ${state.view === n.v ? 'active' : ''}" data-act="nav" data-v="${n.v}"><span class="ic">${n.icon}</span><span>${n.label}</span>${navBadge(n.v)}</button>`).join('')}</div>
      <div class="more-user"><span><b>${esc(u.name)}</b> · ${u.isManager ? 'מנהלת' : esc(u.role)}</span><button type="button" class="btn sm" data-act="logout">יציאה</button></div>`, null);
  },
  retrySync: () => { if (REMOTE) Remote.reload(); },
  go: d => {
    if (!document.getElementById('modal').hidden) closeModal();
    state.view = d.v; state.p = d.id ? { id: d.id } : {};
    if (d.cls) {
      if (d.v === 'children') F.kidsClass = d.cls; if (d.v === 'reports') F.repClass = d.cls; if (d.v === 'schedule') F.schedClass = d.cls;
      if (d.v === 'attendance') { F.attTab = 'kids'; F.attClass = d.cls; F.attDate = todayStr(); }
    }
    render(); window.scrollTo(0, 0);
  },
  setF: d => { F[d.k] = d.val; render(); },
  // Morning board: class detail sheet, and one-tap arrival marking for today.
  classSheet: d => openClassSheet(d.id),
  childCard: d => openChildCard(d.id),
  sendBank: d => openSendBank(d.id),
  boardMark: d => {
    const t = todayStr(), val = Number(d.val), kid = db.children.find(k => k.id === d.id);
    const text = `${val ? 'הגעה' : 'היעדרות'}: ${kid ? kid.firstName + ' ' + kid.lastName : ''} ${fmtDate(t)}`;
    if (REMOTE) return remoteDo(Remote.ops.setAttendance(t, [d.id], val), text).then(() => openClassSheet(d.cls));
    if (!db.childAttendance[t]) db.childAttendance[t] = {};
    db.childAttendance[t][d.id] = val;
    logAction(text); commit(); openClassSheet(d.cls);
  },
  logout: () => {
    if (!document.getElementById('modal').hidden) closeModal();
    if (REMOTE) { logAction('יציאה מהמערכת'); for (const k in F) delete F[k]; state.view = 'dashboard'; return Remote.signOut().then(render); }
    logAction('יציאה מהמערכת'); save(); me = null; sessSave(); for (const k in F) delete F[k]; state.view = 'dashboard'; render(); },
  closeModal: () => closeModal(),
  print: () => window.print(),

  clock: () => {
    if (!document.getElementById('modal').hidden) closeModal();
    const open = openShift(currentUser().id);
    if ((!open || open.date !== todayStr()) && geoOn()) return clockInWithLocation(loc => ACTIONS.clockNow(loc));
    return ACTIONS.clockNow(null);
  },
  clockAnyway: d => {
    const reason = (document.querySelector('#modal input[name=reason]') || {}).value || '';
    if (!reason.trim()) return toast('נא לכתוב סיבה קצרה', true);
    const doClock = window.__geoDoClock || (loc => ACTIONS.clockNow(loc)); closeModal();
    doClock({ ok: false, dist: d.dist === '' ? null : Number(d.dist), reason: reason.trim() });
  },
  setGardenHere: () => {
    toast('מאתרים את המיקום…');
    currentPosition().then(pos => {
      db.settings.geo = Object.assign({}, geoCfg(), { lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6), enabled: true, setAcc: pos.acc });
      logAction('עדכון מיקום הגן לשעון הנוכחות'); commit(`מיקום הגן נשמר (דיוק כ-${pos.acc} מ׳). בדיקת המיקום בכניסה למשמרת הופעלה.`);
    }).catch(e => toast(e.message, true));
  },
  clockNow: loc => {
    const flag = loc && !loc.ok ? `📍 כניסה מחוץ לגן${loc.dist != null ? ` (${fmtDist(loc.dist)})` : ' (מיקום לא זמין)'}: ${loc.reason}` : '';
    if (REMOTE) return Remote.ops.clock().then(r => { if (flag) logAction(flag); return r; });
    const u = currentUser(), t = todayStr(), now = nowTime();
    const open = openShift(u.id);
    if (open && open.date !== t) {
      open.end = open.start;
      open.note = (open.note ? open.note + ' · ' : '') + 'לא נרשמה יציאה – יש לעדכן';
      logAction(`משמרת מ-${fmtDate(open.date)} נשארה פתוחה – סומנה לבדיקה`);
      db.shifts.push({ id: uid(), staffId: u.id, date: t, start: now, end: '', note: '' });
      logAction('כניסה למשמרת ' + now);
      return commit('המשמרת הקודמת לא נסגרה ונשלחה לתיקון המנהלת. נרשמה כניסה חדשה ' + now);
    }
    if (open) { open.end = now; logAction(`יציאה ממשמרת (${open.start}–${now})`); return commit('יציאה נרשמה ' + now); }
    db.shifts.push(Object.assign({ id: uid(), staffId: u.id, date: t, start: now, end: '', note: flag }, loc ? { loc } : {}));
    logAction('כניסה למשמרת ' + now + (loc && loc.ok ? ' · 📍 מיקום אומת' : '') + (flag ? ' · ' + flag : ''));
    commit(loc && loc.ok ? `✓ כניסה נרשמה ${now} – המיקום אומת` : flag ? `כניסה נרשמה ${now} וסומנה לבדיקת המנהלת` : 'כניסה נרשמה ' + now);
  },

  att: (d) => {
    const date = fget('attDate', todayStr());
    if (REMOTE) { const cur = (db.childAttendance[date] || {})[d.id]; return Remote.ops.setAttendance(date, [d.id], cur === Number(d.val) ? null : Number(d.val)); }
    if (!db.childAttendance[date]) db.childAttendance[date] = {};
    const v = Number(d.val);
    if (db.childAttendance[date][d.id] === v) delete db.childAttendance[date][d.id];
    else db.childAttendance[date][d.id] = v;
    commit();
  },
  markAll: d => {
    const date = fget('attDate', todayStr());
    if (REMOTE) return remoteDo(Remote.ops.setAttendance(date, classKids(d.cls).map(k => k.id), d.val === '' ? null : 1), `${d.val === '' ? 'ניקוי' : 'סימון כל הילדים נוכחים'} – ${className(d.cls)} ${fmtDate(date)}`);
    if (!db.childAttendance[date]) db.childAttendance[date] = {};
    classKids(d.cls).forEach(k => { if (d.val === '') delete db.childAttendance[date][k.id]; else db.childAttendance[date][k.id] = 1; });
    logAction(`${d.val === '' ? 'ניקוי' : 'סימון כל הילדים נוכחים'} – ${className(d.cls)} ${fmtDate(date)}`);
    commit();
  },

  editClass: d => {
    const c = db.classes.find(x => x.id === d.id);
    openModal(c ? 'עריכת כיתה' : 'כיתה חדשה', `<div class="form-grid">
      ${fld('שם הכיתה', inp('name', c?.name, 'text', 'required'))}${fld('קבוצת גיל', inp('age', c?.age))}
      ${fld('תפוסה מקסימלית', inp('capacity', c?.capacity, 'number', 'min="0"'))}${fld('צבע', inp('color', c?.color || '#86b6f2', 'color'))}
      ${fld('מינימום צוות במשמרת', inp('minStaff', c?.minStaff ?? 2, 'number', 'min="0" max="20"'))}</div>
      ${c ? `<button type="button" class="btn danger" data-act="delClass" data-id="${c.id}" style="align-self:flex-start">מחיקת הכיתה</button>` : ''}`,
    data => {
      if (!requireFields(data, ['name'])) return false;
      const rec = { name: data.name.trim(), age: data.age.trim(), capacity: Number(data.capacity) || 0, color: data.color, minStaff: Math.min(20, Math.max(0, Number(data.minStaff) || 0)) };
      if (REMOTE) return remoteDo(Remote.ops.saveClass(c, rec), `${c ? 'עדכון' : 'יצירת'} כיתה: ${rec.name}`);
      if (c) Object.assign(c, rec); else { const id = uid(); db.classes.push({ id, ...rec }); db.schedules[id] = DEFAULT_SCHED.map(([time, activity]) => ({ time, activity })); }
      logAction(`${c ? 'עדכון' : 'יצירת'} כיתה: ${rec.name}`);
    });
  },
  delClass: d => {
    const c = db.classes.find(x => x.id === d.id);
    if (classKids(d.id).length) return toast('לא ניתן למחוק כיתה שיש בה ילדים. יש להעביר אותם קודם.', true);
    if (!d._ok) return askConfirm(`למחוק את ${c.name}?`, () => ACTIONS.delClass({ ...d, _ok: '1' }));
    if (REMOTE) return remoteDo(Remote.ops.deleteClass(d.id), 'מחיקת כיתה: ' + c.name);
    db.classes = db.classes.filter(x => x.id !== d.id); delete db.schedules[d.id];
    logAction('מחיקת כיתה: ' + c.name); closeModal(); commit('הכיתה נמחקה');
  },

  editChild: d => {
    const k = db.children.find(x => x.id === d.id);
    openModal(k ? 'עריכת פרטי ילד/ה' : 'ילד/ה חדש/ה', childForm(k), data => {
      if (!requireFields(data, ['firstName', 'lastName', 'classId'])) return false;
      const rec = { firstName: data.firstName.trim(), lastName: data.lastName.trim(), classId: data.classId, birthDate: data.birthDate, parentName: data.parentName.trim(), parentPhone: data.parentPhone.trim(), parent2Name: (data.parent2Name || '').trim(), parent2Phone: (data.parent2Phone || '').trim(), allergies: data.allergies.trim(), startDate: data.startDate, notes: data.notes.trim() };
      if (REMOTE) return remoteDo(Remote.ops.saveChild(k, rec), `${k ? 'עדכון' : 'הוספת'} ילד/ה: ${rec.firstName} ${rec.lastName}`);
      if (k) { if (k.classId !== rec.classId) logAction(`העברת ${rec.firstName} ${rec.lastName} מ${className(k.classId)} ל${className(rec.classId)}`); Object.assign(k, rec); }
      else db.children.push({ id: uid(), active: true, ...rec });
      logAction(`${k ? 'עדכון' : 'הוספת'} ילד/ה: ${rec.firstName} ${rec.lastName}`);
    });
  },
  delChild: d => {
    const k = db.children.find(x => x.id === d.id);
    if (!d._ok) return askConfirm(`למחוק את ${k.firstName} ${k.lastName}? היסטוריית הנוכחות תימחק מהדוחות.`, () => ACTIONS.delChild({ ...d, _ok: '1' }));
    if (REMOTE) return remoteDo(Remote.ops.deleteChild(d.id), `מחיקת ילד/ה: ${k.firstName} ${k.lastName}`);
    db.children = db.children.filter(x => x.id !== d.id);
    logAction(`מחיקת ילד/ה: ${k.firstName} ${k.lastName}`); commit('נמחק');
  },
  exportKids: () => {
    const rows = [['שם פרטי', 'שם משפחה', 'כיתה', 'תאריך לידה', 'גיל', 'הורה', 'טלפון', 'אלרגיות', 'הערות']]
      .concat(activeKids().map(k => [k.firstName, k.lastName, className(k.classId), fmtDate(k.birthDate), ageText(k.birthDate), k.parentName, k.parentPhone, k.parent2Name || '', k.parent2Phone || '', k.allergies, k.notes]));
    downloadCsv('רשימת-ילדים.csv', rows);
  },

  editStaff: d => {
    const s = db.staff.find(x => x.id === d.id);
    openModal(s ? 'עריכת עובד/ת' : 'עובד/ת חדש/ה', staffForm(s), data => {
      if (REMOTE) {
        if (!requireFields(data, ['name', 'hourlyRate', 'email'])) return false;
        const rec = { name: data.name.trim(), role: data.role, classId: data.classId, hourlyRate: Number(data.hourlyRate) || 0, phone: data.phone.trim(), email: data.email, startDate: data.startDate, active: data.active === 'on' };
        return remoteDo(Remote.ops.saveStaff(s, rec), `${s ? 'עדכון' : 'הוספת'} עובד/ת: ${rec.name}` + (s && s.hourlyRate !== rec.hourlyRate ? ` (שכר לשעה: ${fmtMoney(s.hourlyRate)} ← ${fmtMoney(rec.hourlyRate)})` : ''));
      }
      if (!requireFields(data, ['name', 'hourlyRate', 'pin'])) return false;
      const rec = { name: data.name.trim(), role: data.role, classId: data.classId, hourlyRate: Number(data.hourlyRate) || 0, phone: data.phone.trim(), pin: data.pin.trim(), startDate: data.startDate, active: data.active === 'on' };
      if (s && s.hourlyRate !== rec.hourlyRate) logAction(`שינוי שכר לשעה ל${rec.name}: ${fmtMoney(s.hourlyRate)} ← ${fmtMoney(rec.hourlyRate)}`);
      if (s) Object.assign(s, rec); else db.staff.push({ id: uid(), ...rec });
      logAction(`${s ? 'עדכון' : 'הוספת'} עובד/ת: ${rec.name}`);
    });
  },

  editShift: d => {
    const s = db.shifts.find(x => x.id === d.id);
    openModal(s ? 'עריכת משמרת' : 'הוספת משמרת', `<div class="form-grid">
      ${fld('עובד/ת', `<select name="staffId" required>${staffOpts(s?.staffId || fget('shiftStaff', ''))}</select>`)}${fld('תאריך', inp('date', s?.date || todayStr(), 'date', 'required'))}
      ${fld('שעת כניסה', inp('start', s?.start || '07:00', 'time', 'required'))}${fld('שעת יציאה', inp('end', s?.end || '', 'time'))}
      ${fld('הערה', inp('note', s?.note), 'full')}</div>`,
    data => {
      if (!requireFields(data, ['staffId', 'date', 'start'])) return false;
      const rec = { staffId: data.staffId, date: data.date, start: data.start, end: data.end, note: data.note.trim() };
      if (REMOTE) return remoteDo(Remote.ops.saveShift(s, rec), s ? `תיקון משמרת של ${staffName(rec.staffId)} ${fmtDate(rec.date)}: ${s.start}–${s.end || '?'} ← ${rec.start}–${rec.end || '?'}` : `הוספת משמרת ידנית ל${staffName(rec.staffId)} ${fmtDate(rec.date)} ${rec.start}–${rec.end || '?'}`);
      if (s) { logAction(`תיקון משמרת של ${staffName(rec.staffId)} ${fmtDate(rec.date)}: ${s.start}–${s.end || '?'} ← ${rec.start}–${rec.end || '?'}`); Object.assign(s, rec); }
      else { db.shifts.push({ id: uid(), ...rec }); logAction(`הוספת משמרת ידנית ל${staffName(rec.staffId)} ${fmtDate(rec.date)} ${rec.start}–${rec.end || '?'}`); }
    });
  },
  delShift: d => {
    const s = db.shifts.find(x => x.id === d.id);
    if (!d._ok) return askConfirm('למחוק את המשמרת?', () => ACTIONS.delShift({ ...d, _ok: '1' }));
    if (REMOTE) return remoteDo(Remote.ops.deleteShift(d.id), `מחיקת משמרת של ${staffName(s.staffId)} ${fmtDate(s.date)}`);
    db.shifts = db.shifts.filter(x => x.id !== d.id);
    logAction(`מחיקת משמרת של ${staffName(s.staffId)} ${fmtDate(s.date)}`); commit('נמחק');
  },
  exportShifts: d => {
    const list = db.shifts.filter(s => s.date.startsWith(d.m) && (!d.sid || s.staffId === d.sid)).sort((a, b) => a.date.localeCompare(b.date));
    downloadCsv(`נוכחות-צוות-${d.m}.csv`, [['תאריך', 'יום', 'עובד/ת', 'כניסה', 'יציאה', 'שעות', 'הערה']].concat(list.map(s => [fmtDate(s.date), DAYS[dow(s.date)], staffName(s.staffId), s.start, s.end, fmtHours(shiftMinutes(s)), s.note])));
  },
  exportKidsMonth: d => {
    const { days, rows } = kidsMonthData(d.cls, d.m);
    downloadCsv(`נוכחות-${className(d.cls)}-${d.m}.csv`, [['ילד/ה'].concat(days.map(fmtDate), ['נוכח', 'נעדר', '%'])].concat(rows.map(r => [`${r.k.firstName} ${r.k.lastName}`].concat(r.vals.map(v => (v === 1 ? 'V' : v === 0 ? 'X' : '')), [r.pres, r.abs, r.pct ?? '']))));
  },

  newReport: () => openReportModal(null),
  editReport: d => openReportModal(db.reports.find(r => r.id === d.id)),
  delReport: d => {
    const r = db.reports.find(x => x.id === d.id);
    if (!d._ok) return askConfirm('למחוק את הדוח?', () => ACTIONS.delReport({ ...d, _ok: '1' }));
    if (REMOTE) return remoteDo(Remote.ops.deleteReport(d.id), `מחיקת דוח יומי – ${className(r.classId)} ${fmtDate(r.date)}`);
    db.reports = db.reports.filter(x => x.id !== d.id);
    logAction(`מחיקת דוח יומי – ${className(r.classId)} ${fmtDate(r.date)}`); commit('נמחק');
  },

  newComplaint: () => openComplaintModal(),
  handleComplaint: d => {
    const c = db.complaints.find(x => x.id === d.id);
    const u = currentUser();
    openModal('טיפול בתלונה', `<div class="info-box"><b>${esc(c.subject)}</b><br>${esc(c.description)}<br><span class="small muted">${fmtDate(c.date)} · ${esc(childName(c.childId))} · ${esc(c.parentName)}</span></div>
      <div class="form-grid">
      ${fld('סטטוס', `<select name="status">${Object.entries(COMPLAINT_STATUS).map(([v, [l]]) => opt(v, l, c.status)).join('')}</select>`)}
      ${u.isManager ? fld('אחראי/ת לטיפול', `<select name="assignedTo">${staffOpts(c.assignedTo, 'המנהלת')}</select>`) : ''}
      ${fld('אופן הטיפול / סיכום', area('resolution', c.resolution, 'rows="3"'), 'full')}</div>`,
    data => {
      const before = c.status;
      if (REMOTE) return remoteDo(Remote.ops.updateComplaint(c, Object.assign({ status: data.status, resolution: data.resolution.trim() }, u.isManager ? { assignedTo: data.assignedTo } : {})), `עדכון תלונה "${c.subject}": ${COMPLAINT_STATUS[before][0]} ← ${COMPLAINT_STATUS[data.status][0]}`);
      c.status = data.status; c.resolution = data.resolution.trim(); c.updatedAt = Date.now();
      if (u.isManager) c.assignedTo = data.assignedTo;
      logAction(`עדכון תלונה "${c.subject}": ${COMPLAINT_STATUS[before][0]} ← ${COMPLAINT_STATUS[c.status][0]}`);
    });
  },
  delComplaint: d => {
    const c = db.complaints.find(x => x.id === d.id);
    if (!d._ok) return askConfirm('למחוק את התלונה?', () => ACTIONS.delComplaint({ ...d, _ok: '1' }));
    if (REMOTE) return remoteDo(Remote.ops.deleteComplaint(d.id), `מחיקת תלונה: ${c.subject}`);
    db.complaints = db.complaints.filter(x => x.id !== d.id);
    logAction(`מחיקת תלונה: ${c.subject}`); commit('נמחק');
  },

  editSchedule: d => {
    if (!canEditSchedule(d.cls)) return;
    const items = (db.schedules[d.cls] || []).slice().sort((a, b) => a.time.localeCompare(b.time));
    openModal(`עריכת סדר יום – ${className(d.cls)}`, `<p class="small muted" style="margin:0">שורה לכל פעילות, בפורמט: <b>שעה פעילות</b>. לדוגמה: <code dir="ltr">08:00 ארוחת בוקר</code></p>
      ${fld('סדר היום', area('lines', items.map(i => `${i.time} ${i.activity}`).join('\n'), 'rows="14" dir="rtl"'))}`,
    data => {
      const out = [], bad = [];
      data.lines.split('\n').map(l => l.trim()).filter(Boolean).forEach(l => {
        const m = l.match(/^(\d{1,2}:\d{2})\s*[-–:]?\s*(.+)$/);
        if (m) out.push({ time: m[1].padStart(5, '0'), activity: m[2].trim() }); else bad.push(l);
      });
      if (bad.length) { toast('שורות לא תקינות: ' + bad.join(' | '), true); return false; }
      if (REMOTE) return remoteDo(Remote.ops.replaceSchedule(d.cls, out.sort((a, b) => a.time.localeCompare(b.time))), `עדכון סדר יום – ${className(d.cls)}`);
      db.schedules[d.cls] = out.sort((a, b) => a.time.localeCompare(b.time));
      logAction(`עדכון סדר יום – ${className(d.cls)}`);
    });
  },

  newMessage: d => {
    const groups = [opt('all', 'כל הצוות', d.to ? '' : 'all'), opt('role:גננת', 'כל הגננות', ''), opt('role:סייעת', 'כל הסייעות', '')]
      .concat(db.classes.map(c => opt('class:' + c.id, `צוות ${c.name}`, '')));
    openModal('הודעה חדשה', `${fld('אל', `<select name="to">${`<optgroup label="קבוצות">${groups.join('')}</optgroup><optgroup label="הודעה אישית">${activeStaff().map(s => opt(s.id, s.name, d.to)).join('')}</optgroup>`}</select>`)}
      ${fld('נושא', inp('subject', '', 'text', 'required'))}${fld('תוכן ההודעה', area('body', '', 'rows="5" required'))}`,
    data => {
      if (!requireFields(data, ['subject', 'body'])) return false;
      let recipients = [], toLabel = '';
      const act = activeStaff();
      if (data.to === 'all') { recipients = act.map(s => s.id); toLabel = 'כל הצוות'; }
      else if (data.to.startsWith('role:')) { const r = data.to.slice(5); recipients = act.filter(s => s.role === r).map(s => s.id); toLabel = r === 'גננת' ? 'כל הגננות' : 'כל הסייעות'; }
      else if (data.to.startsWith('class:')) { const c = data.to.slice(6); recipients = act.filter(s => s.classId === c).map(s => s.id); toLabel = 'צוות ' + className(c); }
      else { recipients = [data.to]; toLabel = staffName(data.to); }
      if (!recipients.length) { toast('אין נמענים בקבוצה שנבחרה', true); return false; }
      if (REMOTE) return remoteDo(Remote.ops.sendMessage(data.to, toLabel, data.subject.trim(), data.body.trim()), `שליחת הודעה "${data.subject.trim()}" אל ${toLabel}`);
      db.messages.push({ id: uid(), toLabel, recipients, subject: data.subject.trim(), body: data.body.trim(), createdAt: Date.now(), readBy: [] });
      logAction(`שליחת הודעה "${data.subject.trim()}" אל ${toLabel}`);
      toast('ההודעה נשלחה');
    }, 'שליחה');
  },
  readMsg: d => { const m = db.messages.find(x => x.id === d.id); if (REMOTE) return m && !m.readBy.includes(me.id) ? remoteDo(Remote.ops.markRead([m.id]), `קריאת הודעה: ${m.subject}`) : undefined; if (m && !m.readBy.includes(me.id)) { m.readBy.push(me.id); logAction(`קריאת הודעה: ${m.subject}`); } commit(); },
  readAll: () => { if (REMOTE) return remoteDo(Remote.ops.markRead(myMessages().filter(m => !m.readBy.includes(me.id)).map(m => m.id)), 'סימון כל ההודעות כנקראו'); myMessages().forEach(m => { if (!m.readBy.includes(me.id)) m.readBy.push(me.id); }); logAction('סימון כל ההודעות כנקראו'); commit(); },
  delMessage: d => { if (!d._ok) return askConfirm('למחוק את ההודעה?', () => ACTIONS.delMessage({ ...d, _ok: '1' })); const m = db.messages.find(x => x.id === d.id); if (REMOTE) return remoteDo(Remote.ops.deleteMessage(d.id), 'מחיקת הודעה: ' + m.subject); db.messages = db.messages.filter(x => x.id !== d.id); logAction('מחיקת הודעה: ' + m.subject); commit(); },

  newReminder: () => {
    openModal('תזכורת / בקשה למנהלת', `${fld('מה צריך?', area('text', '', 'rows="3" required placeholder="לדוגמה: נגמרו מגבונים, צריך להזמין"'))}
      <div class="form-grid">${fld('עד תאריך', inp('dueDate', '', 'date'))}${fld('עדיפות', `<select name="priority">${['רגילה', 'גבוהה', 'דחופה'].map(p => opt(p, p, 'רגילה')).join('')}</select>`)}</div>`,
    data => {
      if (!requireFields(data, ['text'])) return false;
      if (REMOTE) return remoteDo(Remote.ops.createReminder({ text: data.text.trim(), dueDate: data.dueDate, priority: data.priority }), 'שליחת תזכורת למנהלת: ' + data.text.trim());
      db.reminders.push({ id: uid(), fromStaffId: me.id, text: data.text.trim(), dueDate: data.dueDate, priority: data.priority, status: 'open', managerNote: '', createdAt: Date.now() });
      logAction('שליחת תזכורת למנהלת: ' + data.text.trim());
      toast('התזכורת נשלחה למנהלת');
    }, 'שליחה');
  },
  doneReminder: d => { const r = db.reminders.find(x => x.id === d.id); if (REMOTE) return remoteDo(Remote.ops.updateReminder(r, { status: 'done' }), 'סימון תזכורת כבוצעה: ' + r.text).then(x => { if (x !== false) toast('סומן כבוצע'); }); r.status = 'done'; r.doneAt = Date.now(); logAction('סימון תזכורת כבוצעה: ' + r.text); commit('סומן כבוצע'); },
  reopenReminder: d => { const r = db.reminders.find(x => x.id === d.id); if (REMOTE) return remoteDo(Remote.ops.updateReminder(r, { status: 'open' }), 'פתיחה מחדש של תזכורת: ' + r.text); r.status = 'open'; logAction('פתיחה מחדש של תזכורת: ' + r.text); commit(); },
  noteReminder: d => {
    const r = db.reminders.find(x => x.id === d.id);
    openModal('תשובה לתזכורת', `<div class="info-box">${esc(r.text)}<br><span class="small muted">מאת ${esc(staffName(r.fromStaffId))}</span></div>${fld('תשובת המנהלת', area('note', r.managerNote, 'rows="3"'))}
      <label class="fld check"><input type="checkbox" name="done" ${r.status === 'done' ? 'checked' : ''}> סימון כבוצע</label>`,
    data => { if (REMOTE) return remoteDo(Remote.ops.updateReminder(r, { managerNote: data.note.trim(), status: data.done === 'on' ? 'done' : 'open' }), 'תשובה לתזכורת: ' + r.text); r.managerNote = data.note.trim(); r.status = data.done === 'on' ? 'done' : 'open'; logAction('תשובה לתזכורת: ' + r.text); });
  },
  delReminder: d => { if (!d._ok) return askConfirm('למחוק את התזכורת?', () => ACTIONS.delReminder({ ...d, _ok: '1' })); if (REMOTE) return Remote.ops.deleteReminder(d.id); db.reminders = db.reminders.filter(x => x.id !== d.id); commit(); },

  payDetail: d => { F.attTab = 'staff'; F.shiftStaff = d.sid; F.shiftMonth = d.m; state.view = 'attendance'; state.p = {}; render(); window.scrollTo(0, 0); },
  exportPayroll: d => {
    const rows = db.staff.map(s => ({ s, ...staffMonth(s.id, d.m) })).filter(r => r.s.active !== false || r.mins > 0);
    const tot = rows.reduce((a, r) => ({ mins: a.mins + r.mins, gross: a.gross + r.gross }), { mins: 0, gross: 0 });
    downloadCsv(`דוח-שכר-${d.m}.csv`, [['עובד/ת', 'תפקיד', 'כיתה', 'ימי עבודה', 'שעות', 'שכר לשעה', 'ברוטו']]
      .concat(rows.map(r => [r.s.name, r.s.role, className(r.s.classId), r.days, (r.mins / 60).toFixed(2), r.rate, r.gross.toFixed(2)]))
      .concat([['סה״כ', '', '', '', (tot.mins / 60).toFixed(2), '', tot.gross.toFixed(2)]]));
  },

  restoreText: () => {
    openModal('שחזור מטקסט גיבוי', `${fld('מדביקים כאן את טקסט הגיבוי', area('json', '', 'rows="8" dir="ltr" required'))}<p class="small muted" style="margin:0">כל הנתונים הנוכחיים יוחלפו.</p>`, data => {
      try {
        const parsed = JSON.parse(data.json);
        if (!parsed || !Array.isArray(parsed.classes) || !Array.isArray(parsed.staff)) throw new Error('הטקסט אינו גיבוי תקין');
        db = migrate(parsed); logAction('שחזור מגיבוי'); toast('השחזור הושלם');
      } catch (err) { toast('שחזור נכשל: ' + err.message, true); return false; }
    }, 'שחזור');
  },
  backup: () => { downloadFile(`גיבוי-גן-${todayStr()}.json`, JSON.stringify(db, null, 1), 'application/json'); logAction('הורדת גיבוי'); save(); },
  wipe: (d = {}) => {
    if (!d._ok) return askConfirm('למחוק את כל הנתונים? מומלץ להוריד גיבוי קודם. הפעולה אינה הפיכה.', () => ACTIONS.wipe({ ...d, _ok: '1' }));
    const keep = db.settings;
    db = emptyDb(); db.settings = { ...keep, demo: false };
    db.classes = baseClasses();
    db.classes.forEach(c => { db.schedules[c.id] = (c.id === 'c1' ? BABY_SCHED : DEFAULT_SCHED).map(([time, activity]) => ({ time, activity })); });
    logAction('מחיקת כל הנתונים'); commit('הנתונים נמחקו. אפשר להתחיל להוסיף צוות וילדים.');
  },
  // ---- shared mode: one-time import from the local version ----
  importLocal: () => {
    openModal('ייבוא מהגרסה המקומית', `<p class="small muted" style="margin:0">בוחרים את קובץ הגיבוי שהורד מהגרסה המקומית (או מדביקים את הטקסט שלו). לפני הייבוא תוצג רשימה של מה שייובא.</p>
      ${fld('קובץ גיבוי', '<input type="file" name="file" accept=".json,application/json">')}${fld('או טקסט הגיבוי', area('json', '', 'rows="4" dir="ltr"'))}`, async (data, form) => {
      const file = form.querySelector('input[name=file]').files[0];
      const text = file ? await file.text() : data.json;
      let backup;
      try { backup = Importer.parse(text); } catch (e) { toast(e.message, true); return false; }
      setTimeout(() => ACTIONS.importPreview({ backup }), 0);
    }, 'המשך');
  },
  importPreview: ({ backup }) => {
    const rows = Importer.preview(backup).map(([l, n]) => `<tr><td>${esc(l)}</td><td class="num">${n}</td></tr>`).join('');
    openModal('אישור ייבוא', `<div class="table-wrap"><table><tbody>${rows}</tbody></table></div>
      <p class="small muted" style="margin:0">הכותבים והתאריכים המקוריים נשמרים. קודי הכניסה לא מועברים: אחרי הייבוא יש להוסיף אימייל לכל עובדת ולפתוח לה חשבון.</p>
      <div id="importProgress" class="info-box" hidden></div>`, async () => {
      const box = document.getElementById('importProgress');
      box.hidden = false;
      try {
        const res = await Importer.run(backup, t => { box.textContent = t; });
        logAction(`ייבוא מהגרסה המקומית: ${res.counts.children} ילדים, ${res.counts.staff} עובדות, ${res.counts.reports} דוחות`);
        await Remote.reload();
        setTimeout(() => ACTIONS.importDone({ res }), 0);
      } catch (e) { toast('הייבוא נעצר: ' + (e.userMessage || e.message), true); box.textContent = 'הייבוא נעצר. אפשר לתקן ולנסות שוב רק במערכת ריקה.'; await Remote.reload(); return false; }
    }, 'ייבוא');
  },
  importDone: ({ res }) => {
    const labels = { classes: 'כיתות', staff: 'עובדות', children: 'ילדים', attendance: 'סימוני נוכחות', shifts: 'משמרות', reports: 'דוחות יומיים', complaints: 'תלונות', reminders: 'תזכורות', messages: 'הודעות', log: 'רשומות ביומן' };
    openModal('הייבוא הושלם', `<div class="table-wrap"><table><tbody>${Object.entries(res.counts).map(([k, n]) => `<tr><td>${labels[k]}</td><td class="num">${n}</td></tr>`).join('')}</tbody></table></div>
      ${res.skipped.length ? `<details><summary>${res.skipped.length} רשומות לא יובאו</summary><div class="small">${res.skipped.map(esc).join('<br>')}</div></details>` : ''}
      <div class="notice" style="margin:0">השלב הבא: במסך צוות, להוסיף אימייל לכל עובדת, ולפתוח לה חשבון.</div>`, null);
  },

  // ---- shared mode: account ----
  forgotPassword: () => {
    openModal('איפוס סיסמה', `<p class="small muted" style="margin:0">נשלח קישור לאיפוס הסיסמה לאימייל שלך.</p>${fld('אימייל', inp('email', '', 'email', 'required dir="ltr" autocomplete="username"'))}`, async data => {
      if (!requireFields(data, ['email'])) return false;
      try { await Remote.resetPassword(data.email); } catch (e) { /* same answer either way */ }
      toast('אם האימייל רשום במערכת, נשלח אליו קישור לאיפוס הסיסמה.');
    }, 'שליחת קישור');
  },
  changePassword: () => ACTIONS.setNewPassword({ title: 'שינוי סיסמה' }),
  setNewPassword: d => {
    openModal(d.title || 'בחירת סיסמה חדשה', `${fld('סיסמה חדשה (לפחות 10 תווים)', inp('password', '', 'password', 'required autocomplete="new-password"'))}${fld('הקלדה חוזרת', inp('password2', '', 'password', 'required autocomplete="new-password"'))}`, async data => {
      if (data.password.length < 10) { toast('הסיסמה צריכה להכיל לפחות 10 תווים.', true); return false; }
      if (data.password !== data.password2) { toast('הסיסמאות אינן זהות.', true); return false; }
      try { await Remote.changePassword(data.password); } catch (e) { toast(Remote.friendly(e), true); return false; }
      logAction('שינוי סיסמה'); toast('הסיסמה עודכנה');
    }, 'שמירה');
  },
  loadDemo: (d = {}) => {
    if (!d._ok) return askConfirm('לטעון נתוני הדגמה? כל הנתונים הנוכחיים יוחלפו.', () => ACTIONS.loadDemo({ ...d, _ok: '1' }));
    db = seed(); me = { id: 'manager' }; sessSave(); commit('נתוני ההדגמה נטענו');
  }
};

ACTIONS.copyBox = () => {
  const t = document.getElementById('copyBox');
  const fallback = () => { t.focus(); t.select(); toast('הטקסט מסומן. אפשר להעתיק אותו ידנית.'); };
  try { navigator.clipboard.writeText(t.value).then(() => toast('הועתק'), fallback); } catch (e) { fallback(); }
};
