'use strict';
// Screen map, rendering, event listeners and start-up. Loaded last.
// (loaded as a classic script; see index.html for the load order)

const VIEWS = { dashboard: viewDashboard, myday: viewMyDay, classes: viewClasses, children: viewChildren, staff: viewStaff, attendance: viewAttendance, reports: viewReports, complaints: viewComplaints, schedule: viewSchedule, messages: viewMessages, reminders: viewReminders, payroll: viewPayroll, log: viewLog, settings: viewSettings };

/* ============================ רינדור ============================ */
const app = document.getElementById('app');
function render() {
  const ae = document.activeElement;
  const fid = ae && ae.id && ae.closest('#app') ? ae.id : null;
  let ss = null, se = null;
  try { ss = ae.selectionStart; se = ae.selectionEnd; } catch (e) { /* ignore */ }

  const u = REMOTE && Remote.state.loading ? null : currentUser();
  if (!u) { me = null; sessSave(); app.innerHTML = viewLogin(); return; }
  const allowed = NAV.filter(n => (u.isManager ? n.m : n.s));
  if (!allowed.some(n => n.v === state.view)) state.view = allowed[0].v;
  app.innerHTML = `<div class="shell">
    <aside class="side">
      ${brandBanner('side-banner')}<div class="brand"><div><b>${esc(db.settings.gardenName)}</b><small>${brandSub()}</small></div></div>
      <nav>${allowed.map(n => `<button class="nav-item ${state.view === n.v ? 'active' : ''}" data-act="nav" data-v="${n.v}"><span class="ic">${n.icon}</span><span>${n.label}</span>${navBadge(n.v)}</button>`).join('')}</nav>
      <div class="userbox"><div><b>${esc(u.name)}</b><small>${u.isManager ? 'מנהלת' : esc(u.role + ' · ' + className(u.classId))}</small></div><button class="btn sm" data-act="logout">יציאה</button></div>
    </aside>
    <main class="main" id="main">${VIEWS[state.view]()}</main>
    ${tabBar(u, allowed)}
  </div>`;
  labelTables(document.getElementById('main'));
  updateNetBar();
  if (fid) {
    const el = document.getElementById(fid);
    if (el) { el.focus(); try { if (ss != null) el.setSelectionRange(ss, se); } catch (e) { /* ignore */ } }
  }
}
// On a phone, table rows are shown as cards: each cell gets its column name as a label.
function labelTables(root) {
  if (!root) return;
  root.querySelectorAll('.table-wrap table:not(.matrix)').forEach(t => {
    const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (td.colSpan === 1) td.dataset.label = heads[i] || ''; }));
  });
}
// Phone navigation: 5 fixed buttons at the bottom; 'עוד' opens every other screen.
const TABS = { m: ['dashboard', 'children', 'attendance', 'messages'], s: ['myday', 'attendance', 'reports', 'messages'] };
const TAB_LABELS = { dashboard: 'בוקר', myday: 'היום', children: 'ילדים', attendance: 'נוכחות', reports: 'דוחות', messages: 'הודעות' };
function tabBar(u, allowed) {
  const ids = TABS[u.isManager ? 'm' : 's'].filter(v => allowed.some(n => n.v === v));
  const inTabs = ids.includes(state.view);
  const moreBadge = allowed.filter(n => !ids.includes(n.v)).map(n => navBadge(n.v)).some(Boolean);
  return `<nav class="tabbar" aria-label="ניווט ראשי">${ids.map(v => { const n = allowed.find(x => x.v === v);
    return `<button class="tab-btn ${state.view === v ? 'active' : ''}" data-act="nav" data-v="${v}" aria-current="${state.view === v ? 'page' : 'false'}"><span class="ic">${n.icon}</span><span>${TAB_LABELS[v] || n.label}</span>${navBadge(v)}</button>`; }).join('')}
    <button class="tab-btn ${inTabs ? '' : 'active'}" data-act="openMore" aria-haspopup="dialog"><span class="ic">☰</span><span>עוד</span>${moreBadge ? '<span class="badge dot-badge"></span>' : ''}</button></nav>`;
}
function commit(msg) { save(); render(); if (msg) toast(msg); }

/* ---------------------------- אירועים ---------------------------- */
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el.dataset, el, e); }
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.filter) { F[el.dataset.filter] = el.value; render(); return; }
  if (el.dataset.change === 'complaintChild') {
    const k = db.children.find(x => x.id === el.value);
    const form = el.form;
    if (k && form) { if (!form.parentName.value) form.parentName.value = k.parentName || ''; if (!form.parentPhone.value) form.parentPhone.value = k.parentPhone || ''; }
    return;
  }
  if (el.id === 'restoreFile' && el.files[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.classes) || !Array.isArray(data.staff)) throw new Error('קובץ לא תקין');
        askConfirm('לשחזר מהגיבוי? כל הנתונים הנוכחיים יוחלפו.', () => { db = migrate(data); logAction('שחזור מגיבוי'); commit('השחזור הושלם'); });
      } catch (err) { toast('שחזור נכשל: ' + err.message, true); }
    };
    reader.readAsText(el.files[0]);
    el.value = '';
  }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.input) { F[el.dataset.input] = el.value; render(); }
});
document.addEventListener('submit', e => {
  const form = e.target;
  if (form.id === 'loginForm' && REMOTE) {
    e.preventDefault();
    const btn = form.querySelector('button.primary');
    if (!form.email.value.trim() || !form.password.value) return toast('יש למלא אימייל וסיסמה', true);
    btn.disabled = true; btn.textContent = 'נכנסת…';
    Remote.signIn(form.email.value, form.password.value).then(() => {
      state.view = me.id === 'manager' ? 'dashboard' : 'myday'; state.p = {};
      logAction('כניסה למערכת'); render();
    }, err => { toast(Remote.friendly(err), true); btn.disabled = false; btn.textContent = 'כניסה'; form.password.value = ''; form.password.focus(); });
    return;
  }
  if (form.id === 'loginForm') {
    e.preventDefault();
    const user = form.user.value, pin = form.pin.value.trim();
    const ok = user === 'manager' ? pin === String(db.settings.managerPin) : (db.staff.find(s => s.id === user) || {}).pin === pin;
    if (!ok) { toast('קוד שגוי', true); form.pin.value = ''; form.pin.focus(); return; }
    me = { id: user }; sessSave();
    state.view = user === 'manager' ? 'dashboard' : 'myday'; state.p = {};
    logAction('כניסה למערכת'); save(); render();
    return;
  }
  if (form.id === 'geoForm') {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    db.settings.geo = Object.assign({}, geoCfg(), { address: (d.address || '').trim(), radius: Number(d.radius) || 200 }, 'enabled' in d ? { enabled: !!d.enabled } : {});
    logAction('עדכון הגדרות שעון הנוכחות'); commit('ההגדרות נשמרו');
    return;
  }
  if (form.id === 'bankForm') {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    if (!requireFields(d, ['bank', 'branch', 'account', 'beneficiary'])) return;
    const bank = { bank: d.bank.trim(), branch: d.branch.trim(), account: d.account.trim(), beneficiary: d.beneficiary.trim() };
    if (REMOTE) return remoteDo(Remote.ops.saveSettings({ gardenName: db.settings.gardenName, managerName: db.settings.managerName, bank }), 'עדכון פרטי החשבון');
    db.settings.bank = bank; logAction('עדכון פרטי החשבון'); commit('פרטי החשבון נשמרו');
    return;
  }
  if (form.id === 'settingsForm') {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    if (REMOTE) {
      if (!requireFields(d, ['gardenName', 'managerName'])) return;
      return remoteDo(Remote.ops.saveSettings({ gardenName: d.gardenName.trim(), managerName: d.managerName.trim(), bank: db.settings.bank || defaultBank() }), 'עדכון הגדרות הגן');
    }
    if (!requireFields(d, ['gardenName', 'managerName', 'managerPin'])) return;
    Object.assign(db.settings, { gardenName: d.gardenName.trim(), managerName: d.managerName.trim(), managerPin: d.managerPin.trim() });
    logAction('עדכון הגדרות הגן'); commit('ההגדרות נשמרו');
    return;
  }
  if (form.id === 'modalForm') {
    e.preventDefault();
    if (!modalHandler) return closeModal();
    const data = {};
    new FormData(form).forEach((v, k) => { data[k] = typeof v === 'string' ? v : ''; });
    form.querySelectorAll('textarea, input[type=text], input[type=tel]').forEach(f => { if (f.name && !(f.name in data)) data[f.name] = ''; });
    const result = modalHandler(data, form);
    if (result && typeof result.then === 'function') {
      // shared mode: wait for the server; on failure the window stays open with everything typed
      const btn = form.querySelector('button[type=submit]');
      const label = btn ? btn.textContent : '';
      if (btn) { btn.disabled = true; btn.textContent = 'שומר…'; }
      const unlock = () => { if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; } };
      result.then(r => { unlock(); if (r === false) return; if (document.getElementById('modalForm') === form) closeModal(); render(); },
                  err => { unlock(); toast(REMOTE ? Remote.friendly(err) : String(err), true); });
      return;
    }
    if (result === false) return;
    closeModal(); save(); render();
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('modal').hidden) closeModal(); });

// עדכון שעון ומסך "היום שלי" כל דקה
setInterval(() => {
  const c = document.getElementById('liveClock');
  if (c) c.textContent = nowTime();
}, 15000);

render();
if (REMOTE) Remote.restore().then(() => { if (me) state.view = me.id === 'manager' ? 'dashboard' : 'myday'; render(); });
