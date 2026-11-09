'use strict';
// Screen: the manager's morning board ("לוח בוקר").
// (loaded as a classic script; see index.html for the load order)
// Everything at a glance per class: arrived / not marked yet / absent, staff on shift against
// the class minimum, allergy alerts, and reports / complaints / reminders that need handling.
// Tapping a class opens its details, where arrival can be marked in one tap.

const BOARD_MARK_LATE = '09:30';   // after this, children not marked yet become a warning
const BOARD_REPORT_LATE = '13:00'; // after this, a missing daily report becomes a warning
const DEFAULT_MIN_STAFF = 2;

/** everything the board shows for one class, computed from the in-memory data */
function classBoard(c, t) {
  const att = db.childAttendance[t] || {};
  const kids = classKids(c.id);
  const present = kids.filter(k => att[k.id] === 1);
  const absent = kids.filter(k => att[k.id] === 0);
  const unmarked = kids.filter(k => att[k.id] === undefined);
  const staff = classStaff(c.id);
  const onShift = staff.filter(s => db.shifts.some(x => x.staffId === s.id && !x.end && x.date === t));
  const offShift = staff.filter(s => !onShift.includes(s));
  const minStaff = Number(c.minStaff) || DEFAULT_MIN_STAFF;
  const ids = new Set(staff.map(s => s.id));
  return {
    c, kids, present, absent, unmarked, staff, onShift, offShift, minStaff,
    shortage: Math.max(0, minStaff - onShift.length),
    // safety: children with a recorded allergy who are here, or may still arrive
    allergic: kids.filter(k => k.allergies && att[k.id] !== 0),
    report: db.reports.find(r => r.date === t && r.classId === c.id) || null,
    complaints: db.complaints.filter(x => x.classId === c.id && x.status !== 'closed'),
    reminders: db.reminders.filter(r => r.status !== 'done' && ids.has(r.fromStaffId)),
  };
}

/** the "needs attention" list for the whole garden, most urgent first */
function boardAttention(boards, t) {
  const now = nowTime(), items = [];
  for (const b of boards) {
    if (b.shortage) items.push({ level: 'bad', icon: '👩‍🏫', cls: b.c.id, text: `${b.c.name}: חסרות ${b.shortage === 1 ? 'עובדת אחת' : b.shortage + ' עובדות'} (${b.onShift.length} מתוך ${b.minStaff} במשמרת)` });
    if (b.unmarked.length) items.push({ level: now >= BOARD_MARK_LATE ? 'warn' : 'info', icon: '🕒', cls: b.c.id, text: `${b.c.name}: ${b.unmarked.length} ילדים טרם סומנו` });
    const allergicHere = b.allergic.filter(k => b.present.includes(k));
    if (allergicHere.length) items.push({ level: 'warn', icon: '⚠️', cls: b.c.id, text: `${b.c.name}: ${allergicHere.length === 1 ? 'ילד/ה עם אלרגיה נוכח/ת' : allergicHere.length + ' ילדים עם אלרגיה נוכחים'} – ${allergicHere.map(k => k.firstName).join(', ')}` });
    if (!b.report && now >= BOARD_REPORT_LATE) items.push({ level: 'warn', icon: '📝', cls: b.c.id, text: `${b.c.name}: טרם הוגש דוח יומי` });
  }
  for (const x of db.complaints.filter(x => x.status !== 'closed' && (x.priority === 'דחופה' || x.priority === 'גבוהה'))) {
    items.push({ level: x.priority === 'דחופה' ? 'bad' : 'warn', icon: '💬', v: 'complaints', text: `תלונה ${x.priority === 'דחופה' ? 'דחופה' : 'בעדיפות גבוהה'}: ${x.subject}` });
  }
  for (const r of db.reminders.filter(r => r.status !== 'done' && r.dueDate && r.dueDate <= t)) {
    items.push({ level: r.dueDate < t ? 'bad' : 'warn', icon: '🔔', v: 'reminders', text: `${r.dueDate < t ? 'באיחור' : 'להיום'}: ${r.text} (${staffName(r.fromStaffId)})` });
  }
  const rank = { bad: 0, warn: 1, info: 2 };
  return items.sort((a, b) => rank[a.level] - rank[b.level]);
}

function viewDashboard() {
  const t = todayStr();
  const boards = db.classes.map(c => classBoard(c, t));
  const sum = (f) => boards.reduce((a, b) => a + f(b), 0);
  const kidsTotal = activeKids().length;
  const present = sum(b => b.present.length), unmarked = sum(b => b.unmarked.length);
  const onShift = db.shifts.filter(s => !s.end && s.date === t).length;
  const reported = boards.filter(b => b.report).length;
  const openC = db.complaints.filter(c => c.status !== 'closed').length;
  const openR = db.reminders.filter(r => r.status !== 'done').length;
  const attention = boardAttention(boards, t);
  const hour = Number(nowTime().slice(0, 2));
  const hello = hour < 12 ? 'בוקר טוב' : hour < 17 ? 'צהריים טובים' : 'ערב טוב';
  return `<div class="board">${brandBanner('board-banner')}
  ${pageHead('לוח בוקר', `${hello}, ${esc(db.settings.managerName)} · ${dayName(t)}, ${fmtDate(t)} · ${nowTime()}`)}
  <div class="stats board-stats">
    ${stat('נוכחים היום', present, `מתוך ${kidsTotal}${unmarked ? ` · ${unmarked} טרם סומנו` : ''}`)}
    ${stat('צוות במשמרת עכשיו', onShift, `מתוך ${activeStaff().length} עובדים`)}
    ${stat('דוחות יומיים היום', `${reported}/${db.classes.length}`, 'כיתות שהגישו')}
    ${stat('ילדים רשומים', kidsTotal, `ב-${db.classes.length} כיתות`)}
    ${stat('תלונות פתוחות', openC, '', openC ? 'warn' : '')}
    ${stat('תזכורות פתוחות', openR, '', openR ? 'warn' : '')}
  </div>
  <section class="card attention" aria-labelledby="attTitle">
    <div class="card-head"><h3 id="attTitle">דורש טיפול</h3><span class="pill ${attention.some(a => a.level === 'bad') ? 'bad' : attention.length ? 'warn' : 'ok'}">${attention.length || 'הכול תקין'}</span></div>
    ${attention.length ? `<ul class="att-items">${attention.map(a => `<li class="att-item ${a.level}" role="button" tabindex="0" ${a.cls ? `data-act="classSheet" data-id="${a.cls}"` : `data-act="nav" data-v="${a.v}"`}><span class="ic" aria-hidden="true">${a.icon}</span><span>${esc(a.text)}</span><span class="chev" aria-hidden="true">‹</span></li>`).join('')}</ul>`
      : '<div class="empty">אין כרגע דברים שדורשים טיפול 🎉</div>'}
  </section>
  <h2 class="sec">הכיתות היום</h2>
  <div class="grid cards4">${boards.map(boardCard).join('')}</div>
  </div>`;
}

function boardCard(b) {
  const n = b.kids.length || 1;
  const seg = (count, cls, label) => count ? `<span class="seg ${cls}" style="flex:${count}" title="${label}: ${count}"></span>` : '';
  const tags = [];
  if (b.shortage) tags.push(`<span class="pill bad">חסרה ${b.shortage === 1 ? 'עובדת' : b.shortage + ' עובדות'}</span>`);
  if (b.allergic.length) tags.push(`<span class="pill warn" title="${esc(b.allergic.map(k => `${k.firstName}: ${k.allergies}`).join(' · '))}">⚠️ אלרגיה: ${b.allergic.map(k => esc(k.firstName)).join(', ')}</span>`);
  tags.push(b.report ? '<span class="pill ok">✓ דוח יומי</span>' : '<span class="pill">טרם הוגש דוח</span>');
  if (b.complaints.length) tags.push(`<span class="pill warn">${b.complaints.length} תלונות</span>`);
  if (b.reminders.length) tags.push(`<span class="pill info">${b.reminders.length} תזכורות</span>`);
  return `<div class="card class-card board-card" style="--cc:${esc(b.c.color)}" role="button" tabindex="0" data-act="classSheet" data-id="${b.c.id}" aria-label="${esc(b.c.name)}: ${b.present.length} הגיעו, ${b.unmarked.length} טרם סומנו, ${b.absent.length} נעדרים. לפרטים">
    <div class="cc-head"><h3>${esc(b.c.name)}</h3><span class="chev" aria-hidden="true">‹</span></div>
    <div class="att-bar" aria-hidden="true">${seg(b.present.length, 'ok', 'הגיעו')}${seg(b.unmarked.length, 'none', 'טרם סומנו')}${seg(b.absent.length, 'bad', 'נעדרים')}${b.kids.length ? '' : '<span class="seg none" style="flex:1"></span>'}</div>
    <div class="board-nums">
      <div class="ok-t"><b>${b.present.length}</b><small>הגיעו</small></div>
      <div class="${b.unmarked.length ? 'warn-t' : ''}"><b>${b.unmarked.length}</b><small>טרם סומנו</small></div>
      <div class="${b.absent.length ? 'bad' : ''}"><b>${b.absent.length}</b><small>נעדרים</small></div>
      <div class="${b.shortage ? 'bad' : ''}"><b>${b.onShift.length}/${b.minStaff}</b><small>צוות</small></div>
    </div>
    <div class="board-tags">${tags.join('')}</div>
  </div>`;
}

/** class details sheet (opened by tapping a class) */
function openClassSheet(id) {
  const c = db.classes.find(x => x.id === id);
  if (!c) return;
  const t = todayStr(), b = classBoard(c, t);
  const names = list => list.map(k => `<span class="chip">${esc(k.firstName)} ${esc(k.lastName)}${k.allergies ? ' ⚠️' : ''}</span>`).join('') || '<span class="muted small">אין</span>';
  const shiftOf = s => db.shifts.find(x => x.staffId === s.id && !x.end && x.date === t);
  openModal(`${c.name} – היום`, `
    <div class="att-bar big" aria-hidden="true">${b.present.length ? `<span class="seg ok" style="flex:${b.present.length}"></span>` : ''}${b.unmarked.length ? `<span class="seg none" style="flex:${b.unmarked.length}"></span>` : ''}${b.absent.length ? `<span class="seg bad" style="flex:${b.absent.length}"></span>` : ''}</div>
    <p class="small muted" style="margin:0">${b.present.length} הגיעו · ${b.unmarked.length} טרם סומנו · ${b.absent.length} נעדרים · ${b.kids.length} רשומים</p>
    <section class="sheet-sec"><h4>טרם סומנו (${b.unmarked.length})</h4>
      ${b.unmarked.map(k => `<div class="att-row"><div><b>${esc(k.firstName)} ${esc(k.lastName)}</b>${k.allergies ? ` <span class="pill bad">⚠️ ${esc(k.allergies)}</span>` : ''}</div>
        <div class="btns"><button type="button" class="btn sm" data-act="boardMark" data-cls="${c.id}" data-id="${k.id}" data-val="1">הגיע/ה</button><button type="button" class="btn sm" data-act="boardMark" data-cls="${c.id}" data-id="${k.id}" data-val="0">נעדר/ת</button></div></div>`).join('') || '<p class="small ok" style="margin:0">✓ כל הילדים סומנו</p>'}
    </section>
    <section class="sheet-sec"><h4>בטיחות ואלרגיות</h4>
      ${b.allergic.map(k => `<div class="row-item"><div><b>${esc(k.firstName)} ${esc(k.lastName)}</b><div class="small">${esc(k.allergies)}</div></div><span class="pill ${b.present.includes(k) ? 'bad' : ''}">${b.present.includes(k) ? 'נוכח/ת' : 'טרם סומנ/ה'}</span></div>`).join('') || '<p class="small muted" style="margin:0">אין ילדים עם אלרגיה רשומה בכיתה.</p>'}
    </section>
    <section class="sheet-sec"><h4>צוות (${b.onShift.length} במשמרת, נדרשות ${b.minStaff})</h4>
      ${b.staff.map(s => { const sh = shiftOf(s); return `<div class="row-item"><div><b>${esc(s.name)}</b> <span class="muted small">${esc(s.role)}</span></div>${sh ? `<span class="pill ok">במשמרת מ-${esc(sh.start)}</span>` : '<span class="pill bad">לא החתימה כניסה</span>'}</div>`; }).join('') || '<p class="small muted" style="margin:0">אין צוות משויך לכיתה.</p>'}
      ${b.shortage ? `<div class="notice" style="margin:8px 0 0">חסרות ${b.shortage === 1 ? 'עובדת אחת' : b.shortage + ' עובדות'} למינימום של הכיתה.</div>` : ''}
    </section>
    <section class="sheet-sec"><h4>דורש טיפול</h4>
      <div class="row-item"><div>דוח יומי</div>${b.report ? '<span class="pill ok">✓ הוגש</span>' : '<span class="pill warn">טרם הוגש</span>'}</div>
      ${b.complaints.map(x => `<div class="row-item"><div><b>${esc(x.subject)}</b><div class="muted small">${esc(childName(x.childId))} · ${fmtDate(x.date)}</div></div>${prioPill(x.priority)}</div>`).join('')}
      ${b.reminders.map(r => `<div class="row-item"><div><b>${esc(r.text)}</b><div class="muted small">${esc(staffName(r.fromStaffId))}${r.dueDate ? ' · עד ' + fmtDate(r.dueDate) : ''}</div></div>${prioPill(r.priority)}</div>`).join('')}
    </section>
    <section class="sheet-sec"><h4>הגעה וחזרה</h4><p class="small muted" style="margin:0">ילדים שהגיעו: </p><div class="chips">${names(b.present)}</div>
      ${b.absent.length ? `<p class="small muted" style="margin:8px 0 0">נעדרים:</p><div class="chips">${names(b.absent)}</div>` : ''}</section>
    <div class="actions">
      <button type="button" class="btn primary" data-act="go" data-v="attendance" data-cls="${c.id}">לסימון נוכחות מלא</button>
      <button type="button" class="btn" data-act="go" data-v="reports" data-cls="${c.id}">לדוחות</button>
      <button type="button" class="btn" data-act="go" data-v="children" data-cls="${c.id}">לילדי הכיתה</button>
    </div>`, null);
  const box = document.querySelector('#modal .modal-box');
  if (box) box.classList.add('sheet');
}

// cards and attention rows act like buttons for the keyboard too
document.addEventListener('keydown', e => {
  const el = e.target.closest && e.target.closest('[role=button][data-act]');
  if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); el.click(); }
});
