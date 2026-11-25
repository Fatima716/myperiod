'use strict';
/* My period — تطبيق تتبع الدورة. كل البيانات تُحفظ على الجهاز (localStorage). */

// رابط اختياري لملف JSON فيه مقالات ونصائح محدّثة: [{cat,title,meta,url}]
const ARTICLES_URL = '';

const PAIN_TYPES = ['تقلصات أسفل البطن','ألم الظهر','صداع','ألم الحوض','ألم الثديين','ألم المهبل','ألم أثناء التبول','ألم أثناء العلاقة','حرقان أو حكة','أخرى'];
const VAGINAL = ['ألم المهبل','ألم أثناء العلاقة','حرقان أو حكة','ألم أثناء التبول'];
const TIPS = [
  {cat:'نصائح',title:'كمادة دافئة على أسفل البطن تخفف التقلصات لدى كثيرات',meta:'نصيحة عامة'},
  {cat:'نصائح',title:'المشي الخفيف وشرب الماء يساعدان على تخفيف الانتفاخ',meta:'نصيحة عامة'},
  {cat:'تغذية',title:'أطعمة غنية بالحديد (عدس، سبانخ، لحم) تعوّض ما يُفقد مع الدورة',meta:'تغذية'},
  {cat:'تغذية',title:'تقليل الملح والكافيين قبل الدورة قد يخفف الانتفاخ وحدّة المزاج',meta:'تغذية'},
  {cat:'صحة',title:'ألم المهبل أو الحرقان المستمر أو الإفراز كريه الرائحة سبب لمراجعة الطبيبة',meta:'متى تراجعين الطبيبة'},
  {cat:'صحة',title:'نزيف يغمر أكثر من فوطة في الساعة لعدة ساعات يستدعي مراجعة طبية',meta:'متى تراجعين الطبيبة'},
  {cat:'صحة',title:'الإفرازات الشفافة المطاطية تدل غالباً على قرب الإباضة',meta:'فهم الإفرازات'}
];
const DEF = () => ({starts:[],logs:{},cycleLen:28,periodLen:5,height:'',weights:[],
  ends:{},pdays:null,noBleed:{},habit:{since:null,history:[],start:null,events:null},fast:{total:0,done:0},
  settings:{lock:false,pin:'',dark:false,hijri:true,before:true,fertile:true,daily:true,meds:false},updatedAt:0});

let S;
try { S = Object.assign(DEF(), JSON.parse(localStorage.getItem('myperiod') || '{}')); } catch (e) { S = DEF(); }
function fix() {
  S.settings = Object.assign(DEF().settings, S.settings);
  S.noBleed = S.noBleed || {};
  const H = S.habit = Object.assign({since:null,history:[],start:null,events:null}, S.habit);
  if (!H.events) {
    H.events = (H.history || []).map((x, i) => ({id: i + 1, d: x.to, type: 'ممارسة', trig: [], note: '(من النسخة السابقة)'}));
    if (!(H.history || []).length && H.since) H.start = H.since;
  }
  if (!Array.isArray(S.pdays)) {
    // ترحيل: تحويل البدايات والنهايات القديمة إلى أيام نزيف فردية
    S.pdays = [];
    const e = S.ends || {}, t = today();
    (S.starts || []).forEach(x => { const n = e[x] ? diff(e[x], x) + 1 : S.periodLen; for (let k = 0; k < n; k++) { const d = add(x, k); if (d <= t) S.pdays.push(d); } });
    S.pdays = [...new Set(S.pdays)].sort();
  }
  rebuild();
}
const hasNative = () => typeof Android !== 'undefined';
let afterT = null;
function save(noSync) {
  rebuild();
  if (!noSync) S.updatedAt = Date.now();
  try { localStorage.setItem('myperiod', JSON.stringify(S)); } catch (e) {}
  if (noSync) return;
  clearTimeout(afterT);
  afterT = setTimeout(() => { syncReminders(); cloudUp(); }, 1500);
}

/* ---------- التذكيرات (تُجدول في أندرويد) ---------- */
function buildReminders() {
  const s = S.settings, out = [], now = Date.now();
  const at = (d, h, m) => { const [y, mo, da] = d.split('-').map(Number); return new Date(y, mo - 1, da, h, m).getTime(); };
  const t = today();
  const push = (id, ms, title, text) => { if (ms > now) out.push({id, at: ms, title, text}); };
  if (s.daily) for (let k = 0; k < 14; k++) { const d = add(t, k); if (k === 0 && S.logs[t]) continue; push(1000 + k, at(d, 21, 0), 'My period', 'لا تنسي تسجيل أعراض اليوم'); }
  if (s.meds) for (let k = 0; k < 14; k++) push(4000 + k, at(add(t, k), 8, 0), 'My period', 'تذكير الدواء');
  const c = cyc();
  if (c.last) for (let k = 1; k <= 3; k++) {
    const ns = add(c.last, c.avg * k);
    if (s.before) push(2000 + k, at(add(ns, -2), 9, 0), 'My period', 'دورتك متوقعة خلال يومين');
    if (s.fertile) push(3000 + k, at(add(ns, -19), 9, 0), 'My period', 'بدأت فترة الخصوبة المتوقعة');
  }
  return out;
}
function syncReminders() { if (hasNative() && Android.schedule) { try { Android.schedule(JSON.stringify(buildReminders())); } catch (e) {} } }

/* ---------- المزامنة السحابية (Firebase) ---------- */
function cloudPayload() { const c = JSON.parse(JSON.stringify(S)); c.settings.pin = ''; c.settings.lock = false; return JSON.stringify(c); }
function cloudUp() { if (hasNative() && Android.user && Android.user()) { try { Android.syncUp(cloudPayload(), S.updatedAt || 0); } catch (e) {} } }
window.onAuth = email => { ui.email = email; toast('تم تسجيل الدخول'); render(); };
window.onAuthError = msg => toast(msg);
window.onCloud = (json, ts) => {
  try {
    if (json && ts > (S.updatedAt || 0)) {
      const c = JSON.parse(json), keep = S.settings;
      S = Object.assign(DEF(), c);
      S.settings = Object.assign(DEF().settings, c.settings, {lock: keep.lock, pin: keep.pin}); fix();
      S.updatedAt = ts; save(true); render(); toast('تمت مزامنة بياناتك');
    } else cloudUp();
  } catch (e) {}
};

/* ---------- تواريخ ---------- */
const pad = n => String(n).padStart(2, '0');
const fmt = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const parse = s => { const [a, b, c] = s.split('-').map(Number); return new Date(a, b - 1, c); };
const add = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return fmt(d); };
const diff = (a, b) => Math.round((parse(a) - parse(b)) / 864e5);
const today = () => fmt(new Date());
const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
const DOW = ['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
const longDate = s => { const d = parse(s); return DOW[d.getDay()] + '، ' + d.getDate() + ' ' + MONTHS[d.getMonth()]; };
const hijri = () => { try { return new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {day:'numeric',month:'long',year:'numeric'}).format(new Date()); } catch (e) { return ''; } };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const avgOf = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;

/* ---------- حساب الدورة ---------- */
function cyc() {
  const st = [...S.starts].sort();
  const gaps = [];
  for (let i = 1; i < st.length; i++) gaps.push(diff(st[i], st[i - 1]));
  const ok = gaps.filter(x => x >= 18 && x <= 50);
  const avg = ok.length ? Math.round(avgOf(ok)) : S.cycleLen;
  return { st, gaps, avg, last: st[st.length - 1] || null };
}
function info() {
  const c = cyc(); if (!c.last) return null;
  const t = today();
  const day = diff(t, c.last) + 1;
  const next = add(c.last, c.avg);
  const ovu = add(next, -14);
  return { ...c, t, day, next, ovu, toNext: diff(next, t), toOvu: diff(ovu, t) };
}
function dayType(d) {
  if (S.pdays.includes(d)) return 'period';
  const c = cyc(), ps = periods(), lp = ps[ps.length - 1];
  if (lp && lp.open && diff(d, lp.end) > 0 && diff(d, lp.start) < plen()) return 'pred';
  if (c.last) {
    for (let k = 1; k <= 8; k++) {
      const ns = add(c.last, c.avg * k);
      const k1 = diff(d, ns); if (k1 >= 0 && k1 < plen()) return 'pred';
      const k2 = diff(d, add(ns, -14)); if (k2 >= -5 && k2 <= 0) return 'fertile';
    }
  }
  return '';
}
function cycleDayOf(d) {
  const c = cyc(); let s = null;
  for (const x of c.st) if (x <= d) s = x;
  return s ? diff(d, s) + 1 : null;
}
function periods() {
  const pd = [...new Set(S.pdays)].sort(), out = [], t = today();
  for (const d of pd) { const l = out[out.length - 1]; if (l && diff(d, l.end) <= 3) { l.end = d; l.days++; } else out.push({start: d, end: d, days: 1}); }
  out.forEach(p => { p.open = diff(t, p.end) <= 1; });
  return out;
}
function rebuild() {
  const ps = periods();
  S.starts = ps.map(p => p.start);
  S.ends = {}; ps.forEach(p => { if (!p.open) S.ends[p.start] = p.end; });
}
function plens() { return periods().filter(p => !p.open && p.days >= 1 && p.days <= 14).map(p => p.days); }
function plen() { const o = plens(); return o.length ? Math.round(avgOf(o)) : S.periodLen; }
const dw = n => n === 1 ? 'يوم' : n === 2 ? 'يومين' : n <= 10 ? n + ' أيام' : n + ' يومًا';
const bw = n => n === 1 ? 'بيوم واحد' : n === 2 ? 'بيومين' : 'بـ ' + dw(n);
const devText = d => d === 0 ? 'جاءت في موعدها المتوقع تماماً' : d < 0 ? 'جاءت أبكر ' + bw(-d) : 'تأخرت ' + (d === 1 ? 'يوماً واحداً' : dw(d));
function devs() {
  const st = cyc().st, out = [], pm = {};
  periods().forEach(p => pm[p.start] = p);
  for (let i = 1; i < st.length; i++) {
    const gaps = []; for (let j = 1; j < i; j++) gaps.push(diff(st[j], st[j - 1]));
    const ok = gaps.filter(x => x >= 18 && x <= 50);
    const avg = ok.length ? Math.round(avgOf(ok)) : S.cycleLen;
    const pred = add(st[i - 1], avg);
    out.push({start: st[i], predicted: pred, dev: diff(st[i], pred), gap: diff(st[i], st[i - 1]), len: pm[st[i]] && !pm[st[i]].open ? pm[st[i]].days : null});
  }
  return out;
}
function addPday(d) {
  if (!d || d > today()) { toast('تاريخ غير صالح'); return false; }
  if (S.pdays.includes(d)) return true;
  const ps = periods(), lp = ps[ps.length - 1], c = cyc();
  const pred = lp && d > lp.end && diff(d, lp.end) > 3 && c.last ? add(c.last, c.avg) : null;
  S.pdays.push(d); S.pdays.sort(); save();
  const dv = pred ? diff(d, pred) : 0;
  ui.msg = pred ? devText(dv) + (dv === 0 ? ' (' : ' عن التوقع (') + longDate(pred) + '). تم تحديث توقعاتك.' : '';
  return true;
}
function removePday(d) { S.pdays = S.pdays.filter(x => x !== d); save(); }
function addRange(a, n) {
  if (!addPday(a)) return;
  for (let k = 1; k < n; k++) { const d = add(a, k); if (d <= today() && !S.pdays.includes(d)) S.pdays.push(d); }
  S.pdays.sort(); save();
}
const lenMsg = (len, usual) => 'استمرت دورتك ' + dw(len) + (len === usual ? '، وهذا المعتاد.' : len > usual ? '، أطول من المعتاد ' + bw(len - usual) + '.' : '، أقصر من المعتاد ' + bw(usual - len) + '.');
function logSummary(l) {
  const p = [], pn = l.pain || {};
  if (l.bleeding && l.bleeding !== 'لا يوجد') p.push('نزيف ' + l.bleeding);
  if (l.discharge && l.discharge !== 'لا يوجد') p.push('إفرازات ' + l.discharge);
  if ((l.symptoms || []).length) p.push(l.symptoms.join('، '));
  if (pn.level > 0 || (pn.types || []).length) p.push('ألم ' + (pn.level || 0) + '/10' + ((pn.types || []).length ? ' (' + pn.types.join('، ') + ')' : ''));
  if (l.mood) p.push('مزاج ' + l.mood);
  if (l.sleep) p.push('نوم ' + l.sleep);
  if (l.stress) p.push('توتر ' + l.stress);
  if (l.note) p.push('«' + l.note + '»');
  return p.join(' · ');
}

/* ---------- حالة الواجهة ---------- */
let route = 'today';
let draft = null;
let ui = { month: new Date().getMonth(), year: new Date().getFullYear(), sel: today(), tab: 'sum', cat: 'الكل', n: 6, articles: null, fetched: false, logDate: today(), back: '', msg: '', snooze: '', snoozeEnd: '' };
const blankLog = () => ({bleeding:'',discharge:'',symptoms:[],mood:'',sleep:'',stress:'',note:'',pain:{types:[],level:0,triggers:[],helped:[]}});
function ensureDraft() {
  if (!draft) {
    const old = S.logs[ui.logDate];
    draft = old ? JSON.parse(JSON.stringify(Object.assign(blankLog(), old, {pain: Object.assign(blankLog().pain, old.pain || {})}))) : blankLog();
  }
}
const nextEvId = () => Math.max(0, ...S.habit.events.map(x => x.id || 0)) + 1;
function ensureHDraft() { if (!draft || !draft.h) draft = {h: {id: 0, d: today(), type: '', trig: [], note: ''}}; }
const getp = p => p.split('.').reduce((a, k) => a[k], draft);
const setp = (p, v) => { const k = p.split('.'); const last = k.pop(); k.reduce((a, x) => a[x], draft)[last] = v; };

/* ---------- عناصر مساعدة ---------- */
const chev = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color:var(--mut)"><path d="M15 5l-7 7 7 7"/></svg>';
const head = (sub, title) => `<div class="head"><small>${sub}</small><h1>${title}</h1></div>`;
const chips = (path, opts, multi) => {
  const cur = getp(path);
  return '<div class="chips">' + opts.map(o => {
    const on = multi ? cur.indexOf(o) >= 0 : cur === o;
    return `<button class="chip ${on ? 'on' : ''}" data-act="chip" data-k="${path}" data-v="${esc(o)}" data-m="${multi ? 1 : 0}" aria-pressed="${on}">${esc(o)}</button>`;
  }).join('') + '</div>';
};
const toggle = (key, on) => `<button class="sw ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-act="sw" data-k="${key}"><i></i></button>`;
const linkBtn = (to, t, s) => `<button class="link" data-act="go" data-to="${to}"><span><b>${t}</b><span>${s}</span></span>${chev}</button>`;
function toast(m) { const t = document.getElementById('toast'); t.textContent = m; t.className = 'show'; clearTimeout(toast.h); toast.h = setTimeout(() => t.className = '', 2400); }
function shareText(t) { if (window.Android && Android.share) Android.share(t); else if (navigator.share) navigator.share({text: t}); else { try { navigator.clipboard.writeText(t); toast('تم النسخ'); } catch (e) {} } }

const ICON = {
  today: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  log: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  insights: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'
};
const NAME = {today:'اليوم',calendar:'التقويم',log:'تسجيل',insights:'تحليلات',more:'المزيد'};
const TABOF = {records:'more',pain:'log',body:'more',habit:'more',worship:'more',discover:'more',report:'more',account:'more',settings:'more'};
const nav = () => {
  const cur = TABOF[route] || route;
  return '<nav aria-label="التنقل">' + Object.keys(NAME).map(k =>
    `<button class="${k === cur ? 'on' : ''}" data-act="go" data-to="${k}" ${k === cur ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>${NAME[k]}</button>`).join('') + '</nav>';
};

/* ---------- الشاشات ---------- */
const V = {};

V.today = () => {
  const i = info(); const t = today();
  const hj = S.settings.hijri ? ' · ' + hijri() : '';
  let h = head(longDate(t) + hj, 'مرحباً بك');
  if (!i) {
    return h + `<div class="body"><div class="card" style="align-items:center;text-align:center"><svg class="flower" viewBox="0 0 108 108" aria-hidden="true">${flowerSvg()}</svg><h2>ابدئي بتسجيل دورتك</h2><span class="mut">سجّلي أول يوم من آخر دورة لتبدأ التوقعات. كلما سجّلتِ أكثر أصبحت أدق.</span></div>
      <button class="btn" data-act="startPeriod">بدأت دورتي اليوم</button>
      <div class="sec"><label for="ls">أو اختاري تاريخ بدء آخر دورة</label><input id="ls" type="date" max="${t}" data-in="lastStart"></div>
      <span class="mut" style="text-align:center">التوقعات تقديرية، وليست وسيلة لمنع الحمل</span></div>` + nav();
  }
  const T = Math.max(i.avg, i.day), C = 691.15;
  const fr = x => (x / T) * C;
  const pa = fr(plen()), fs = Math.max(0, i.avg - 14 - 5), fl = fr(6);
  const ang = (Math.min(i.day, T) - 0.5) / T * 2 * Math.PI - Math.PI / 2;
  const mx = 130 + 110 * Math.cos(ang), my = 130 + 110 * Math.sin(ang);
  const type = dayType(t);
  let msg = 'فترة هادئة', cls = 'pill';
  if (type === 'period') { msg = 'أيام الدورة'; cls = 'pill pk'; }
  else if (type === 'fertile') msg = 'فرصة الحمل مرتفعة';
  const late = i.toNext < 0;
  let ask = '';
  if (ui.msg) ask += `<div class="note tl" style="width:100%"><span>${esc(ui.msg)}</span><br><button class="chip" style="margin-top:8px" data-act="dismissMsg">حسناً</button></div>`;
  const ps = periods(), lp = ps[ps.length - 1];
  if (i.toNext <= 0 && !S.pdays.includes(t) && ui.snooze !== t) ask += `<div class="card" style="width:100%"><h2>هل جاءتك الدورة؟</h2><span class="mut">كانت متوقعة ${i.toNext === 0 ? 'اليوم' : 'منذ ' + dw(-i.toNext)}. إجابتك تجعل التوقعات أدق.</span><button class="btn" data-act="startPeriod">نعم، اليوم أول يوم</button><label for="sb">أو بدأت في يوم سابق</label><input id="sb" type="date" max="${t}" data-in="lastStart"><button class="chip" data-act="snooze">لم تأتِ بعد</button></div>`;
  if (lp && lp.open && diff(t, lp.end) === 1 && !S.noBleed[t] && !(S.logs[t] && S.logs[t].bleeding)) ask += `<div class="card" style="width:100%"><h2>هل ما زال النزيف مستمراً اليوم؟</h2><span class="mut">سجّلتِ ${dw(lp.days)} من النزيف حتى الآن. كل يوم يُحسب وحده.</span><button class="btn" data-act="stillBleeding">نعم، ما زال مستمراً</button><button class="chip" data-act="endToday">لا، انتهت دورتي</button></div>`;
  return h + `<div class="body" style="align-items:center">${ask}
    <div style="position:relative;width:260px;height:260px"><svg width="260" height="260" viewBox="0 0 260 260" role="img" aria-label="اليوم ${i.day} من الدورة">
      <g transform="rotate(-90 130 130)" fill="none" stroke-width="18">
      <circle cx="130" cy="130" r="110" stroke="var(--line)"/>
      <circle cx="130" cy="130" r="110" stroke="#C23A62" stroke-dasharray="${pa} ${C}"/>
      <circle cx="130" cy="130" r="110" stroke="#17727A" stroke-dasharray="${fl} ${C}" stroke-dashoffset="${-fr(fs)}"/></g>
      <circle cx="${mx}" cy="${my}" r="11" fill="#fff" stroke="#2B1B2E" stroke-width="4"/></svg>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center"><span class="mut">اليوم</span><span style="font-size:64px;font-weight:800;line-height:1">${i.day}</span><span class="mut">من دورتك</span></div></div>
    <span class="${cls}">${msg}</span>
    <div class="row" style="width:100%">
      <div class="card"><span class="mut">الدورة القادمة</span><span class="big pink" style="font-size:20px">${late ? 'متأخرة ' + (-i.toNext) + ' يوم' : 'بعد ' + i.toNext + ' يوم'}</span><span class="mut">${longDate(i.next)}</span></div>
      <div class="card"><span class="mut">الإباضة المتوقعة</span><span class="big teal" style="font-size:20px">${i.toOvu === 0 ? 'اليوم' : i.toOvu > 0 ? 'بعد ' + i.toOvu + ' يوم' : 'مضت'}</span><span class="mut">${longDate(i.ovu)}</span></div>
    </div>
    <button class="btn" style="width:100%" data-act="go" data-to="log">سجّلي أعراض اليوم</button>
    <button class="btn ghost" style="width:100%" data-act="startPeriod">بدأت دورتي اليوم</button>
    <span class="mut" style="text-align:center">التوقعات تقديرية، وليست وسيلة لمنع الحمل</span></div>` + nav();
};

V.calendar = () => {
  const y = ui.year, m = ui.month;
  const first = new Date(y, m, 1).getDay(), n = new Date(y, m + 1, 0).getDate();
  const t = today();
  let cells = DOW.map(d => `<div class="h">${d}</div>`).join('');
  for (let k = 0; k < first; k++) cells += '<div class="e"></div>';
  for (let d = 1; d <= n; d++) {
    const ds = y + '-' + pad(m + 1) + '-' + pad(d);
    cells += `<button class="${dayType(ds)} ${ds === ui.sel ? 'sel' : ''} ${ds === t ? 'tod' : ''}" data-act="pick" data-d="${ds}" aria-label="${d} ${MONTHS[m]}">${d}</button>`;
  }
  const ty = dayType(ui.sel), cd = cycleDayOf(ui.sel), lg = S.logs[ui.sel];
  let title = ty === 'period' ? 'أيام الدورة' : ty === 'pred' ? 'دورة متوقعة' : ty === 'fertile' ? 'فترة الخصوبة' : 'يوم عادي';
  const sm = lg ? logSummary(lg) : '';
  const body = lg ? (sm || 'سجل بدون تفاصيل') : 'لا توجد أعراض مسجّلة لهذا اليوم.';
  const isP = S.pdays.includes(ui.sel);
  const past = ui.sel <= t;
  return head(y, MONTHS[m]) + `<div class="body">
    <div class="sp"><button class="chip" data-act="mon" data-n="-1" aria-label="الشهر السابق">السابق</button><button class="chip" data-act="mon" data-n="1" aria-label="الشهر التالي">التالي</button></div>
    <div class="card"><div class="cal">${cells}</div></div>
    <div class="sp mut" style="justify-content:center;gap:16px"><span>● أيام الدورة</span><span class="pink">● متوقعة</span><span class="teal">● الخصوبة</span></div>
    <div class="card"><span class="mut">${longDate(ui.sel)}${cd ? ' · اليوم ' + cd + ' من الدورة' : ''}</span><b style="font-size:18px">${title}</b><span class="mut">${esc(body)}</span>
      ${past ? `<button class="chip" data-act="editLog" data-d="${ui.sel}">${lg ? 'عرض وتعديل سجل هذا اليوم' : 'تسجيل أعراض هذا اليوم'}</button>` : ''}
      ${isP ? `<button class="chip" data-act="unmark" data-d="${ui.sel}">إزالة هذا اليوم من أيام الدورة</button>` : past ? `<button class="chip" data-act="mark" data-d="${ui.sel}">هذا اليوم من أيام دورتي</button>` : ''}</div>
  </div>` + nav();
};

V.log = () => {
  ensureDraft();
  const g = (t, p, o, m) => `<div class="sec"><h2>${t}</h2>${chips(p, o, m)}</div>`;
  return head(longDate(ui.logDate), ui.logDate === today() ? 'كيف تشعرين اليوم؟' : 'سجل يوم سابق') + `<div class="body">
    <div class="sec"><label for="ld">تاريخ السجل</label><input id="ld" type="date" max="${today()}" value="${ui.logDate}" data-in="logDate"></div>
    ${g('النزيف', 'bleeding', ['لا يوجد','خفيف','متوسط','غزير'])}
    <span class="mut" style="margin-top:-6px">تحديد كمية نزيف يضيف هذا اليوم إلى أيام دورتك، وكل يوم مستقل عن غيره.</span>
    ${g('الإفرازات', 'discharge', ['لا يوجد','قليلة','كريمية','مائية','شفافة مطاطية'])}
    ${g('الأعراض', 'symptoms', ['تقلصات','صداع','انتفاخ','ألم الظهر','إرهاق','حب الشباب'], true)}
    ${g('المزاج', 'mood', ['هادئة','سعيدة','قلقة','حزينة','عصبية'])}
    ${g('النوم', 'sleep', ['جيد','متوسط','سيئ'])}
    ${g('التوتر', 'stress', ['منخفض','متوسط','مرتفع'])}
    ${linkBtn('pain', 'الألم', 'النوع والمستوى والمحفزات')}
    <div class="sec"><label for="nt">ملاحظات وتجاربي</label><textarea id="nt" rows="3" placeholder="اكتبي أي شيء لاحظتِه اليوم…" data-in="note">${esc(draft.note)}</textarea></div>
    <button class="btn" data-act="saveLog">حفظ</button></div>` + nav();
};

V.pain = () => {
  ensureDraft();
  const lv = draft.pain.level;
  const ttl = lv === 0 ? ['لا ألم','لا تشعرين بألم.'] : lv <= 3 ? ['ألم خفيف','محتمل ولا يمنعك من أنشطتك.'] : lv <= 6 ? ['ألم متوسط','واضح وقد يحتاج إلى راحة.'] : lv <= 8 ? ['ألم شديد','يصعّب أنشطتك. إن تكرر كل دورة فاذكريه لطبيبتك.'] : ['ألم شديد جداً','إن كان لا يُحتمل أو جديداً عليك فراجعي طبيبة.'];
  const vag = draft.pain.types.some(t => VAGINAL.indexOf(t) >= 0);
  const lvl = Array.from({length: 11}, (_, n) => `<button class="chip ${n === lv ? 'on' : ''}" style="padding:0" data-act="lvl" data-n="${n}" aria-pressed="${n === lv}" aria-label="مستوى الألم ${n}">${n}</button>`).join('');
  return head(longDate(ui.logDate), 'الألم') + `<div class="body">
    <div class="sec"><h2>نوع الألم ومكانه</h2>${chips('pain.types', PAIN_TYPES, true)}</div>
    ${vag ? '<div class="note">إن استمر ألم المهبل أو الحرقان أو صاحبه إفراز كريه الرائحة أو حمى أو نزيف غير معتاد، فراجعي طبيبة. هذا التطبيق لا يشخّص.</div>' : ''}
    <div class="sec"><h2>مستوى الألم من 0 إلى 10</h2><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:8px">${lvl}</div>
      <div class="note"><b>${ttl[0]} (${lv} من 10)</b><br>${ttl[1]}</div></div>
    <div class="sec"><h2>ما الذي سبق الألم؟</h2>${chips('pain.triggers', ['قلة النوم','قهوة','توتر','أكل مالح','قلة الماء'], true)}</div>
    <div class="sec"><h2>ما الذي خفّفه؟</h2>${chips('pain.helped', ['كمادة دافئة','مسكّن','مشي خفيف','راحة','شاي أعشاب'], true)}</div>
    <button class="btn" data-act="saveLog">حفظ</button></div>` + nav();
};

function stats() {
  const c = cyc();
  const logs = Object.entries(S.logs);
  const cycles = [];
  for (let i = 0; i < c.st.length; i++) {
    const a = c.st[i], b = c.st[i + 1] || add(a, 60);
    cycles.push(logs.filter(([d]) => d >= a && d < b).map(([, l]) => l));
  }
  return { c, logs, cycles };
}

V.insights = () => {
  const { c, logs, cycles } = stats();
  let b = '';
  if (ui.tab === 'sum') {
    const gaps = c.gaps.slice(-6);
    const mx = Math.max(35, ...gaps);
    const spread = gaps.length > 1 ? Math.max(...gaps) - Math.min(...gaps) : null;
    const reg = spread === null ? 'تحتاجين دورتين مسجّلتين على الأقل لحساب الانتظام.' : spread <= 7 ? 'دورتك منتظمة (الفرق بين أقصر وأطول دورة ' + dw(spread) + ').' : 'دورتك متفاوتة (الفرق بين أقصر وأطول دورة ' + dw(spread) + ').';
    const inf = info();
    const dv = devs().slice(-6).reverse();
    b = `<div class="row"><div class="card"><span class="mut">متوسط الدورة</span><span class="big pink">${c.avg} <small class="mut">يومًا</small></span></div>
      <div class="card"><span class="mut">مدة النزيف</span><span class="big teal">${plen()} <small class="mut">أيام</small></span></div></div>
      <div class="card"><h2>طول آخر الدورات (أيام)</h2>${gaps.length ? `<div class="bars">${gaps.map(g => `<div>${g}<i style="height:${Math.round(g / mx * 100)}px"></i></div>`).join('')}</div>` : '<span class="mut">تحتاجين تسجيل دورتين على الأقل لرؤية الرسم.</span>'}</div>
      <div class="card"><h2>الانتظام والتوقع</h2><span class="mut">${reg}</span>${inf ? `<b>الدورة القادمة المتوقعة: ${longDate(inf.next)}${spread !== null ? ' (قد تختلف ±' + Math.max(1, Math.round(spread / 2)) + ' يوم)' : ''}</b>` : ''}</div>
      <div class="card"><h2>التوقع مقابل الواقع</h2>${dv.length ? dv.map(x => `<div class="sp"><span>${longDate(x.start)}</span><span class="pill ${x.dev === 0 ? '' : 'pk'}">${devText(x.dev)}${x.len ? ' · نزيف ' + dw(x.len) : ''}</span></div>`).join('') : '<span class="mut">سجّلي دورتين على الأقل، وبعد كل دورة سأقارن موعدها الفعلي بالتوقع.</span>'}</div>
      ${linkBtn('report', 'تقرير الطبيبة', 'ملخص للمشاركة')}${linkBtn('body', 'كتلة الجسم', 'الوزن والطول')}`;
  } else {
    const symC = {}, nCycWith = cycles.filter(x => x.length).length;
    cycles.forEach(ls => { const seen = new Set(); ls.forEach(l => (l.symptoms || []).forEach(s => seen.add(s)));
      ls.forEach(l => ((l.pain || {}).types || []).forEach(s => seen.add(s))); seen.forEach(s => symC[s] = (symC[s] || 0) + 1); });
    const pats = Object.entries(symC).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const byDay = {};
    logs.forEach(([d, l]) => { const k = cycleDayOf(d); const lv = (l.pain || {}).level; if (k && k <= 28 && lv > 0) (byDay[k] = byDay[k] || []).push(lv); });
    let heat = ''; for (let k = 1; k <= 28; k++) { const a = byDay[k] ? avgOf(byDay[k]) : 0; heat += `<div class="${a > 6 ? 'l3' : a > 3 ? 'l2' : a > 0 ? 'l1' : ''}">${k}</div>`; }
    const trg = {}, hlp = {};
    logs.forEach(([, l]) => { const p = l.pain || {}; (p.triggers || []).forEach(x => trg[x] = (trg[x] || 0) + 1); (p.helped || []).forEach(x => hlp[x] = (hlp[x] || 0) + 1); });
    const top = o => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 4);
    b = `<div class="card"><h2>أنماط تتكرر معك</h2>${pats.length ? pats.map(([s, n]) => `<div class="sec"><div class="sp"><b>${esc(s)}</b><span class="mut">${n} من ${nCycWith} دورات</span></div><div class="meter"><i style="width:${Math.round(n / Math.max(1, nCycWith) * 100)}%"></i></div></div>`).join('') : '<span class="mut">سجّلي أعراضك يومياً خلال دورة أو دورتين لتظهر الأنماط هنا.</span>'}</div>
      <div class="card"><h2>الألم حسب يوم الدورة</h2><div class="heat">${heat}</div><span class="mut">الأغمق = ألم أشد</span></div>
      <div class="card"><h2>ما الذي ينفع معك</h2>${top(hlp).length ? top(hlp).map(([k, n]) => `<div class="sp"><b>${esc(k)}</b><span class="mut">${n} مرات</span></div>`).join('') : '<span class="mut">لا بيانات بعد.</span>'}</div>
      <div class="card"><h2>محفزات الألم الأكثر تكراراً</h2>${top(trg).length ? '<div class="chips">' + top(trg).map(([k, n]) => `<span class="pill pk">${esc(k)} · ${n}</span>`).join('') + '</div>' : '<span class="mut">لا بيانات بعد.</span>'}</div>`;
  }
  return head('تحليلات من بياناتك', 'تحليلاتك') + `<div class="tabs"><button class="${ui.tab === 'sum' ? 'on' : ''}" data-act="tab" data-t="sum">ملخص</button><button class="${ui.tab === 'pat' ? 'on' : ''}" data-act="tab" data-t="pat">الأنماط</button></div><div class="body">${b}</div>` + nav();
};

V.more = () => head('كل ما تحتاجينه', 'المزيد') + `<div class="body">
  ${linkBtn('discover', 'اكتشفي', 'نصائح ومقالات')}${linkBtn('body', 'كتلة الجسم', 'الطول والوزن')}
  ${linkBtn('habit', 'تحدّيي', 'خاص ومحمي بالرقم السري')}${linkBtn('worship', 'الصيام والصلاة', 'قضاء أيام رمضان وأيام الانقطاع')}
  ${linkBtn('report', 'تقرير الطبيبة', 'ملخص للمشاركة')}${linkBtn('account', 'الحساب والخصوصية', 'قفل ونسخة احتياطية ومزامنة')}
  ${linkBtn('records', 'سجلاتي وبياناتي القديمة', 'عرض وتعديل وإضافة بيانات سابقة')}${linkBtn('settings', 'الإعدادات', 'المظهر والدورة')}</div>` + nav();

V.body = () => {
  const w = S.weights[S.weights.length - 1];
  const r = bmiOf(S.height, w ? w.w : '');
  return head('الجسم', 'كتلة الجسم') + `<div class="body">
    <div class="row"><div class="sec"><label for="h">الطول (سم)</label><input id="h" inputmode="decimal" value="${esc(S.height)}" data-in="height"></div>
    <div class="sec"><label for="w">الوزن (كغ)</label><input id="w" inputmode="decimal" value="${w ? esc(w.w) : ''}" data-in="weight"></div></div>
    <div class="sec"><label for="wd">تاريخ القياس</label><input id="wd" type="date" max="${today()}" value="${today()}"></div>
    <div class="card"><div class="sp"><span class="big pink" style="font-size:44px" id="bmiV">${r.v}</span><span class="pill" id="bmiC">${r.c}</span></div>
      <div class="bmi"><div class="bar"><div style="flex:17.5;background:var(--tealbg)"></div><div style="flex:32.5;background:var(--teal)"></div><div style="flex:25;background:#F2C9A0"></div><div style="flex:25;background:var(--pink)"></div></div><div class="pin" id="bmiP" style="right:${r.p}%"></div></div>
      <div class="sp mut"><span>نحافة</span><span>طبيعي</span><span>زيادة</span><span>سمنة</span></div>
      <span class="mut">المؤشر تقريبي ولا يصلح وحده للحكم على صحتك. اسألي طبيبتك عن الوزن المناسب.</span></div>
    ${S.weights.length ? `<div class="card"><h2>آخر قياسات الوزن (كغ)</h2><div class="sp mut" style="flex-wrap:wrap;justify-content:flex-start">${S.weights.slice(-6).map(x => `<span class="pill">${esc(x.w)} · ${esc(x.d.slice(5))}</span>`).join('')}</div></div>` : ''}
    <button class="btn" data-act="saveBody">حفظ القياس</button></div>` + nav();
};
function bmiOf(h, w) {
  h = parseFloat(h); w = parseFloat(w);
  if (!(h > 0 && w > 0)) return { v: '—', c: 'أدخلي الطول والوزن', p: 0 };
  const v = w / ((h / 100) * (h / 100));
  return { v: v.toFixed(1), c: v < 18.5 ? 'نحافة' : v < 25 ? 'وزن طبيعي' : v < 30 ? 'زيادة وزن' : 'سمنة', p: Math.max(0, Math.min(1, (v - 15) / 20)) * 100 };
}

const HT = ['ممارسة','تفكير أو رغبة','محاولة إيقاف','تغلّبت على الرغبة','أخرى'];
const HP = 'ممارسة';
const HTRIG = ['ملل','وحدة','توتر','ليلاً','محتوى مثير','أخرى'];
function habitStats() {
  const H = S.habit, t = today();
  const P = [...new Set(H.events.filter(e => e.type === HP).map(e => e.d))].sort();
  const pts = (H.start ? [H.start] : []).concat(P).sort();
  const gaps = []; for (let i = 1; i < pts.length; i++) if (diff(pts[i], pts[i - 1]) > 0) gaps.push(diff(pts[i], pts[i - 1]));
  const last = pts[pts.length - 1] || null;
  return { P, gaps, last, days: last ? diff(t, last) : 0, started: !!last };
}
V.habit = () => {
  ensureHDraft();
  const H = S.habit, t = today(), st = habitStats(), f = draft.h;
  const recent = k => H.events.filter(e => e.type === k && diff(t, e.d) <= 29).length;
  const best = Math.max(st.days, ...st.gaps, 0), avg = st.gaps.length ? Math.round(avgOf(st.gaps)) : 0;
  const msg = st.days === 0 ? 'بداية جديدة تُحسب لك. المهم أن تعودي للمحاولة.' : st.days < 7 ? 'بداية جيدة، استمرّي.' : st.days >= 30 ? 'وصلتِ إلى هدفك. أحسنتِ!' : 'كل يوم تتغلّبين فيه هو إنجاز حقيقي.';
  const trg = {}; H.events.filter(e => e.type === HP).forEach(e => (e.trig || []).forEach(x => trg[x] = (trg[x] || 0) + 1));
  const topT = Object.entries(trg).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const top = st.started
    ? `<div class="card" style="background:var(--teal);border-color:var(--teal);color:#fff"><span>أيام التغلّب على العادة</span><span style="font-size:60px;font-weight:800;line-height:1">${st.days}</span><span>${msg}</span><div class="meter" style="background:rgba(255,255,255,.3)"><i style="background:#fff;width:${Math.min(100, st.days / 30 * 100)}%"></i></div><span>الهدف: 30 يومًا</span></div>
      <div class="row"><div class="card"><span class="mut">أطول فترة</span><span class="big teal">${best}</span></div><div class="card"><span class="mut">متوسط الفاصل</span><span class="big teal">${avg}</span></div></div>`
    : `<div class="card"><h2>تتبّع خاص بك</h2><span class="mut">يحسب الأيام التي تغلّبتِ فيها والفاصل بين كل مرتين، ويحفظ ملاحظاتك عن الممارسة أو التفكير أو محاولات الإيقاف. بياناتك على جهازك فقط. لا لوم هنا.</span><button class="btn teal" data-act="habitStart">ابدئي العدّ من اليوم</button><label for="hl">أو اختاري تاريخ آخر ممارسة</label><input id="hl" type="date" max="${t}" data-in="habitLast"></div>`;
  const evs = [...H.events].sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0).slice(0, 30);
  return head('خاص', 'تحدّيي') + `<div class="body">${top}
    <div class="card"><h2>آخر 30 يومًا</h2><div class="chips">${HT.map(k => `<span class="pill ${k === HP ? 'pk' : ''}">${k}: ${recent(k)}</span>`).join('')}</div></div>
    ${topT.length ? `<div class="card"><h2>ما يسبق الممارسة غالباً</h2><div class="chips">${topT.map(([k, n]) => `<span class="pill pk">${esc(k)} · ${n}</span>`).join('')}</div></div>` : ''}
    ${st.gaps.length ? `<div class="card"><h2>الفترات بين الممارسات (أيام)</h2><div class="bars">${st.gaps.slice(-6).map(v => `<div>${v}<i style="height:${Math.max(4, Math.min(110, v * 4))}px;background:var(--teal)"></i></div>`).join('')}</div></div>` : ''}
    <div class="card"><h2>${f.id ? 'تعديل حدث' : 'إضافة حدث'}</h2>
      <label for="hd">التاريخ (يمكنك اختيار يوم قديم)</label><input id="hd" type="date" max="${t}" value="${esc(f.d)}" data-in="hDate">
      <div class="sec"><h2>ماذا حدث؟</h2>${chips('h.type', HT, false)}</div>
      <div class="sec"><h2>ما الذي سبقه؟</h2>${chips('h.trig', HTRIG, true)}</div>
      <label for="hn">ملاحظات</label><textarea id="hn" rows="3" placeholder="اكتبي ما تريدين تذكّره…" data-in="hNote">${esc(f.note)}</textarea>
      <button class="btn teal" data-act="saveEvent">حفظ</button>${f.id ? '<button class="btn ghost" data-act="cancelEvent">إلغاء التعديل</button>' : ''}</div>
    <div class="card"><h2>السجل</h2>${evs.length ? evs.map(e => `<div class="sec" style="border-top:1px solid var(--line);padding-top:10px"><div class="sp"><span class="pill ${e.type === HP ? 'pk' : ''}">${esc(e.type)}</span><span class="mut">${longDate(e.d)}</span></div>${(e.trig || []).length ? `<span class="mut">قبلها: ${esc(e.trig.join('، '))}</span>` : ''}${e.note ? `<span>${esc(e.note)}</span>` : ''}<div class="chips"><button class="chip" style="min-height:36px;padding:0 12px" data-act="editEvent" data-id="${e.id}">تعديل</button><button class="chip" style="min-height:36px;padding:0 12px" data-act="delEvent" data-id="${e.id}">حذف</button></div></div>`).join('') : '<span class="mut">لا أحداث بعد.</span>'}</div>
    <span class="mut" style="text-align:center">التتبّع لفهم ما يسبق العودة، وليس للحكم عليك.</span></div>` + nav();
};

V.records = () => {
  const c = cyc(), t = today();
  const plist = periods().slice().reverse().map(p => `<div class="sp"><span><b>${longDate(p.start)}</b><br><span class="mut">${p.start === p.end ? 'يوم واحد' : 'إلى ' + longDate(p.end) + ' · ' + dw(p.days) + ' من النزيف'}</span></span><button class="chip" style="min-height:36px;padding:0 12px" data-act="delPeriod" data-s="${p.start}">حذف</button></div>`).join('');
  const logsH = Object.keys(S.logs).sort().reverse().map(d => { const sm = logSummary(S.logs[d]), cd = cycleDayOf(d); return `<div class="card"><div class="sp"><b>${longDate(d)}${cd ? ' · يوم ' + cd : ''}</b><span style="display:flex;gap:6px"><button class="chip" style="min-height:36px;padding:0 12px" data-act="editLog" data-d="${d}">تعديل</button><button class="chip" style="min-height:36px;padding:0 12px" data-act="delLog" data-d="${d}">حذف</button></span></div><span class="mut">${esc(sm || 'بدون تفاصيل')}</span></div>`; }).join('');
  return head('كل ما سجّلتِه', 'سجلاتي') + `<div class="body">
    <div class="card"><h2>إضافة دورة سابقة</h2><span class="mut">أدخلي دورات قديمة ليتعلّم التطبيق من تاريخك. تُسجَّل كل الأيام بين الأول والأخير، ويمكنك تعديل أي يوم لاحقاً من التقويم.</span>
      <label for="ops">أول يوم نزيف</label><input id="ops" type="date" max="${t}"><label for="ope">آخر يوم نزيف (اختياري)</label><input id="ope" type="date" max="${t}"><button class="btn" data-act="addOld">إضافة</button></div>
    <div class="card"><h2>تسجيل يوم سابق</h2><span class="mut">أعراض أو ألم أو ملاحظات ليوم قديم.</span><input id="opd" type="date" max="${t}" aria-label="تاريخ اليوم"><button class="btn ghost" data-act="openOldDay">فتح سجل هذا اليوم</button></div>
    ${linkBtn('habit', 'تحدّيي', 'أضيفي أحداثاً قديمة بتاريخها')}${linkBtn('body', 'كتلة الجسم', 'أضيفي قياسات قديمة بتاريخها')}
    ${plist ? `<div class="card"><h2>الدورات المسجّلة</h2>${plist}</div>` : ''}
    <h2 style="margin:4px 0 0;font-size:16px">سجلات الأيام</h2>${logsH || '<span class="mut">لا سجلات بعد.</span>'}</div>` + nav();
};

V.worship = () => {
  const F = S.fast, left = Math.max(0, F.total - F.done), t = today();
  const inP = dayType(t) === 'period' && S.starts.length;
  const cur = cyc().last;
  return head('العبادة', 'الصيام والصلاة') + `<div class="body">
    <div class="card" style="background:var(--teal);border-color:var(--teal);color:#fff"><span>أيام القضاء المتبقية</span><span style="font-size:56px;font-weight:800;line-height:1">${left}</span><div class="meter" style="background:rgba(255,255,255,.3)"><i style="background:#fff;width:${F.total ? F.done / F.total * 100 : 0}%"></i></div><span>تم قضاء ${F.done} من ${F.total}</span></div>
    <div class="sec"><label for="ft">عدد أيام الإفطار المطلوب قضاؤها</label><input id="ft" type="number" min="0" inputmode="numeric" value="${F.total}" data-in="fastTotal"></div>
    <button class="btn" data-act="fastDone">سجّلت يوم قضاء</button>
    <div class="note">${inP ? 'أنتِ الآن في أيام الدورة وتُحسب أيام انقطاع عن الصلاة.' : cur ? 'آخر دورة بدأت في ' + longDate(cur) + '.' : 'سجّلي دورتك ليظهر هنا حساب أيام الانقطاع.'}</div>
    <span class="mut" style="text-align:center">للتنظيم والتذكير فقط. للأحكام راجعي أهل العلم.</span></div>` + nav();
};

V.discover = () => {
  const src = ui.articles || TIPS;
  const cats = ['الكل', 'نصائح', 'تغذية', 'صحة', 'أخبار'];
  const items = ui.cat === 'الكل' ? src : src.filter(a => a.cat === ui.cat);
  if (ARTICLES_URL && !ui.fetched) { ui.fetched = true; fetch(ARTICLES_URL).then(r => r.json()).then(j => { ui.articles = j; render(); }).catch(() => {}); }
  return head(ARTICLES_URL ? (ui.articles ? 'محتوى محدّث' : 'جارٍ التحديث…') : 'نصائح محفوظة على جهازك', 'اكتشفي') + `<div class="body">
    <div class="chips" style="flex-wrap:nowrap;overflow-x:auto">${cats.map(c => `<button class="chip ${c === ui.cat ? 'on' : ''}" style="white-space:nowrap" data-act="cat" data-c="${c}">${c}</button>`).join('')}</div>
    ${items.map(a => `<div class="card"><span class="pink" style="font-size:12px;font-weight:700">${esc(a.cat)}</span><b style="line-height:1.6">${esc(a.title)}</b><span class="mut">${esc(a.meta || '')}</span>${a.url ? `<a href="${esc(a.url)}" style="color:var(--teal);font-weight:700">قراءة المقال</a>` : ''}</div>`).join('') || '<span class="mut">لا يوجد محتوى في هذا القسم.</span>'}
    <span class="mut" style="text-align:center">معلومات عامة وليست بديلاً عن الاستشارة الطبية.</span></div>` + nav();
};

function reportText() {
  const { c, logs, cycles } = stats();
  const cnt = {}; logs.forEach(([, l]) => { (l.symptoms || []).forEach(s => cnt[s] = (cnt[s] || 0) + 1); ((l.pain || {}).types || []).forEach(s => cnt[s] = (cnt[s] || 0) + 1); });
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 4).map(x => x[0]);
  const lv = logs.map(([, l]) => (l.pain || {}).level).filter(x => x > 0);
  const gaps = c.gaps.slice(-ui.n);
  const w = S.weights[S.weights.length - 1], b = bmiOf(S.height, w ? w.w : '');
  return ['ملخص الدورة الشهرية — ' + longDate(today()),
    'متوسط طول الدورة: ' + (gaps.length ? Math.round(avgOf(gaps)) : c.avg) + ' يومًا',
    'مدة النزيف: ' + plen() + ' أيام',
    gaps.length ? 'الانتظام: بين ' + Math.min(...gaps) + ' و' + Math.max(...gaps) + ' يومًا' : 'الانتظام: لا بيانات كافية',
    'أكثر الأعراض تكراراً: ' + (top.join('، ') || 'لا بيانات'),
    'متوسط مستوى الألم: ' + (lv.length ? avgOf(lv).toFixed(1) + ' من 10' : 'لا بيانات'),
    'كتلة الجسم: ' + b.v,
    'ملخص للمتابعة وليس تشخيصًا.'].join('\n');
}
V.report = () => head('آخر ' + ui.n + ' دورات', 'تقرير الطبيبة') + `<div class="body">
  <div class="row">${[3, 6, 12].map(n => `<button class="chip ${n === ui.n ? 'on' : ''}" data-act="rn" data-n="${n}">${n} دورات</button>`).join('')}</div>
  <div class="card" style="white-space:pre-line;line-height:2">${esc(reportText())}</div>
  <button class="btn" data-act="shareReport">مشاركة التقرير</button></div>` + nav();

V.account = () => {
  const s = S.settings;
  return head('اختياري', 'الحساب والخصوصية') + `<div class="body">
    ${ui.email ? `<div class="card"><h2>${esc(ui.email)}</h2><span class="mut">المزامنة مفعّلة. تُحفظ بياناتك في حسابك على Firebase وتظهر على أي جهاز تسجّلين الدخول منه.</span>
      <button class="btn ghost" data-act="syncNow">مزامنة الآن</button><button class="btn ghost" data-act="signOut">تسجيل الخروج</button></div>`
    : `<div class="card"><h2>احفظي بياناتك على كل أجهزتك</h2><span class="mut">بدون حساب تبقى بياناتك على هذا الهاتف فقط. بعد تسجيل الدخول تُحفظ نسخة في حسابك على Firebase (Google) لتفتحيها من جهاز آخر.</span>
      <button class="btn ghost" data-act="google">المتابعة باستخدام Google</button></div>`}
    <div class="srow"><span><b>قفل التطبيق بالرقم السري</b><span>${s.lock ? 'مفعّل' : 'غير مفعّل'}</span></span>${toggle('lock', s.lock)}</div>
    <button class="btn ghost" data-act="backup">نسخة احتياطية (مشاركة كنص)</button>
    <div class="sec"><label for="imp">استعادة نسخة احتياطية</label><textarea id="imp" rows="3" placeholder="الصقي النسخة الاحتياطية هنا" data-in="import"></textarea></div>
    <button class="btn ghost" data-act="restore">استعادة</button>
    <button class="btn danger" data-act="wipe">حذف كل بياناتي</button></div>` + nav();
};

V.settings = () => {
  const s = S.settings;
  const r = (b, t, sub, on, k) => `<div class="srow"><span><b>${t}</b><span>${sub}</span></span>${toggle(k, on)}</div>`;
  return head('التخصيص', 'الإعدادات') + `<div class="body">
    ${r(0, 'الوضع الداكن', 'ألوان مريحة للعين ليلاً', s.dark, 'dark')}
    ${r(0, 'التاريخ الهجري', 'يظهر بجانب التاريخ الميلادي', s.hijri, 'hijri')}
    <h2 style="margin:8px 0 0;font-size:14px;color:var(--mut)">التنبيهات</h2>
    ${r(0, 'قبل الدورة بيومين', 'الساعة 9:00 صباحاً', s.before, 'before')}
    ${r(0, 'بداية فترة الخصوبة', 'الساعة 9:00 صباحاً', s.fertile, 'fertile')}
    ${r(0, 'تذكير التسجيل اليومي', 'كل مساء الساعة 9:00', s.daily, 'daily')}
    ${r(0, 'تذكير الدواء', 'كل صباح الساعة 8:00', s.meds, 'meds')}
    <div class="row"><div class="sec"><label for="cl">طول الدورة المعتاد</label><input id="cl" type="number" min="18" max="50" value="${S.cycleLen}" data-in="cycleLen"></div>
    <div class="sec"><label for="pl">مدة النزيف</label><input id="pl" type="number" min="1" max="12" value="${S.periodLen}" data-in="periodLen"></div></div>
    <span class="mut">تُستخدم هذه القيم حتى تتوفر بيانات كافية من دوراتك.</span></div>` + nav();
};

/* ---------- الوردة ---------- */
function flowerSvg() {
  const p = 'M54,25 C61.5,25 66,32.5 66,40 C66,47.5 60.5,54 54,54 C47.5,54 42,47.5 42,40 C42,32.5 46.5,25 54,25 Z';
  return [0, 72, 144, 216, 288].map((a, i) => `<path d="${p}" fill="${i % 2 ? '#F58FB0' : '#EC6A98'}" transform="rotate(${a} 54 54)"/>`).join('') + '<circle cx="54" cy="45" r="9" fill="#FFF3D6"/>';
}

/* ---------- عرض وأحداث ---------- */
function render() {
  rebuild();
  document.body.classList.toggle('dark', !!S.settings.dark);
  const sc = document.querySelector('.body'); const top = sc ? sc.scrollTop : 0;
  const fn = V[route] || V.today;
  document.getElementById('app').innerHTML = fn();
  const nb = document.querySelector('.body'); if (nb) nb.scrollTop = top;
}
const G = {log: 'log', pain: 'log', habit: 'habit'};
function go(r) { if (!G[r] || G[r] !== G[route]) draft = null; if (r !== 'today') ui.msg = ''; route = r; render(); }
window.goBack = () => {
  if (document.getElementById('lock').hidden === false) return true;
  if (route === 'log' && ui.back) { const b = ui.back; ui.back = ''; go(b); return true; }
  if (route === 'pain') { go('log'); return true; }
  if (route !== 'today') { go(TABOF[route] === 'more' ? 'more' : 'today'); return true; }
  return false;
};

function saveLog() {
  const d = ui.logDate, l = draft, old = S.logs[d];
  const bleed = b => b && b !== 'لا يوجد';
  if (logSummary(l)) S.logs[d] = l; else delete S.logs[d];
  if (bleed(l.bleeding)) addPday(d);
  else if (l.bleeding === 'لا يوجد' || bleed(old && old.bleeding)) removePday(d);
  save(); toast('تم الحفظ');
  const b = ui.back; ui.back = ''; go(b || 'today');
}
function lockScreen() {
  const L = document.getElementById('lock');
  if (!(S.settings.lock && S.settings.pin)) { L.hidden = true; return; }
  L.hidden = false;
  L.innerHTML = `<svg class="flower" viewBox="0 0 108 108" aria-hidden="true">${flowerSvg()}</svg><h2>My period</h2><label for="pin">أدخلي الرقم السري</label><input id="pin" type="password" inputmode="numeric" maxlength="8" autocomplete="off">`;
  document.getElementById('pin').addEventListener('input', e => { if (e.target.value === S.settings.pin) { L.hidden = true; L.innerHTML = ''; } });
}

const A = {
  go: el => { const to = el.dataset.to; if (to === 'log' && route !== 'pain' && route !== 'log') { ui.logDate = today(); draft = null; ui.back = ''; } go(to); },
  chip: el => {
    const k = el.dataset.k, v = el.dataset.v;
    if (el.dataset.m === '1') { const a = getp(k), i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); }
    else setp(k, getp(k) === v ? '' : v);
    render();
  },
  lvl: el => { draft.pain.level = +el.dataset.n; render(); },
  saveLog,
  startPeriod: () => { if (addPday(today())) toast(ui.msg || 'سُجّل اليوم من أيام دورتك'); render(); },
  pick: el => { ui.sel = el.dataset.d; render(); },
  mon: el => { let m = ui.month + +el.dataset.n, y = ui.year; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } ui.month = m; ui.year = y; render(); },
  mark: el => { if (addPday(el.dataset.d)) toast(ui.msg || 'أُضيف اليوم إلى أيام دورتك'); render(); },
  unmark: el => { removePday(el.dataset.d); render(); },
  tab: el => { ui.tab = el.dataset.t; render(); },
  saveBody: () => { const w = document.getElementById('w').value, d = (document.getElementById('wd') || {}).value || today(); if (parseFloat(w) > 0) { S.weights = S.weights.filter(x => x.d !== d); S.weights.push({d, w}); S.weights.sort((a, b) => a.d < b.d ? -1 : 1); } save(); toast('تم حفظ القياس'); render(); },
  dismissMsg: () => { ui.msg = ''; render(); },
  snooze: () => { ui.snooze = today(); render(); },
  snoozeEnd: () => { ui.snoozeEnd = today(); render(); },
  stillBleeding: () => { addPday(today()); toast('سُجّل اليوم من أيام دورتك'); render(); },
  endToday: () => {
    const lp = periods().slice(-1)[0]; if (!lp) return;
    const o = plens(), usual = o.length ? Math.round(avgOf(o)) : S.periodLen;
    S.noBleed[today()] = true; ui.msg = lenMsg(lp.days, usual); save(); render();
  },
  editLog: el => { ui.logDate = el.dataset.d; ui.back = route; draft = null; go('log'); },
  delLog: el => { if (confirm('حذف سجل هذا اليوم؟')) { delete S.logs[el.dataset.d]; save(); render(); } },
  delPeriod: el => { if (confirm('حذف هذه الدورة من السجل؟')) { const p = periods().find(x => x.start === el.dataset.s); if (p) { S.pdays = S.pdays.filter(d => d < p.start || d > p.end); save(); } render(); } },
  addOld: () => {
    const a = document.getElementById('ops').value, e = document.getElementById('ope').value;
    if (!a) { toast('اختاري أول يوم نزيف'); return; }
    if (e && e < a) { toast('آخر يوم قبل أول يوم'); return; }
    if (e && diff(e, a) > 13) { toast('المدة أطول من 14 يوماً'); return; }
    if (a > today() || (e && e > today())) { toast('تاريخ غير صالح'); return; }
    const n = e ? diff(e, a) + 1 : 1;
    addRange(a, n); ui.msg = ''; toast('تمت إضافة ' + dw(n) + ' إلى أيام الدورة'); render();
  },
  openOldDay: () => { const d = document.getElementById('opd').value; if (!d) { toast('اختاري التاريخ'); return; } ui.logDate = d; ui.back = 'records'; draft = null; go('log'); },
  habitStart: () => { S.habit.start = today(); save(); render(); },
  saveEvent: () => {
    const h = draft && draft.h; if (!h) return;
    if (!h.type) { toast('اختاري ماذا حدث'); return; }
    if (!h.d || h.d > today()) { toast('تاريخ غير صالح'); return; }
    const ev = {id: h.id || nextEvId(), d: h.d, type: h.type, trig: h.trig.slice(), note: h.note};
    S.habit.events = S.habit.events.filter(x => x.id !== ev.id).concat([ev]).sort((a, b) => a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
    save(); draft = null; toast('تم الحفظ'); render();
  },
  cancelEvent: () => { draft = null; render(); },
  editEvent: el => { const e = S.habit.events.find(x => x.id === +el.dataset.id); if (e) { draft = {h: JSON.parse(JSON.stringify(Object.assign({trig: [], note: ''}, e)))}; render(); const b = document.querySelector('.body'); if (b) b.scrollTop = 0; } },
  delEvent: el => { if (confirm('حذف هذا الحدث؟')) { S.habit.events = S.habit.events.filter(x => x.id !== +el.dataset.id); save(); render(); } },
  fastDone: () => { if (S.fast.done < S.fast.total) S.fast.done++; save(); render(); },
  cat: el => { ui.cat = el.dataset.c; render(); },
  rn: el => { ui.n = +el.dataset.n; render(); },
  shareReport: () => shareText(reportText()),
  google: () => {
    if (!hasNative() || !Android.hasFirebase || !Android.hasFirebase()) { toast('لم يُعدّ Firebase بعد. راجعي README'); return; }
    Android.signIn();
  },
  signOut: () => { Android.signOut(); ui.email = ''; toast('تم تسجيل الخروج'); render(); },
  syncNow: () => { Android.syncDown(); },
  backup: () => shareText(JSON.stringify(S)),
  restore: () => { try { const j = JSON.parse(document.getElementById('imp').value); S = Object.assign(DEF(), j); fix(); save(); toast('تمت الاستعادة'); render(); } catch (e) { toast('النسخة غير صالحة'); } },
  wipe: () => { if (confirm('حذف كل بياناتك نهائياً؟')) { S = DEF(); fix(); save(); draft = null; toast('تم الحذف'); go('today'); } },
  sw: el => {
    const k = el.dataset.k;
    if (k === 'lock') {
      if (!S.settings.lock) { const p = prompt('اختاري رقماً سرياً (4 أرقام على الأقل)'); if (p && /^\d{4,8}$/.test(p)) { S.settings.pin = p; S.settings.lock = true; } else { toast('رقم غير صالح'); return; } }
      else { S.settings.lock = false; S.settings.pin = ''; }
    } else S.settings[k] = !S.settings[k];
    save(); render();
  }
};
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && A[el.dataset.act]) A[el.dataset.act](el); });
document.addEventListener('input', e => {
  const k = e.target.dataset.in; if (!k) return; const v = e.target.value;
  if (k === 'note') draft.note = v;
  else if (k === 'height' || k === 'weight') {
    if (k === 'height') { S.height = v; save(); }
    const h = document.getElementById('h').value, w = document.getElementById('w').value, r = bmiOf(h, w);
    document.getElementById('bmiV').textContent = r.v; document.getElementById('bmiC').textContent = r.c; document.getElementById('bmiP').style.right = r.p + '%';
  }
  else if (k === 'fastTotal') { S.fast.total = Math.max(0, parseInt(v) || 0); save(); }
  else if (k === 'cycleLen') { const n = parseInt(v); if (n >= 18 && n <= 50) { S.cycleLen = n; save(); } }
  else if (k === 'periodLen') { const n = parseInt(v); if (n >= 1 && n <= 12) { S.periodLen = n; save(); } }
  else if (k === 'lastStart') { if (v && v <= today()) { addRange(v, Math.min(diff(today(), v), plen() - 1) + 1); toast(ui.msg || 'سُجّلت أيام دورتك'); render(); } }
  else if (k === 'logDate') { if (v && v <= today()) { ui.logDate = v; draft = null; render(); } }
  else if (k === 'hDate') { if (draft && draft.h) draft.h.d = v; }
  else if (k === 'hNote') { if (draft && draft.h) draft.h.note = v; }
  else if (k === 'habitLast') { if (v && v <= today()) { S.habit.events.push({id: nextEvId(), d: v, type: HP, trig: [], note: ''}); save(); render(); } }
});

fix();
lockScreen();
if (hasNative() && Android.user) { try { ui.email = Android.user() || ''; } catch (e) {} }
render();
syncReminders();
if (ui.email) Android.syncDown();
