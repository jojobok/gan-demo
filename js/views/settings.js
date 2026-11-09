'use strict';
// Screen: settings and backup.
// (loaded as a classic script; see index.html for the load order)

/* ---------- הגדרות ---------- */
function viewSettings() {
  if (REMOTE) return viewRemoteSettings();
  const s = db.settings;
  return `${pageHead('הגדרות וגיבוי')}
  <div class="grid two" style="margin-top:0">
    <div class="card"><div class="card-head"><h3>פרטי הגן</h3></div>
      <form id="settingsForm" class="form-grid">
        ${fld('שם הגן', inp('gardenName', s.gardenName, 'text', 'required'), 'full')}
        ${fld('שם המנהלת', inp('managerName', s.managerName, 'text', 'required'))}
        ${fld('קוד כניסה למנהלת', inp('managerPin', s.managerPin, 'password', 'required inputmode="numeric" autocomplete="new-password"'))}
        <div class="full"><button class="btn primary">שמירה</button></div>
      </form></div>
    <div class="card"><div class="card-head"><h3>פרטי חשבון לתשלום</h3></div>
      <p class="small muted" style="margin-top:0">נשלחים להורים בוואטסאפ מכרטיס הילד.</p>
      <form id="bankForm" class="form-grid">
        ${fld('בנק', inp('bank', s.bank?.bank, 'text', 'required'))}${fld('סניף', inp('branch', s.bank?.branch, 'text', 'required inputmode="numeric"'))}
        ${fld('מספר חשבון', inp('account', s.bank?.account, 'text', 'required dir="ltr"'))}${fld('שם המוטב', inp('beneficiary', s.bank?.beneficiary, 'text', 'required'))}
        <div class="full"><button class="btn primary">שמירת פרטי החשבון</button></div>
      </form></div>
    <div class="card"><div class="card-head"><h3>גיבוי ושחזור</h3></div>
      <p class="small muted">הנתונים נשמרים בדפדפן הזה בלבד. מומלץ להוריד גיבוי באופן קבוע ולשמור אותו במקום בטוח (מחשב, דרייב, מייל).</p>
      <div class="actions"><button class="btn primary" data-act="backup">⬇ הורדת גיבוי</button>
        <label class="btn">⬆ שחזור מקובץ<input type="file" accept=".json,application/json" id="restoreFile" hidden></label>
        <button class="btn" data-act="restoreText">שחזור מטקסט</button></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <p class="small muted">איפוס: התחלה מחדש עם 4 הכיתות בלבד (ללא ילדים וצוות), או טעינת נתוני ההדגמה.</p>
      <div class="actions"><button class="btn danger" data-act="wipe">מחיקת כל הנתונים</button><button class="btn" data-act="loadDemo">טעינת נתוני הדגמה</button></div>
    </div>
  </div>`;
}

// Shared mode: no device data to back up/restore/wipe; passwords instead of codes.
function viewRemoteSettings() {
  const s = db.settings;
  return `${pageHead('הגדרות')}
  <div class="grid two" style="margin-top:0">
    <div class="card"><div class="card-head"><h3>פרטי הגן</h3></div>
      <form id="settingsForm" class="form-grid">
        ${fld('שם הגן', inp('gardenName', s.gardenName, 'text', 'required'), 'full')}
        ${fld('שם המנהלת', inp('managerName', s.managerName, 'text', 'required'), 'full')}
        <div class="full"><button class="btn primary">שמירה</button></div>
      </form></div>
    <div class="card"><div class="card-head"><h3>פרטי חשבון לתשלום</h3></div>
      <p class="small muted" style="margin-top:0">נשלחים להורים בוואטסאפ מכרטיס הילד.</p>
      <form id="bankForm" class="form-grid">
        ${fld('בנק', inp('bank', s.bank?.bank, 'text', 'required'))}${fld('סניף', inp('branch', s.bank?.branch, 'text', 'required inputmode="numeric"'))}
        ${fld('מספר חשבון', inp('account', s.bank?.account, 'text', 'required dir="ltr"'))}${fld('שם המוטב', inp('beneficiary', s.bank?.beneficiary, 'text', 'required'))}
        <div class="full"><button class="btn primary">שמירת פרטי החשבון</button></div>
      </form></div>
    <div class="card"><div class="card-head"><h3>חשבון וגיבוי</h3></div>
      <p class="small muted">הנתונים נשמרים בשרת המשותף, ומגובים שם. הורדת עותק לכאן מכילה מידע רגיש: יש לשמור אותו רק במקום מוגן.</p>
      <div class="actions"><button class="btn" data-act="changePassword">שינוי סיסמה</button><button class="btn" data-act="backup">⬇ הורדת עותק של הנתונים</button></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <p class="small muted">מעבר מהגרסה המקומית: ייבוא חד-פעמי של קובץ גיבוי שהורד ממנה. אפשרי רק במערכת חדשה, לפני שהוזנו ילדים ועובדות. קודי הכניסה הישנים לא מועברים.</p>
      <div class="actions"><button class="btn" data-act="importLocal">ייבוא מהגרסה המקומית</button></div>
    </div>
  </div>`;
}
