'use strict';
// Login screen, navigation menu and badges.
// (loaded as a classic script; see index.html for the load order)

/* ============================ מסכים ============================ */

function viewLogin() {
  if (REMOTE) return viewRemoteLogin();
  const opts = [opt('manager', `${db.settings.managerName} (מנהלת)`, '')]
    .concat(activeStaff().map(s => opt(s.id, `${s.name} – ${s.role}, ${className(s.classId)}`, '')));
  return `<div class="login-wrap"><form class="login-card" id="loginForm">
    <div class="login-brand">${brandBanner()}<h1>${esc(db.settings.gardenName)}</h1><p class="brand-sub">${brandSub()}</p><span class="brand-tag">מערכת ניהול הגן</span></div>
    ${fld('משתמש', `<select name="user">${opts.join('')}</select>`)}
    ${fld('קוד אישי', `<input name="pin" type="password" inputmode="numeric" autocomplete="off" required>`)}
    <button class="btn primary block">כניסה</button>
    ${db.settings.demo ? '<div class="hint">נתוני הדגמה: קוד מנהלת <b>1234</b> · קוד צוות <b>1111</b>. אפשר למחוק את נתוני ההדגמה במסך ההגדרות.</div>' : ''}
  </form></div>`;
}

// Shared mode: personal sign-in with email + password
function viewRemoteLogin() {
  if (Remote.state.loading) return `<div class="login-wrap"><div class="login-card"><div class="login-brand">${brandBanner()}</div><p class="muted">טוען…</p></div></div>`;
  return `<div class="login-wrap"><form class="login-card" id="loginForm" novalidate>
    <div class="login-brand">${brandBanner()}<h1>${esc(db.settings.gardenName)}</h1><p class="brand-sub">${brandSub()}</p><span class="brand-tag">מערכת ניהול הגן</span></div>
    ${fld('אימייל', `<input name="email" type="email" autocomplete="username" dir="ltr" required>`)}
    ${fld('סיסמה', `<input name="password" type="password" autocomplete="current-password" required>`)}
    <button class="btn primary block">כניסה</button>
    <button type="button" class="link" data-act="forgotPassword">שכחתי סיסמה</button>
  </form></div>`;
}

const NAV = [
  { v: 'dashboard', label: 'לוח בוקר', icon: '🏠', m: 1 },
  { v: 'myday', label: 'היום שלי', icon: '☀️', s: 1 },
  { v: 'classes', label: 'כיתות', icon: '🏫', m: 1 },
  { v: 'children', label: 'ילדים', icon: '👶', m: 1, s: 1 },
  { v: 'staff', label: 'צוות', icon: '👩‍🏫', m: 1 },
  { v: 'attendance', label: 'נוכחות', icon: '🕒', m: 1, s: 1 },
  { v: 'reports', label: 'דוחות יומיים', icon: '📝', m: 1, s: 1 },
  { v: 'complaints', label: 'תלונות הורים', icon: '⚠️', m: 1, s: 1 },
  { v: 'schedule', label: 'סדר יום', icon: '📅', m: 1, s: 1 },
  { v: 'messages', label: 'הודעות', icon: '✉️', m: 1, s: 1 },
  { v: 'reminders', label: 'תזכורות', icon: '🔔', m: 1, s: 1 },
  { v: 'payroll', label: 'דוח שכר', icon: '💰', m: 1 },
  { v: 'log', label: 'יומן פעולות', icon: '📜', m: 1 },
  { v: 'settings', label: 'הגדרות וגיבוי', icon: '⚙️', m: 1 }
];
function navBadge(v) {
  let n = 0;
  if (v === 'messages' && !isManager()) n = unreadCount();
  if (v === 'reminders' && isManager()) n = db.reminders.filter(r => r.status !== 'done').length;
  if (v === 'complaints' && isManager()) n = db.complaints.filter(c => c.status === 'open').length;
  return n ? `<span class="badge">${n}</span>` : '';
}
