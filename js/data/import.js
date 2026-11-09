'use strict';
// Shared mode: one-time import of a backup made in the LOCAL version.
// (classic script; see index.html for the load order)
// - manager only (the database enforces this as well)
// - only into a new system (no children and no employees yet), so it cannot duplicate data
// - personal codes (PIN) are NOT imported: every employee signs in with her own email + password
// - original authors and dates of reports, complaints, reminders and the activity log are kept
const Importer = REMOTE ? createImporter() : null;

function createImporter() {
  const ROLE_DB = { 'גננת': 'teacher' }; // every other local role becomes 'assistant'
  const PRIO = { 'רגילה': 'normal', 'גבוהה': 'high', 'דחופה': 'urgent' };
  const STATUS = { open: 'open', progress: 'in_progress', closed: 'closed' };
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
  const isTime = v => /^\d{1,2}:\d{2}$/.test(v || '');
  const iso = ts => (ts ? new Date(ts).toISOString() : null);

  function parse(text) {
    let b;
    try { b = JSON.parse(text); } catch (e) { throw new Error('הקובץ אינו גיבוי תקין (JSON).'); }
    if (!b || !Array.isArray(b.classes) || !Array.isArray(b.staff) || !Array.isArray(b.children)) throw new Error('הקובץ אינו גיבוי של מערכת הגן.');
    return b;
  }

  function preview(b) {
    const att = Object.values(b.childAttendance || {}).reduce((a, d) => a + Object.keys(d).length, 0);
    return [
      ['כיתות', b.classes.length], ['עובדות', b.staff.length], ['ילדים', b.children.length], ['סימוני נוכחות', att],
      ['משמרות', (b.shifts || []).length], ['דוחות יומיים', (b.reports || []).length], ['תלונות', (b.complaints || []).length],
      ['הודעות', (b.messages || []).length], ['תזכורות', (b.reminders || []).length], ['רשומות ביומן', (b.log || []).length],
    ];
  }

  async function run(b, progress) {
    const c = Remote.client;
    const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
    const step = (t) => progress && progress(t);
    const skipped = [];

    step('בודק שהמערכת חדשה…');
    const [kids, staffRows] = await Promise.all([q(c.from('children').select('id').limit(1)), q(c.from('staff').select('id, role'))]);
    if (kids.length || staffRows.some(s => s.role !== 'manager')) throw new Error('הייבוא מיועד למערכת חדשה בלבד: כבר קיימים ילדים או עובדות.');

    step('כיתות…');
    const existing = await q(c.from('classes').select('id, name, sort_order'));
    const classMap = {};
    for (const [i, oc] of b.classes.entries()) {
      const row = { name: String(oc.name || '').trim() || 'כיתה', age_label: oc.age || '', capacity: Number(oc.capacity) || 0, color: /^#[0-9a-f]{6}$/i.test(oc.color || '') ? oc.color : '#86b6f2' };
      const match = existing.find(e => e.name.trim() === row.name);
      if (match) { await q(c.from('classes').update(row).eq('id', match.id)); classMap[oc.id] = match.id; }
      else classMap[oc.id] = (await q(c.from('classes').insert({ ...row, sort_order: existing.length + i + 1 }).select('id').single())).id;
    }

    step('עובדות…');
    const staffMap = { manager: me.staffId };
    for (const os of b.staff) {
      const row = { full_name: String(os.name || '').trim() || 'עובדת', role: ROLE_DB[os.role] || 'assistant', class_id: classMap[os.classId] || null,
        phone: os.phone || '', start_date: isDate(os.startDate) ? os.startDate : null, active: os.active !== false, email: null };
      const id = (await q(c.from('staff').insert(row).select('id').single())).id;
      staffMap[os.id] = id;
      // the local version applied one rate to all hours; keep that for the imported history
      await q(c.from('staff_pay_rates').insert({ staff_id: id, hourly_rate: Number(os.hourlyRate) || 0, valid_from: '2000-01-01' }));
    }

    step('ילדים…');
    const childMap = {};
    for (const k of b.children) {
      if (!classMap[k.classId]) { skipped.push(`ילד/ה ${k.firstName} ${k.lastName}: כיתה לא קיימת`); continue; }
      const id = (await q(c.from('children').insert({ first_name: k.firstName || '-', last_name: k.lastName || '-', class_id: classMap[k.classId],
        allergies: k.allergies || '', start_date: isDate(k.startDate) ? k.startDate : null, active: k.active !== false }).select('id').single())).id;
      childMap[k.id] = id;
      await q(c.from('child_private').insert({ child_id: id, birth_date: isDate(k.birthDate) ? k.birthDate : null, parent1_name: k.parentName || '', parent1_phone: k.parentPhone || '', parent2_name: k.parent2Name || '', parent2_phone: k.parent2Phone || '', notes: k.notes || '' }));
    }

    step('נוכחות…');
    const att = [];
    for (const [date, marks] of Object.entries(b.childAttendance || {})) {
      if (!isDate(date)) continue;
      for (const [kid, v] of Object.entries(marks)) if (childMap[kid] && (v === 1 || v === 0)) att.push({ child_id: childMap[kid], att_date: date, status: v === 1 ? 'present' : 'absent' });
    }
    for (let i = 0; i < att.length; i += 500) await q(c.from('child_attendance').upsert(att.slice(i, i + 500), { onConflict: 'child_id,att_date' }));

    step('משמרות…');
    const shifts = [];
    const openSeen = new Set();
    for (const s of (b.shifts || []).slice().sort((x, y) => (y.date + y.start).localeCompare(x.date + x.start))) {
      const staff = staffMap[s.staffId];
      if (!staff || !isDate(s.date) || !isTime(s.start) || (s.end && !isTime(s.end))) { skipped.push(`משמרת ${s.date || ''}: נתונים חסרים`); continue; }
      const start = Remote.ilToISO(s.date, s.start);
      let end = null;
      if (s.end) { end = Remote.ilToISO(s.end < s.start ? addDays(s.date, 1) : s.date, s.end); if (Date.parse(end) - Date.parse(start) > 16 * 3600e3) { skipped.push(`משמרת ${s.date}: ארוכה מ-16 שעות`); continue; } }
      else if (openSeen.has(staff)) { skipped.push(`משמרת פתוחה נוספת ${s.date}`); continue; } else openSeen.add(staff);
      shifts.push({ staff_id: staff, started_at: start, ended_at: end, note: s.note || '', source: 'manual' });
    }
    for (let i = 0; i < shifts.length; i += 500) await q(c.from('shifts').insert(shifts.slice(i, i + 500)));

    step('דוחות, תלונות ותזכורות…');
    const reports = (b.reports || []).filter(r => classMap[r.classId] && isDate(r.date) && String(r.summary || '').trim()).map(r => ({
      class_id: classMap[r.classId], report_date: r.date, children_count: Math.max(0, Math.min(200, Number(r.childrenCount) || 0)), summary: String(r.summary).slice(0, 5000),
      meals: r.meals || '', highlights: r.highlights || '', author_id: staffMap[r.staffId] || me.staffId, created_at: iso(r.createdAt) }));
    if (reports.length) await q(c.rpc('import_records', { p_kind: 'daily_reports', p_rows: reports }));
    const complaints = (b.complaints || []).filter(x => String(x.subject || '').trim() && isDate(x.date)).map(x => ({
      complaint_date: x.date, child_id: childMap[x.childId] || null, parent_name: x.parentName || '', parent_phone: x.parentPhone || '', subject: String(x.subject).slice(0, 200),
      description: x.description || '', priority: PRIO[x.priority] || 'normal', status: STATUS[x.status] || 'open', assigned_to: staffMap[x.assignedTo] || null,
      resolution: x.resolution || '', created_by: staffMap[x.createdBy] || me.staffId, created_at: iso(x.createdAt) }));
    if (complaints.length) await q(c.rpc('import_records', { p_kind: 'complaints', p_rows: complaints }));
    const reminders = (b.reminders || []).filter(r => String(r.text || '').trim()).map(r => ({
      from_staff_id: staffMap[r.fromStaffId] || me.staffId, body: String(r.text).slice(0, 1000), due_date: isDate(r.dueDate) ? r.dueDate : null, priority: PRIO[r.priority] || 'normal',
      status: r.status === 'done' ? 'done' : 'open', manager_note: r.managerNote || '', done_at: r.status === 'done' ? iso(r.doneAt || r.createdAt) : null, created_at: iso(r.createdAt) }));
    if (reminders.length) await q(c.rpc('import_records', { p_kind: 'reminders', p_rows: reminders }));

    step('סדר יום והודעות…');
    for (const [oldCls, items] of Object.entries(b.schedules || {})) {
      if (!classMap[oldCls] || !Array.isArray(items)) continue;
      await q(c.rpc('replace_class_schedule', { p_class: classMap[oldCls], p_items: items.filter(i => isTime(i.time) && i.activity).map(i => ({ time: i.time, activity: String(i.activity).slice(0, 200) })) }));
    }
    for (const m of (b.messages || [])) {
      const created = await q(c.from('messages').insert({ audience_label: String(m.toLabel || '').slice(0, 100), subject: String(m.subject || '-').slice(0, 200), body: String(m.body || '-').slice(0, 5000), created_at: iso(m.createdAt) }).select('id').single());
      const rec = (m.recipients || []).filter(id => staffMap[id] && id !== 'manager').map(id => ({ message_id: created.id, staff_id: staffMap[id], read_at: (m.readBy || []).includes(id) ? iso(m.createdAt) : null }));
      if (rec.length) await q(c.from('message_recipients').insert(rec));
    }

    step('הגדרות ויומן…');
    if (b.settings && b.settings.gardenName) await q(c.from('garden_settings').update({ garden_name: String(b.settings.gardenName).slice(0, 100) }).eq('id', true));
    const log = (b.log || []).filter(l => l && l.text).map(l => ({ at: iso(l.ts), actor_staff_id: staffMap[l.userId] || null, text: String(l.text) })).reverse();
    for (let i = 0; i < log.length; i += 500) await q(c.rpc('import_records', { p_kind: 'log', p_rows: log.slice(i, i + 500) }));

    return { counts: { classes: b.classes.length, staff: b.staff.length, children: Object.keys(childMap).length, attendance: att.length, shifts: shifts.length, reports: reports.length, complaints: complaints.length, reminders: reminders.length, messages: (b.messages || []).length, log: log.length }, skipped };
  }

  return { parse, preview, run };
}
