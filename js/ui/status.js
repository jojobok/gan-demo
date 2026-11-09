'use strict';
// Connection bar (shared mode only; the local mode works fully offline anyway).
// (classic script; see index.html for the load order)
// Shows, at the top of the screen:
//  - no internet: nothing can be saved until the connection returns (forms stay open)
//  - live updates disconnected: reconnecting; data reloads when back, so nothing is missed
//  - last data load failed: the reason and a "try again" button
function updateNetBar() {
  const bar = document.getElementById('netbar');
  if (!bar) return;
  let html = '', cls = '';
  if (REMOTE && me) {
    const st = Remote.state;
    if (!navigator.onLine) {
      cls = 'bad';
      html = '<b>אין חיבור לאינטרנט.</b> אפשר לצפות במה שכבר נטען. שינויים לא יישמרו עד שהחיבור יחזור.';
    } else if (st.lastError) {
      cls = 'bad';
      html = `<b>הנתונים לא עודכנו.</b> ${esc(st.lastError)} <button class="btn sm" data-act="retrySync">נסי שוב</button>`;
    } else if (st.liveLost) {
      cls = 'warn';
      html = 'העדכון החי מנותק – מתחבר מחדש…';
    }
  }
  bar.className = 'netbar ' + cls;
  bar.innerHTML = html;
  bar.hidden = !html;
  document.body.classList.toggle('has-netbar', !!html);
}

window.addEventListener('offline', updateNetBar);
window.addEventListener('online', () => {
  updateNetBar();
  if (REMOTE && me) Remote.reload().then(() => toast('החיבור חזר והנתונים עודכנו'));
});
