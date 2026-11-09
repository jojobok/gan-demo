'use strict';
// Shared mode (Supabase). Loaded as a classic script; see index.html for the load order.
//
// How it works:
// - Personal sign-in with email + password (Supabase Auth). The account is linked to the
//   staff record with the same email on first sign-in (link_my_account).
// - After sign-in, everything the user is ALLOWED to read (the database enforces this with
//   RLS) is loaded into the in-memory `db` object, in the same shape the screens already use.
//   Nothing is written to the device's storage except the sign-in session itself.
// - Every change is sent to the server. Edits carry the record's version: if someone else
//   changed it in the meantime, nothing is overwritten and the user is told.
// - Realtime: changes made by others reload the data within about a second.
const Remote = REMOTE ? createRemote() : null;

function createRemote() {
  const TZ = 'Asia/Jerusalem';
  const client = supabase.createClient(GAN_CONFIG.supabaseUrl, GAN_CONFIG.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'gan_crm_auth' },
  });
  const st = { loading: true, live: false, liveLost: false, lastError: '' };
  const notify = () => { if (typeof updateNetBar === 'function') updateNetBar(); };
  const OFFLINE_MSG = 'אין חיבור לאינטרנט. השינוי לא נשמר – החלון נשאר פתוח, ואפשר לשמור כשהחיבור יחזור.';
  let managerIds = new Set();
  let channel = null, reloadTimer = null;

  const ROLE_HE = { teacher: 'גננת', assistant: 'סייעת', manager: 'מנהלת' };
  const ROLE_DB = { 'גננת': 'teacher', 'סייעת': 'assistant' };
  const PRIO_HE = { normal: 'רגילה', high: 'גבוהה', urgent: 'דחופה' };
  const PRIO_DB = { 'רגילה': 'normal', 'גבוהה': 'high', 'דחופה': 'urgent' };
  const STATUS_HE = { open: 'open', in_progress: 'progress', closed: 'closed' };
  const STATUS_DB = { open: 'open', progress: 'in_progress', closed: 'closed' };
  const LIVE_TABLES = ['garden_settings', 'staff', 'classes', 'children', 'child_attendance', 'shifts', 'daily_reports', 'complaints', 'schedule_items', 'messages', 'message_recipients', 'reminders'];

  // ---------- ids: every manager account appears as 'manager' in the screens ----------
  const toLocalId = id => (id && managerIds.has(id) ? 'manager' : (id || ''));
  const toDbId = id => (id === 'manager' ? (me && me.staffId) || null : (id || null));

  // ---------- Israel time <-> timestamps ----------
  const ilFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function ilParts(ts) { const [date, time] = ilFmt.format(new Date(ts)).split(' '); return { date, time }; }
  function ilToISO(date, time) {
    const [y, m, d] = date.split('-').map(Number), [h, mi] = time.split(':').map(Number);
    const target = Date.UTC(y, m - 1, d, h, mi);
    let t = target;
    for (let i = 0; i < 3; i++) {
      const p = ilParts(t), [py, pm, pd] = p.date.split('-').map(Number), [ph, pmi] = p.time.split(':').map(Number);
      t += target - Date.UTC(py, pm - 1, pd, ph, pmi);
    }
    return new Date(t).toISOString();
  }

  // ---------- errors ----------
  const userError = msg => Object.assign(new Error(msg), { userMessage: msg });
  function friendly(e) {
    if (e && e.userMessage) return e.userMessage;
    const msg = String((e && (e.message || e.error_description)) || e || '');
    const code = e && e.code;
    if (/Failed to fetch|NetworkError|Load failed|fetch failed|network/i.test(msg)) return 'אין חיבור לשרת. השינוי לא נשמר – אפשר לנסות שוב.';
    // specific server messages first (some of them also carry the generic "no permission" code)
    if (/no_staff_record_for_this_email/.test(msg)) return 'החשבון הזה לא מוגדר ברשימת הצוות. יש לפנות למנהלת.';
    if (/only_status_and_resolution_may_change/.test(msg)) return 'אפשר לעדכן רק סטטוס ואופן טיפול.';
    if (code === '42501' || /row-level security|not_allowed|permission denied/i.test(msg)) return 'אין לך הרשאה לפעולה הזו.';
    if (code === '23505') return 'כבר קיימת רשומה כזו.';
    if (code === '23503') return 'אי אפשר למחוק: יש רשומות שקשורות לזה (למשל ילדים או דוחות).';
    if (code === '23514' || code === '22P02' || code === '22007') return 'אחד הערכים אינו תקין.';
    if (/already_clocked_in/.test(msg)) return 'כבר קיימת כניסה פתוחה למשמרת.';
    if (/not_clocked_in/.test(msg)) return 'אין משמרת פתוחה.';
    if (/no_recipients/.test(msg)) return 'אין נמענים בקבוצה שנבחרה.';
    return 'הפעולה נכשלה: ' + msg;
  }

  // ---------- reading ----------
  async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
  /** read every row (the API returns at most 1000 rows per request) */
  async function all(build) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const page = await q(build().range(from, from + 999));
      out.push(...page);
      if (page.length < 1000) return out;
    }
  }
  const groupBy = (rows, key) => rows.reduce((m, r) => ((m[r[key]] = m[r[key]] || []).push(r), m), {});
  const time = ts => (ts ? Date.parse(ts) : null);

  async function loadAll() {
    const isMgr = me && me.id === 'manager';
    const since = addDays(todayStr(), -400);
    const sinceTs = ilToISO(since, '00:00');
    const none = Promise.resolve([]);
    const [settings, classes, staffRows, rates, children, priv, att, shifts, reports, complaints, sched, msgs, recips, rems, audit] = await Promise.all([
      q(client.from('garden_settings').select('*').maybeSingle()),
      q(client.from('classes').select('*').is('archived_at', null).order('sort_order')),
      isMgr ? q(client.from('staff').select('*').order('full_name')) : q(client.rpc('staff_directory')),
      isMgr ? all(() => client.from('staff_pay_rates').select('*').order('id')) : none,
      all(() => client.from('children').select('*').order('id')),
      all(() => client.from('child_private').select('*').order('child_id')),
      all(() => client.from('child_attendance').select('child_id, att_date, status').gte('att_date', since).order('att_date').order('child_id')),
      all(() => client.from('shifts').select('*').gte('started_at', sinceTs).order('id')),
      all(() => client.from('daily_reports').select('*').gte('report_date', since).order('id')),
      all(() => client.from('complaints').select('*').order('id')),
      all(() => client.from('schedule_items').select('*').order('start_time')),
      all(() => client.from('messages').select('*').order('id')),
      all(() => client.from('message_recipients').select('*').order('message_id').order('staff_id')),
      all(() => client.from('reminders').select('*').order('id')),
      isMgr ? q(client.from('audit_log').select('id, at, actor_staff_id, action').is('table_name', null).order('at', { ascending: false }).limit(1000)) : none,
    ]);

    managerIds = new Set(staffRows.filter(s => s.role === 'manager').map(s => s.id));
    const mgr = staffRows.find(s => s.role === 'manager');
    const ratesBy = groupBy(rates, 'staff_id');
    const d = emptyDb();
    d.settings = { gardenName: settings ? settings.garden_name : 'הגן שלנו', managerName: mgr ? mgr.full_name : 'המנהלת', managerPin: '', demo: false, _v: settings && settings.version,
      bank: settings ? { bank: settings.bank_name, branch: settings.bank_branch, account: settings.bank_account, beneficiary: settings.bank_beneficiary } : defaultBank() };
    d.classes = classes.map(c => ({ id: c.id, name: c.name, age: c.age_label, capacity: c.capacity, color: c.color, minStaff: c.min_staff ?? 2, _v: c.version }));
    d.staff = staffRows.filter(s => s.role !== 'manager').map(s => {
      const rs = (ratesBy[s.id] || []).map(r => ({ from: r.valid_from, rate: Number(r.hourly_rate) })).sort((a, b) => a.from.localeCompare(b.from));
      const cur = rs.filter(r => r.from <= todayStr()).pop();
      return { id: s.id, name: s.full_name, role: ROLE_HE[s.role] || s.role, classId: s.class_id || '', hourlyRate: cur ? cur.rate : 0, rates: isMgr ? rs : null,
        phone: s.phone || '', email: s.email || '', pin: '', startDate: s.start_date || '', active: s.active !== false, linked: !!s.user_id, _v: s.version };
    });
    const privBy = Object.fromEntries(priv.map(p => [p.child_id, p]));
    d.children = children.map(k => {
      const p = privBy[k.id] || {};
      return { id: k.id, firstName: k.first_name, lastName: k.last_name, classId: k.class_id, allergies: k.allergies || '', startDate: k.start_date || '', active: k.active !== false,
        birthDate: p.birth_date || '', parentName: p.parent1_name || '', parentPhone: p.parent1_phone || '', parent2Name: p.parent2_name || '', parent2Phone: p.parent2_phone || '', notes: p.notes || '', _v: k.version, _pv: p.version, _hasPriv: !!p.child_id };
    });
    for (const a of att) (d.childAttendance[a.att_date] = d.childAttendance[a.att_date] || {})[a.child_id] = a.status === 'present' ? 1 : 0;
    d.shifts = shifts.map(s => {
      const a = ilParts(s.started_at), b = s.ended_at ? ilParts(s.ended_at) : null;
      return { id: s.id, staffId: toLocalId(s.staff_id), date: a.date, start: a.time, end: b ? b.time : '', note: s.note || '', needsReview: s.needs_review, _v: s.version };
    });
    d.reports = reports.map(r => ({ id: r.id, date: r.report_date, classId: r.class_id, staffId: toLocalId(r.author_id), childrenCount: r.children_count, summary: r.summary, meals: r.meals, highlights: r.highlights, createdAt: time(r.created_at), updatedAt: time(r.updated_at), _v: r.version }));
    d.complaints = complaints.map(c => ({ id: c.id, date: c.complaint_date, childId: c.child_id || '', classId: c.class_id || '', parentName: c.parent_name, parentPhone: c.parent_phone, subject: c.subject, description: c.description,
      priority: PRIO_HE[c.priority] || 'רגילה', status: STATUS_HE[c.status] || 'open', assignedTo: toLocalId(c.assigned_to), resolution: c.resolution, createdBy: toLocalId(c.created_by), createdAt: time(c.created_at), _v: c.version }));
    for (const s of sched) (d.schedules[s.class_id] = d.schedules[s.class_id] || []).push({ time: s.start_time.slice(0, 5), activity: s.activity });
    const recBy = groupBy(recips, 'message_id');
    d.messages = msgs.map(m => {
      const rs = recBy[m.id] || [];
      return { id: m.id, toLabel: m.audience_label, recipients: rs.map(r => toLocalId(r.staff_id)), readBy: rs.filter(r => r.read_at).map(r => toLocalId(r.staff_id)), subject: m.subject, body: m.body, createdAt: time(m.created_at) };
    });
    d.reminders = rems.map(r => ({ id: r.id, fromStaffId: toLocalId(r.from_staff_id), text: r.body, dueDate: r.due_date || '', priority: PRIO_HE[r.priority] || 'רגילה', status: r.status, managerNote: r.manager_note, createdAt: time(r.created_at), doneAt: time(r.done_at), _v: r.version }));
    d.log = audit.map(a => ({ ts: time(a.at), userId: toLocalId(a.actor_staff_id), text: a.action }));
    db = d;
  }

  async function reload() {
    try { await loadAll(); st.lastError = ''; } catch (e) { st.lastError = navigator.onLine ? friendly(e) : ''; if (navigator.onLine) toast('טעינת הנתונים נכשלה: ' + st.lastError, true); }
    if (me) render();
    notify();
  }
  function scheduleReload(ms = 500) { clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, ms); }

  function subscribe() {
    if (channel) client.removeChannel(channel);
    channel = client.channel('gan-changes');
    for (const table of LIVE_TABLES) channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => scheduleReload());
    channel.subscribe(status => {
      const wasLost = st.liveLost;
      st.live = status === 'SUBSCRIBED';
      if (st.live) { st.liveLost = false; if (wasLost) scheduleReload(0); } // back: reload so nothing changed meanwhile is missed
      else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status) && me) st.liveLost = true;
      notify();
    });
  }

  /** run a change; on success reload + optional message; on failure show why and return false (forms stay open) */
  async function run(work, okMsg) {
    if (!navigator.onLine) { toast(OFFLINE_MSG, true); notify(); return false; }
    try { await work(); }
    catch (e) { toast(friendly(e), true); if (!e.conflict) scheduleReload(0); return false; }
    await reload();
    if (okMsg) toast(okMsg);
    return undefined;
  }

  /** update only if nobody changed the record since it was loaded */
  async function updateVersioned(table, key, obj, versionField, patch, label) {
    const keyValue = table === 'garden_settings' ? true : obj.id; // settings is a single row with id = true
    const { data, error } = await client.from(table).update(patch).eq(key, keyValue).eq('version', obj[versionField]).select('version');
    if (error) throw error;
    if (data.length) { obj[versionField] = data[0].version; return; }
    const cur = await q(client.from(table).select('version').eq(key, keyValue).maybeSingle());
    if (!cur) throw userError(`${label} נמחק/ה בינתיים על ידי משתמש/ת אחר/ת. השינוי לא נשמר.`);
    obj[versionField] = cur.version; // a second click on "save" is a conscious overwrite
    scheduleReload(0);
    throw Object.assign(userError(`${label} עודכן/ה בינתיים על ידי משתמש/ת אחר/ת. מה שהקלדת נשאר בחלון – לחיצה נוספת על "שמירה" תחליף את השינוי שלה/ו.`), { conflict: true });
  }

  // ---------- auth ----------
  async function afterSignIn() {
    const staff = await q(client.rpc('link_my_account'));
    me = staff.role === 'manager' ? { id: 'manager', staffId: staff.id } : { id: staff.id, staffId: staff.id };
    await loadAll();
    subscribe();
  }
  async function signIn(email, password) {
    const { error } = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw userError(/fetch|network/i.test(error.message) ? 'אין חיבור לשרת.' : 'אימייל או סיסמה שגויים.');
    try { await afterSignIn(); } catch (e) { await client.auth.signOut(); me = null; throw e; }
  }
  async function restore() {
    try {
      const { data } = await client.auth.getSession();
      if (data && data.session) await afterSignIn();
    } catch (e) { me = null; await client.auth.signOut().catch(() => {}); toast(friendly(e), true); }
    st.loading = false;
  }
  async function signOut() {
    if (channel) { await client.removeChannel(channel); channel = null; }
    await client.auth.signOut().catch(() => {});
    me = null; db = emptyDb(); managerIds = new Set();
    st.live = false; st.liveLost = false; st.lastError = ''; notify();
  }
  client.auth.onAuthStateChange(event => {
    if (event === 'PASSWORD_RECOVERY') setTimeout(() => ACTIONS.setNewPassword({}), 0);
  });

  // ---------- writes (local screen shape in, database shape out) ----------
  const ops = {
    clock: () => {
      const open = openShift(currentUser().id);
      return run(async () => { await q(client.rpc(open ? 'clock_out' : 'clock_in')); logEvent(open ? 'יציאה ממשמרת' : 'כניסה למשמרת'); }, open ? 'יציאה נרשמה' : 'כניסה נרשמה');
    },
    /** attendance taps update the screen at once, then the server */
    setAttendance: async (date, childIds, value) => {
      if (!navigator.onLine) { toast(OFFLINE_MSG, true); notify(); return false; }
      db.childAttendance[date] = db.childAttendance[date] || {};
      for (const id of childIds) { if (value === null) delete db.childAttendance[date][id]; else db.childAttendance[date][id] = value; }
      render();
      try {
        if (value === null) await q(client.from('child_attendance').delete().eq('att_date', date).in('child_id', childIds));
        else await q(client.from('child_attendance').upsert(childIds.map(id => ({ child_id: id, att_date: date, status: value === 1 ? 'present' : 'absent' })), { onConflict: 'child_id,att_date' }));
      } catch (e) { toast(friendly(e), true); scheduleReload(0); return false; }
    },
    saveClass: (c, rec) => run(async () => {
      const row = { name: rec.name, age_label: rec.age, capacity: rec.capacity, color: rec.color, min_staff: rec.minStaff };
      if (c) return updateVersioned('classes', 'id', c, '_v', row, 'הכיתה');
      const created = await q(client.from('classes').insert({ ...row, sort_order: db.classes.length + 1 }).select('id').single());
      await q(client.rpc('replace_class_schedule', { p_class: created.id, p_items: DEFAULT_SCHED.map(([time, activity]) => ({ time, activity })) }));
    }, 'נשמר'),
    deleteClass: id => run(() => q(client.from('classes').delete().eq('id', id)), 'הכיתה נמחקה'),
    saveChild: (k, rec) => run(async () => {
      const kid = { first_name: rec.firstName, last_name: rec.lastName, class_id: rec.classId, allergies: rec.allergies, start_date: rec.startDate || null };
      const priv = { birth_date: rec.birthDate || null, parent1_name: rec.parentName, parent1_phone: rec.parentPhone, parent2_name: rec.parent2Name, parent2_phone: rec.parent2Phone, notes: rec.notes };
      if (k) {
        await updateVersioned('children', 'id', k, '_v', kid, 'פרטי הילד/ה');
        if (k._hasPriv) await updateVersioned('child_private', 'child_id', k, '_pv', priv, 'פרטי ההורים');
        else await q(client.from('child_private').insert({ child_id: k.id, ...priv }));
      } else {
        const created = await q(client.from('children').insert(kid).select('id').single());
        await q(client.from('child_private').insert({ child_id: created.id, ...priv }));
      }
    }, 'נשמר'),
    deleteChild: id => run(() => q(client.from('children').delete().eq('id', id)), 'נמחק'),
    saveStaff: (s, rec) => run(async () => {
      const row = { full_name: rec.name, role: ROLE_DB[rec.role] || 'assistant', class_id: rec.classId || null, phone: rec.phone, start_date: rec.startDate || null, active: rec.active, email: rec.email.trim().toLowerCase() };
      let id = s && s.id;
      if (s) await updateVersioned('staff', 'id', s, '_v', row, 'פרטי העובד/ת');
      else id = (await q(client.from('staff').insert(row).select('id').single())).id;
      if (!s || Number(s.hourlyRate) !== Number(rec.hourlyRate)) {
        await q(client.from('staff_pay_rates').upsert({ staff_id: id, hourly_rate: rec.hourlyRate, valid_from: todayStr() }, { onConflict: 'staff_id,valid_from' }));
      }
    }, 'נשמר'),
    saveShift: (s, rec) => run(async () => {
      const endDate = rec.end && rec.end < rec.start ? addDays(rec.date, 1) : rec.date;
      const row = { staff_id: toDbId(rec.staffId), started_at: ilToISO(rec.date, rec.start), ended_at: rec.end ? ilToISO(endDate, rec.end) : null, note: rec.note, source: 'manual', needs_review: false };
      if (s) return updateVersioned('shifts', 'id', s, '_v', row, 'המשמרת');
      await q(client.from('shifts').insert(row));
    }, 'נשמר'),
    deleteShift: id => run(() => q(client.from('shifts').delete().eq('id', id)), 'נמחק'),
    saveReport: (report, rec) => run(async () => {
      const content = { children_count: rec.childrenCount, summary: rec.summary, meals: rec.meals, highlights: rec.highlights };
      if (report) return updateVersioned('daily_reports', 'id', report, '_v', content, 'הדוח');
      const { error } = await client.from('daily_reports').insert({ class_id: rec.classId, report_date: rec.date, ...content });
      if (error && error.code === '23505') throw userError(`ל${className(rec.classId)} כבר יש דוח בתאריך ${fmtDate(rec.date)}. הדוח הקיים לא שונה – אפשר לערוך אותו מרשימת הדוחות.`);
      if (error) throw error;
    }, 'הדוח נשמר'),
    deleteReport: id => run(() => q(client.from('daily_reports').delete().eq('id', id)), 'נמחק'),
    createComplaint: rec => run(() => q(client.from('complaints').insert({
      complaint_date: rec.date, child_id: rec.childId, parent_name: rec.parentName, parent_phone: rec.parentPhone, subject: rec.subject,
      description: rec.description, priority: PRIO_DB[rec.priority] || 'normal', assigned_to: toDbId(rec.assignedTo) })), 'התלונה נרשמה'),
    updateComplaint: (c, patch) => run(() => updateVersioned('complaints', 'id', c, '_v', Object.assign(
      { status: STATUS_DB[patch.status] || 'open', resolution: patch.resolution },
      'assignedTo' in patch ? { assigned_to: toDbId(patch.assignedTo) } : {}), 'התלונה'), 'נשמר'),
    deleteComplaint: id => run(() => q(client.from('complaints').delete().eq('id', id)), 'נמחק'),
    replaceSchedule: (cid, items) => run(() => q(client.rpc('replace_class_schedule', { p_class: cid, p_items: items })), 'סדר היום נשמר'),
    sendMessage: (to, label, subject, body) => {
      const audience = to === 'all' ? 'all' : to.startsWith('role:') ? 'role:' + (ROLE_DB[to.slice(5)] || to.slice(5)) : to.startsWith('class:') ? to : 'staff:' + to;
      return run(() => q(client.rpc('send_message', { p_subject: subject, p_body: body, p_audience: audience, p_label: label })), 'ההודעה נשלחה');
    },
    markRead: ids => run(async () => { for (const id of ids) await q(client.rpc('mark_message_read', { p_message: id })); }),
    deleteMessage: id => run(() => q(client.from('messages').delete().eq('id', id)), 'נמחק'),
    createReminder: rec => run(() => q(client.from('reminders').insert({ body: rec.text, due_date: rec.dueDate || null, priority: PRIO_DB[rec.priority] || 'normal' })), 'התזכורת נשלחה למנהלת'),
    updateReminder: (r, patch) => run(() => updateVersioned('reminders', 'id', r, '_v', Object.assign({},
      'status' in patch ? { status: patch.status } : {}, 'managerNote' in patch ? { manager_note: patch.managerNote } : {}), 'התזכורת')),
    deleteReminder: id => run(() => q(client.from('reminders').delete().eq('id', id))),
    saveSettings: rec => run(async () => {
      await updateVersioned('garden_settings', 'id', db.settings, '_v', { garden_name: rec.gardenName, bank_name: rec.bank.bank, bank_branch: rec.bank.branch, bank_account: rec.bank.account, bank_beneficiary: rec.bank.beneficiary }, 'ההגדרות');
      if (me.staffId) await q(client.from('staff').update({ full_name: rec.managerName }).eq('id', me.staffId));
    }, 'ההגדרות נשמרו'),
  };

  function logEvent(text) { client.rpc('log_event', { p_action: text }).then(() => {}, () => {}); }

  return {
    client, state: st, signIn, signOut, restore, reload, ops, logEvent, friendly, ilToISO, ilParts, toDbId,
    resetPassword: email => client.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: location.origin + location.pathname }),
    changePassword: async pw => { const { error } = await client.auth.updateUser({ password: pw }); if (error) throw userError('שינוי הסיסמה נכשל: ' + error.message); },
  };
}
