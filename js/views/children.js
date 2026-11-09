'use strict';
// Screen: children.
// (loaded as a classic script; see index.html for the load order)

/* ---------- ילדים ---------- */
function viewChildren() {
  const u = currentUser();
  const cls = u.isManager ? fget('kidsClass', '') : u.classId;
  const q = fget('kidsSearch', '').trim();
  let list = activeKids().filter(k => !cls || k.classId === cls);
  if (q) list = list.filter(k => `${k.firstName} ${k.lastName} ${k.parentName} ${k.parentPhone} ${k.parent2Name || ''} ${k.parent2Phone || ''}`.includes(q));
  return `${pageHead('ילדים', `${list.length} ילדים${cls ? ' ב' + esc(className(cls)) : ''}`, u.isManager ? `<button class="btn" data-act="exportKids">ייצוא לאקסל</button><button class="btn primary" data-act="editChild">+ ילד/ה חדש/ה</button>` : '')}
  <div class="filters">
    ${u.isManager ? filterSel('kidsClass', 'כיתה', classOpts(cls, 'כל הכיתות')) : ''}
    ${fld('חיפוש', `<input id="kidsSearch" type="search" data-input="kidsSearch" value="${esc(q)}" placeholder="שם ילד / הורה / טלפון">`)}
  </div>
  <div class="table-wrap"><table><thead><tr><th>שם</th><th>כיתה</th><th>גיל</th><th>אם</th><th>טלפון</th><th>רגישויות / הערות</th>${u.isManager ? '<th class="acts"></th>' : ''}</tr></thead><tbody>
  ${list.map(k => `<tr><td><button type="button" class="link kid-name" data-act="childCard" data-id="${k.id}">${esc(k.firstName)} ${esc(k.lastName)}</button></td><td><span class="dot" style="background:${esc(classColor(k.classId))}"></span>${esc(className(k.classId))}</td><td>${ageText(k.birthDate)}</td><td>${esc(k.parentName)}</td><td><a href="tel:${esc(k.parentPhone)}" dir="ltr">${esc(k.parentPhone)}</a></td><td>${k.allergies ? `<span class="pill bad">${esc(k.allergies)}</span> ` : ''}${esc(k.notes)}</td>
    ${u.isManager ? `<td class="acts"><button class="btn sm wa" data-act="sendBank" data-id="${k.id}">וואטסאפ</button> <button class="btn sm" data-act="editChild" data-id="${k.id}">עריכה</button> <button class="btn sm danger" data-act="delChild" data-id="${k.id}">מחיקה</button></td>` : ''}</tr>`).join('')}
  </tbody></table>${list.length ? '' : empty('לא נמצאו ילדים')}</div>`;
}

/* ---------- כרטיס ילד ושליחת פרטי חשבון בוואטסאפ ---------- */
// Israeli numbers (050-1234567, +972 50…) → the international form wa.me expects (972501234567).
function waNumber(phone) {
  let n = String(phone || '').replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  if (n.startsWith('0')) n = '972' + n.slice(1);
  return n.length >= 11 && n.length <= 15 ? n : '';
}
function bankMessage(k, parentName) {
  const b = db.settings.bank || defaultBank(), first = String(parentName || '').trim().split(/\s+/)[0];
  return `שלום${first ? ' ' + first : ''},\nלהלן פרטי החשבון לתשלום עבור ${k.firstName} ${k.lastName} ב${db.settings.gardenName}:\n\n` +
    `${b.bank}\nסניף: ${b.branch}\nמספר חשבון: ${b.account}\nשם המוטב: ${b.beneficiary}\n\nתודה,\n${db.settings.managerName}`;
}
const kidParents = k => [['אם', k.parentName, k.parentPhone], ['אב', k.parent2Name, k.parent2Phone]].filter(p => p[1] || p[2]);

function openChildCard(id) {
  const k = db.children.find(x => x.id === id);
  if (!k) return;
  const u = currentUser();
  const row = (label, val) => val ? `<div class="kv"><span class="muted">${label}</span><span>${val}</span></div>` : '';
  openModal(`${k.firstName} ${k.lastName}`, `
    <div class="kid-head"><span class="dot" style="background:${esc(classColor(k.classId))}"></span><b>${esc(className(k.classId))}</b><span class="muted">· ${ageText(k.birthDate)}</span></div>
    ${k.allergies ? `<div class="notice">⚠️ ${esc(k.allergies)}</div>` : ''}
    <div class="kid-parents">${kidParents(k).map(([role, name, phone]) => `<div class="parent-row"><div><small class="muted">${role}</small><b>${esc(name || '—')}</b>
      ${phone ? `<a href="tel:${esc(phone)}" dir="ltr">${esc(phone)}</a>` : '<span class="muted small">אין טלפון</span>'}</div></div>`).join('') || '<p class="muted small">לא הוזנו פרטי הורים.</p>'}</div>
    ${row('תאריך לידה', fmtDate(k.birthDate))}${row('תחילת שנה', fmtDate(k.startDate))}${row('הערות', esc(k.notes))}
    <div class="actions"><button type="button" class="btn wa block" data-act="sendBank" data-id="${k.id}">💬 שליחת פרטי חשבון בוואטסאפ</button>
      ${u.isManager ? `<button type="button" class="btn" data-act="editChild" data-id="${k.id}">עריכת פרטים</button>` : ''}</div>`, null);
}

function openSendBank(id) {
  const k = db.children.find(x => x.id === id);
  if (!k) return;
  const opts = kidParents(k).map(([role, name, phone]) => {
    const n = waNumber(phone);
    return n ? `<a class="btn wa block wa-pick" href="https://wa.me/${n}?text=${encodeURIComponent(bankMessage(k, name))}" target="_blank" rel="noopener noreferrer" data-wa="${role}">
      <span>שליחה ל${role === 'אם' ? 'אם' : 'אב'}: <b>${esc(name || '')}</b></span><span dir="ltr" class="small">${esc(phone)}</span></a>`
      : `<div class="parent-row muted small">${role}: ${phone ? 'מספר טלפון לא תקין' : 'אין מספר טלפון'} – אפשר להוסיף בעריכת פרטי הילד/ה.</div>`;
  });
  const first = kidParents(k)[0];
  openModal('שליחת פרטי חשבון בוואטסאפ', `
    <p class="small muted" style="margin:0">בוחרים למי לשלוח. וואטסאפ ייפתח עם ההודעה מוכנה, ואת השליחה מאשרים בוואטסאפ.</p>
    <div class="wa-list">${opts.join('') || '<p class="muted">לא הוזנו טלפונים של ההורים.</p>'}</div>
    <div class="wa-preview" dir="rtl">${esc(bankMessage(k, first ? first[1] : '')).replace(/\n/g, '<br>')}</div>`, null);
}
