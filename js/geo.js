'use strict';
// Clock-in location check ("שעון נוכחות עם GPS").
// The manager saves the garden's location once (standing in the garden). When a staff member
// starts a shift, the phone's location is compared with it. Only the DISTANCE is kept,
// never the staff member's coordinates. A phone's location can be faked, so this is a
// check that deters mistakes and abuse, not legal proof.
// (loaded as a classic script; see index.html for the load order)

const GEO_RADII = [100, 200, 300, 500];
const geoCfg = () => db.settings.geo || {};
const geoOn = () => { const g = geoCfg(); return !!(g.enabled && Number.isFinite(g.lat) && Number.isFinite(g.lng)); };

function distanceMeters(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
const fmtDist = m => (m >= 1000 ? (m / 1000).toFixed(1) + ' ק״מ' : m + ' מ׳');

/** the phone's position → { lat, lng, acc } or throws a Hebrew message */
function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('הטלפון או הדפדפן לא מאפשרים בדיקת מיקום.'));
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) }),
      e => reject(new Error(e.code === 1
        ? 'לא ניתנה הרשאת מיקום. באייפון: הגדרות ← פרטיות ← שירותי מיקום ← Safari ← "בזמן השימוש", ואז לנסות שוב.'
        : 'לא הצלחנו לאתר את המיקום. כדאי לצאת לרגע לחלון או לחצר ולנסות שוב.')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
}

/** compare a position with the garden: { ok, dist } (GPS accuracy is allowed for, up to 100 m) */
function checkAtGarden(pos) {
  const g = geoCfg(), dist = distanceMeters(g, pos);
  return { ok: dist <= (Number(g.radius) || 200) + Math.min(pos.acc || 0, 100), dist, acc: pos.acc };
}

/** start-of-shift flow with the location check; calls doClock(locInfo) */
function clockInWithLocation(doClock) {
  openModal('בדיקת מיקום', `<div class="geo-wait"><div class="geo-pin">📍</div><p>בודקים שאת בגן…</p><p class="small muted">אם הטלפון שואל – לאשר גישה למיקום.</p></div>`, null);
  currentPosition().then(pos => {
    const r = checkAtGarden(pos);
    if (r.ok) { closeModal(); return doClock({ ok: true, dist: r.dist }); }
    geoProblem(`נראה שאת לא בגן: המרחק מהגן הוא כ-${fmtDist(r.dist)}.`, r.dist, doClock);
  }).catch(e => geoProblem(e.message, null, doClock));
}

function geoProblem(msg, dist, doClock) {
  openModal('הכניסה לא אומתה', `
    <div class="notice" style="margin:0">${esc(msg)}</div>
    <button type="button" class="btn primary big block" data-act="clock">🔄 לנסות שוב</button>
    <details class="geo-anyway"><summary>אני בגן / יש סיבה אחרת – כניסה בכל זאת</summary>
      <p class="small muted">הכניסה תירשם ותסומן לבדיקת המנהלת.</p>
      ${fld('סיבה', '<input name="reason" placeholder="למשל: ליווי ילדים לטיול" maxlength="120">')}
      <button type="button" class="btn block" data-act="clockAnyway" data-dist="${dist == null ? '' : dist}">כניסה עם סימון לבדיקה</button>
    </details>`, null);
  window.__geoDoClock = doClock;
}

/* ---------- מיקום הגן לפי כתובת (OpenStreetMap) ---------- */
// Only the address the manager types is sent, to OpenStreetMap's free address search. Nothing about children or staff.
const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';
const osmEmbedUrl = (lat, lng) => {
  const d = 0.003;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lng - d},${lat - d},${lng + d},${lat + d}&layer=mapnik&marker=${lat},${lng}`;
};
let geoFound = [];
function findAddress() {
  const box = document.getElementById('geoAddress'), out = document.getElementById('geoResults');
  const q = (box && box.value || '').trim();
  if (q.length < 4) return toast('נא לכתוב כתובת: רחוב, מספר ועיר', true);
  out.innerHTML = '<p class="small muted">מחפשים…</p>';
  const url = `${GEOCODE_URL}?format=jsonv2&limit=4&countrycodes=il&accept-language=he&q=${encodeURIComponent(q)}`;
  fetch(url, { headers: { Accept: 'application/json' } })
    .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then(list => {
      geoFound = (list || []).map(x => ({ lat: Number(x.lat), lng: Number(x.lon), name: x.display_name })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng));
      out.innerHTML = geoFound.length
        ? `<p class="small muted" style="margin:6px 0">לבחור את הכתובת הנכונה:</p><div class="geo-found">${geoFound.map((x, i) => `<button type="button" class="btn block geo-pick" data-act="pickAddress" data-i="${i}">📍 ${esc(x.name)}</button>`).join('')}</div>`
        : '<p class="small warn-t">הכתובת לא נמצאה. כדאי לנסות בלי מספר דירה, או עם שם העיר המלא.</p>';
    })
    .catch(() => { out.innerHTML = '<p class="small warn-t">אין חיבור לשירות המפות כרגע. אפשר לנסות שוב, או לקבוע לפי המיקום בגן.</p>'; });
}
function pickAddress(i) {
  const x = geoFound[i];
  if (!x) return;
  const typed = (document.getElementById('geoAddress') || {}).value || '';
  db.settings.geo = Object.assign({}, geoCfg(), { lat: +x.lat.toFixed(6), lng: +x.lng.toFixed(6), enabled: true, address: typed.trim() || x.name, setBy: 'address' });
  logAction('עדכון מיקום הגן לפי כתובת: ' + (typed.trim() || x.name));
  commit('מיקום הגן נשמר לפי הכתובת. כדאי לבדוק במפה שהנקודה נכונה.');
}
