/* =========================================================
   共通ユーティリティ
========================================================= */
const $  = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const htmlEl = document.documentElement;

// localStorage が使えない環境でも動くようにする
const store = {
  get(key, fallback){
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, val){ try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 保存できなくても続行 */ } }
};

function escapeHtml_(text){
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function formatDate_(iso){
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '日時不明';
  return d.toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
// Lucide アイコン（index.html のスプライトを参照）
function ic(name, cls){
  return '<svg class="icon' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
}
function errMsg_(err){ return (err && err.message) ? err.message : String(err); }

let toastTimer = null;
function toast(message, type){
  const el = $('#toast');
  const icon = type === 'error' ? 'circle-alert' : (type === 'ok' ? 'circle-check' : 'info');
  el.innerHTML = ic(icon) + '<span></span>';
  el.querySelector('span').textContent = message;
  // 下からのシートやFABに重ならないよう、その上に表示する（M3 のスナックバーの作法）
  const sh = document.getElementById('sheet'), fb = document.getElementById('fab-post');
  let off = 16;
  if (sh && sh.classList.contains('open')) off = sh.offsetHeight + 16;
  else if (fb && fb.classList.contains('show') && getComputedStyle(fb).display !== 'none') off = 20 + 56 + 16;
  el.style.setProperty('--sb', off + 'px');
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3400);
}

// ブラウザごとの匿名ID（連続投稿の制限用。個人情報ではありません）
function getClientId(){
  let id = store.get('kbm_client_id', null);
  if (!id) {
    id = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    store.set('kbm_client_id', id);
  }
  return id;
}

// サーバー（server.js）の API を呼び出すためのラッパー
//   callApi('getPins') / callApi('addPin', pinData, clientId) / callApi('votePin', id)
//   callApi('deletePin', id, ownerToken) / callApi('getQuizData')
// エラー時は、サーバーが返した日本語のメッセージを持つ Error を投げる。
const API_ROUTES = {
  getPins:     () => ({ method: 'GET',    url: '/api/pins' }),
  addPin:      (pin, clientId) => ({ method: 'POST', url: '/api/pins', body: { pin: pin, clientId: clientId } }),
  votePin:     (id) => ({ method: 'POST',   url: '/api/pins/' + encodeURIComponent(id) + '/vote' }),
  deletePin:   (id, token) => ({ method: 'DELETE', url: '/api/pins/' + encodeURIComponent(id), headers: { 'X-Owner-Token': token || '' } }),
  getQuizData: () => ({ method: 'GET',    url: '/api/quiz' })
};
async function callApi(fnName){
  const build = API_ROUTES[fnName];
  if (!build) throw new Error('未対応の操作です: ' + fnName);
  const req = build.apply(null, Array.prototype.slice.call(arguments, 1));
  const headers = Object.assign({ 'Accept': 'application/json' }, req.headers || {});
  const init = { method: req.method, headers: headers, cache: 'no-store' };
  if (req.body !== undefined) { headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(req.body); }

  let res;
  try {
    res = await fetch(req.url, init);
  } catch (e) {
    throw new Error('サーバーに接続できませんでした。通信状況を確認して、もう一度お試しください。');
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* JSON 以外の応答 */ }
  if (!res.ok || !data || data.ok === false) {
    throw new Error((data && data.error) || ('サーバーでエラーが発生しました（' + res.status + '）。'));
  }
  return data.data;          // サーバーは { ok: true, data: 結果 } の形で返す
}

function countTo(el, to){
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  el.classList.remove('skeleton');
  if (prefersReduced || from === to) { el.textContent = to; return; }
  const t0 = performance.now(), dur = 700;
  (function step(now){
    const p = Math.min((now - t0) / dur, 1);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  })(t0);
}

/* =========================================================
   リップル（M3 のタッチ反応）
   押した位置から波紋が広がる。見た目は CSS の .rpl / ripple を参照
========================================================= */
(function initRipple(){
  if (prefersReduced) return;
  const SEL = '.btn, .icon-btn, .nav-link, .cat-card, .q-option, .rank-item, .filter-item, .acc-item > summary, .fab, .to-top, .ref-link, ' +
              '#quizOxRoot .quizOxCat, #quizOxRoot .quizOxCh, #quizOxRoot .quizOxAct, #quizOxRoot .quizOxQuit';
  document.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const host = e.target.closest && e.target.closest(SEL);
    if (!host || host.disabled || host.getAttribute('aria-disabled') === 'true') return;
    let layer = host.querySelector(':scope > .rpl');
    if (!layer) {
      layer = document.createElement('span');
      layer.className = 'rpl';
      layer.setAttribute('aria-hidden', 'true');
      host.appendChild(layer);
    }
    const r = host.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const d = 2 * Math.max(Math.hypot(x, y), Math.hypot(r.width - x, y), Math.hypot(x, r.height - y), Math.hypot(r.width - x, r.height - y));
    const dot = document.createElement('i');
    dot.style.cssText = 'left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;width:' + d.toFixed(1) + 'px;height:' + d.toFixed(1) + 'px';
    dot.addEventListener('animationend', () => dot.remove());
    layer.appendChild(dot);
  }, { passive: true });
})();

/* =========================================================
   オープニング演出
   ① 巨大なピンが上から落ちてバウンド  ② 背景は強いブラー
   ③ バウンドが終わるとブラーが晴れ、ピンと前面がフェードアウト
   ④ 約2.7秒後に要素を消し、地図を操作できるようにする
========================================================= */
(function initOpening(){
  const el = $('#opening');
  if (!el) return;
  if (prefersReduced) { el.remove(); document.body.classList.remove('is-opening'); return; }

  htmlEl.classList.add('no-scroll');
  let finished = false;
  const timers = [];

  function release(){
    htmlEl.classList.remove('no-scroll');
    document.body.classList.remove('is-opening');
    if (window.publicMap) setTimeout(() => publicMap.invalidateSize(), 50);
  }
  function finish(){
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    el.classList.add('is-clearing', 'is-done');   // pointer-events:none → display:none
    release();
    setTimeout(() => el.remove(), 100);
  }
  function skip(){
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    el.classList.add('is-clearing', 'is-skipped');
    release();
    setTimeout(() => el.remove(), 400);
  }

  // バウンドが終わった瞬間から、背後を操作できるようにする
  timers.push(setTimeout(() => { el.classList.add('is-clearing'); htmlEl.classList.remove('no-scroll'); }, 1850));
  el.addEventListener('animationend', (e) => { if (e.target === el && e.animationName === 'op-overlay') finish(); });
  timers.push(setTimeout(finish, 2900));                       // 念のための保険
  el.addEventListener('click', skip);
  document.addEventListener('keydown', (e) => { if (!finished && (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ')) skip(); });
})();

/* =========================================================
   ハンバーガーメニュー・画面切り替え
   画面遷移は M3 の「フェードスルー」：出る画面が 90ms で消え、入る画面が 210ms で現れる
========================================================= */
const views = $$('.view');
const navLinks = $$('.nav-link');
const menuBtn = $('#menu-btn');
const drawer = $('#drawer');
const scrim = $('#scrim');
const VIEW_TITLES = {
  'view-public-map': 'みんなの危険マップ',
  'view-map': '投稿する',
  'view-rules': '交通ルール',
  'view-quiz': 'クイズ',
  'view-oxgame': '◯✕ゲーム'
};
let currentTarget = 'view-public-map';

function setInert(on){
  ['#main', '#site-header', '#site-footer', '.skip-link', '#to-top', '#fab-post'].forEach(sel => { const e = $(sel); if (e) e.inert = on; });
}
function openDrawer(){
  closeSheet(true);
  drawer.inert = false;
  drawer.classList.add('open');
  scrim.classList.add('open');
  menuBtn.classList.add('is-open');
  menuBtn.setAttribute('aria-expanded', 'true');
  setInert(true);
  htmlEl.classList.add('no-scroll');
  setTimeout(() => { (drawer.querySelector('[aria-current="page"]') || $('#drawer-close')).focus(); }, 80);
}
function closeDrawer(restoreFocus){
  if (!drawer.classList.contains('open')) return;
  drawer.classList.remove('open');
  scrim.classList.remove('open');
  menuBtn.classList.remove('is-open');
  menuBtn.setAttribute('aria-expanded', 'false');
  setInert(false);
  drawer.inert = true;
  htmlEl.classList.remove('no-scroll');
  if (restoreFocus) menuBtn.focus();
}
menuBtn.addEventListener('click', () => { drawer.classList.contains('open') ? closeDrawer(true) : openDrawer(); });
$('#drawer-close').addEventListener('click', () => closeDrawer(true));
scrim.addEventListener('click', () => closeDrawer(true));

let viewToken = 0;
function showView(id){
  const target = document.getElementById(id);
  if (!target) return;
  closeSheet(true);
  currentTarget = id;
  navLinks.forEach(l => {
    if (l.dataset.target === id) l.setAttribute('aria-current', 'page'); else l.removeAttribute('aria-current');
  });
  $('#current-page').textContent = VIEW_TITLES[id] || '';
  resetPull();
  updateFab();

  const token = ++viewToken;
  function swap(){
    if (token !== viewToken) return;
    views.forEach(v => { v.classList.remove('is-leaving'); v.classList.toggle('active', v === target); });
    window.scrollTo(0, 0);
    if (id === 'view-map') { ensureEditMap(); setTimeout(() => editMap && editMap.invalidateSize(), 60); }
    if (id === 'view-public-map') { setTimeout(() => publicMap && publicMap.invalidateSize(), 60); }
    const h1 = target.querySelector('h1');
    if (h1) h1.focus({ preventScroll: true });        // スクリーンリーダー・キーボード利用者のために見出しへ移動
  }
  const prev = views.find(v => v.classList.contains('active'));
  if (prev && prev !== target && !prefersReduced) {
    prev.classList.remove('active');
    prev.classList.add('is-leaving');
    setTimeout(swap, 90);
  } else swap();
}

navLinks.forEach(link => link.addEventListener('click', () => {
  const id = link.dataset.target;
  closeDrawer(false);
  if (id === currentTarget) { menuBtn.focus(); return; }
  showView(id);
}));
// ページ内リンク（#...）は JS で処理する（URL に #main などが付かないようにする）
$('.skip-link').addEventListener('click', (e) => { e.preventDefault(); $('#main').focus(); });
$('#brand-link').addEventListener('click', (e) => {
  e.preventDefault();
  if (currentTarget !== 'view-public-map') showView('view-public-map'); else window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
});
// 外部リンク（地図の著作権表示など）は、アプリが切り替わらないよう別タブで開く
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href^="http"]');
  if (a && !a.getAttribute('target')) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
}, true);
const firstLink = navLinks.find(l => l.dataset.target === currentTarget);
if (firstLink) firstLink.setAttribute('aria-current', 'page');

document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && drawer.classList.contains('open')) {
    // メニューを開いている間は、Tab キーのフォーカスがメニューの外へ出ないようにする
    const items = $$('a[href], button:not([disabled])', drawer).filter(el => el.offsetParent !== null || el === document.activeElement);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (!drawer.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    return;
  }
  if (e.key !== 'Escape') return;
  if (drawer.classList.contains('open')) closeDrawer(true);
  else if ($('#sheet').classList.contains('open')) closeSheet(false);
});

// ページ先頭へ戻るボタン
const toTopBtn = $('#to-top');
const appBar = $('#site-header');
window.addEventListener('scroll', () => {
  toTopBtn.classList.toggle('show', window.scrollY > 500);
  appBar.classList.toggle('scrolled', window.scrollY > 4);      // スクロールするとバーの色が少し濃くなる（M3）
}, { passive: true });
toTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' }));

/* =========================================================
   アコーディオン（交通ルール）
   <details> を使い、高さをなめらかにアニメーションさせる
========================================================= */
(function initAccordion(){
  const items = $$('.acc-item');
  const toggleAll = $('#btn-acc-toggle');

  function syncToggleAll(){
    const allOpen = items.every(d => d.classList.contains('is-open'));
    toggleAll.dataset.state = allOpen ? 'open' : 'closed';
    toggleAll.innerHTML = ic(allOpen ? 'chevrons-down-up' : 'chevrons-up-down') + '<span class="btn-label">' + (allOpen ? 'すべて閉じる' : 'すべて開く') + '</span>';
  }

  function setOpen(d, open){
    const body = $('.acc-body', d);
    if (d._anim) { d._anim.cancel(); d._anim = null; }
    d.classList.toggle('is-open', open);
    if (open) {
      d.open = true;
      if (prefersReduced) return;
      const h = body.offsetHeight;
      d._anim = body.animate([{ height: '0px', opacity: 0 }, { height: h + 'px', opacity: 1 }], { duration: 300, easing: 'cubic-bezier(.05,.7,.1,1)' });
      d._anim.onfinish = d._anim.oncancel = () => { d._anim = null; };
    } else {
      if (prefersReduced) { d.open = false; return; }
      const h = body.offsetHeight;
      d._anim = body.animate([{ height: h + 'px', opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 200, easing: 'cubic-bezier(.3,0,.8,.15)' });
      d._anim.onfinish = () => { d.open = false; d._anim = null; };
      d._anim.oncancel = () => { d._anim = null; };
    }
  }

  items.forEach((d, i) => {
    d.style.setProperty('--i', i);
    $('summary', d).addEventListener('click', (e) => {
      e.preventDefault();
      setOpen(d, !d.classList.contains('is-open'));
      syncToggleAll();
    });
  });

  toggleAll.addEventListener('click', () => {
    const open = toggleAll.dataset.state !== 'open';
    items.forEach((d, i) => setTimeout(() => setOpen(d, open), prefersReduced ? 0 : i * 35));   // 順番にパラパラと開く
    toggleAll.dataset.state = open ? 'open' : 'closed';
    toggleAll.innerHTML = ic(open ? 'chevrons-down-up' : 'chevrons-up-down') + '<span class="btn-label">' + (open ? 'すべて閉じる' : 'すべて開く') + '</span>';
  });
})();

/* =========================================================
   マップ（サーバーの API で投稿ピンを保存・読み込み）
========================================================= */
const CATEGORY_META = {
  '事故多発':    { color: '#BA1A1A', label: '事故多発エリア',     short: '事' },
  '見通し不良':  { color: '#B04A00', label: '見通し不良',         short: '見' },
  '段差・悪路':  { color: '#7A5900', label: '段差・悪路',         short: '段' },
  '違法駐輪':    { color: '#6D3AC2', label: '違法駐輪・通行妨害', short: '駐' },
  'その他':      { color: '#5F6368', label: 'その他',             short: '他' }
};
const CATEGORY_ORDER = ['事故多発', '見通し不良', '段差・悪路', '違法駐輪', 'その他'];
const KUMAMOTO_CITY_HALL = [32.8032, 130.7079];
const PIN_PATH = 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0';

// 実データはサーバー側（データベース）が正。ここは表示用のコピー
const state = {
  pins: {},            // id -> pin
  sig: '',             // 前回取得時の内容（変化検知用）
  filter: {},          // カテゴリ -> 表示するか
  selectedId: null,
  pendingLatLng: null,
  firstLoaded: false
};
CATEGORY_ORDER.forEach(c => { state.filter[c] = true; });

let editMap = null;
let publicMap = null;
const layers = { edit: null, pub: null };
const markers = { edit: {}, pub: {} };
const seenPins = { edit: new Set(), pub: new Set() };
let pendingMarker = null;
let sheetKind = 'pub';

function metaOf(pin){ return CATEGORY_META[pin.category] || CATEGORY_META['その他']; }
function pinSize(pin){ return 34 + Math.min(pin.votes || 0, 10) * 1.8; }   // 共感が多いほどピンが大きい
function getVoted(){ return store.get('kbm_voted', []); }
function getTokens(){ return store.get('kbm_tokens', {}); }

/* ---------- 地図の作成 ---------- */
function createMap(elementId, zoom){
  const m = L.map(elementId).setView(KUMAMOTO_CITY_HALL, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(m);
  addLocateControl(m);
  return m;
}

function addLocateControl(m){
  const Locate = L.Control.extend({
    options: { position: 'topleft' },
    onAdd(){
      const wrap = L.DomUtil.create('div', 'leaflet-bar');
      const a = L.DomUtil.create('a', 'locate-btn', wrap);
      a.href = '#';
      a.title = '現在地を表示';
      a.setAttribute('role', 'button');
      a.setAttribute('aria-label', '現在地を表示');
      a.innerHTML = ic('locate-fixed');
      L.DomEvent.disableClickPropagation(wrap);
      a.addEventListener('click', (ev) => { ev.preventDefault(); locateMe(m); });
      return wrap;
    }
  });
  m.addControl(new Locate());
}

function locateMe(m){
  if (!navigator.geolocation) { toast('このブラウザでは現在地を取得できません。', 'error'); return; }
  toast('現在地を取得しています…');
  navigator.geolocation.getCurrentPosition((pos) => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    if (m._me) m.removeLayer(m._me);
    m._me = L.marker(ll, {
      icon: L.divIcon({ className: 'my-location', html: '<i></i>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false, keyboard: false
    }).addTo(m);
    m.setView(ll, Math.max(m.getZoom(), 16));
    toast('現在地を表示しました。', 'ok');
  }, () => {
    toast('現在地を取得できませんでした。位置情報の許可をご確認ください。', 'error');
  }, { enableHighAccuracy: true, timeout: 10000 });
}

// Leaflet（地図ライブラリ）が読み込めなかったときも、他の画面は使えるようにする
function mapUnavailable_(id){
  const el = document.getElementById(id);
  if (el && !el.dataset.err) {
    el.dataset.err = '1';
    el.innerHTML = '<p class="map-error">' + ic('triangle-alert') + '地図を読み込めませんでした。通信状況を確認して、ページを再読み込みしてください。</p>';
  }
}

function ensurePublicMap(){
  if (publicMap) return;
  if (typeof L === 'undefined') { mapUnavailable_('public-map'); return; }
  publicMap = createMap('public-map', 14);
  window.publicMap = publicMap;
  layers.pub = L.layerGroup().addTo(publicMap);
  publicMap.on('click', () => closeSheet(false));
  renderPins();
}

function ensureEditMap(){
  if (editMap) return;
  if (typeof L === 'undefined') { mapUnavailable_('map'); return; }
  editMap = createMap('map', 15);
  window._map = editMap;
  layers.edit = L.layerGroup().addTo(editMap);

  editMap.on('click', (e) => {
    closeSheet(true);
    state.pendingLatLng = e.latlng;
    $('#coord-text').textContent = '選んだ場所: 緯度 ' + e.latlng.lat.toFixed(5) + ' / 経度 ' + e.latlng.lng.toFixed(5);
    const coord = $('#coord-readout');
    coord.classList.add('is-set');
    coord.classList.remove('pop'); void coord.offsetWidth; coord.classList.add('pop');
    $('#btn-submit-pin').disabled = false;

    if (pendingMarker) editMap.removeLayer(pendingMarker);
    pendingMarker = L.marker(e.latlng, {
      icon: L.divIcon({
        className: 'pending-pin-icon',
        html: '<div class="pending-pin"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + PIN_PATH + '"/><circle cx="12" cy="10" r="3.6"/></svg></div>',
        iconSize: [44, 44],
        iconAnchor: [22, 40]
      }),
      interactive: false, keyboard: false
    }).addTo(editMap);
    updateSteps();
    updateFab();
  });
  renderPins();
}

/* ---------- ピン（Lucide の map-pin 形） ---------- */
function pinHtml_(pin, isNew, delay){
  const m = metaOf(pin), s = pinSize(pin);
  return '<span class="map-pin' + (isNew ? ' pin-new' : '') + '" style="--c:' + m.color + ';--s:' + s.toFixed(1) + 'px;--d:' + delay + 'ms">'
    + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + PIN_PATH + '"/><circle cx="12" cy="10" r="4.4"/></svg>'
    + '<span class="map-pin-glyph" aria-hidden="true">' + m.short + '</span></span>';
}
function pinIcon_(pin, isNew, delay){
  const s = pinSize(pin);
  return L.divIcon({ className: 'map-pin-wrap', html: pinHtml_(pin, isNew, delay), iconSize: [s, s], iconAnchor: [s / 2, s * 0.92] });
}
function pinTitle_(pin){ return metaOf(pin).label + '、共感' + (pin.votes || 0) + '票。選ぶと詳細を表示します'; }

function makeMarker_(pin, kind, isNew, delay){
  const mk = L.marker([pin.lat, pin.lng], {
    icon: pinIcon_(pin, isNew, delay),
    keyboard: true, title: pinTitle_(pin), alt: pinTitle_(pin), riseOnHover: true
  });
  mk.on('click', () => openSheet(pin.id, kind));
  return mk;
}

function markSelected(id){
  ['edit', 'pub'].forEach(k => {
    Object.keys(markers[k]).forEach(pid => {
      const el = markers[k][pid].getElement && markers[k][pid].getElement();
      const pinEl = el && el.querySelector('.map-pin');
      if (pinEl) pinEl.classList.toggle('is-selected', pid === id);
    });
  });
}

function renderPins(){
  const pins = Object.keys(state.pins).map(id => state.pins[id]);

  [['edit', editMap], ['pub', publicMap]].forEach(([kind, m]) => {
    if (!m || !layers[kind]) return;
    layers[kind].clearLayers();
    markers[kind] = {};
    let order = 0;
    pins.forEach(pin => {
      if (kind === 'pub' && CATEGORY_META[pin.category] && !state.filter[pin.category]) return;   // 絞り込みで非表示
      const isNew = !seenPins[kind].has(pin.id);
      const mk = makeMarker_(pin, kind, isNew, isNew ? Math.min(order * 35, 700) : 0);
      mk.addTo(layers[kind]);
      markers[kind][pin.id] = mk;
      seenPins[kind].add(pin.id);
      order++;
    });
  });
  if (state.selectedId) markSelected(state.selectedId);
}

/* ---------- サーバーからの読み込み ---------- */
let fetching = null;
function setUpdatedText_(text){ $('#stat-updated').textContent = text; $('#stat-updated-2').textContent = text; }

async function fetchPins(manual, opts){
  opts = opts || {};
  if (fetching) return fetching;
  const btns = [$('#btn-refresh'), $('#btn-refresh-2')];
  if (manual) btns.forEach(b => { b.classList.add('is-loading'); b.disabled = true; });

  fetching = (async () => {
    try {
      const list = await callApi('getPins');
      const sig = JSON.stringify(list.map(p => [p.id, p.votes]));
      if (manual || sig !== state.sig || !state.firstLoaded) {
        state.pins = {};
        list.forEach(p => { state.pins[p.id] = p; });
        state.sig = sig;
        state.firstLoaded = true;
        renderPins();
        renderStats();
        if (state.selectedId && !state.pins[state.selectedId]) closeSheet(true);
      }
      setUpdatedText_('最終更新 ' + new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }));
      if (manual && !opts.silent) toast('最新の情報に更新しました。', 'ok');
      return true;
    } catch (err) {
      console.error('ピンの読み込みに失敗しました:', err);
      setUpdatedText_('読み込みに失敗しました');
      if (manual && !opts.silent) toast('読み込みに失敗しました: ' + errMsg_(err), 'error');
      throw err;
    } finally {
      btns.forEach(b => { b.classList.remove('is-loading'); b.disabled = false; });
      fetching = null;
    }
  })();
  return fetching;
}

/* ---------- 統計・絞り込み・ランキング ---------- */
(function buildFilters(){
  const list = $('#filter-list');
  CATEGORY_ORDER.forEach(cat => {
    const meta = CATEGORY_META[cat];
    const label = document.createElement('label');
    label.className = 'filter-item on';
    label.innerHTML =
      '<input type="checkbox" checked>' +
      '<span class="filter-box">' + ic('check') + '</span>' +
      '<span class="glyph" style="--c:' + meta.color + '" aria-hidden="true">' + meta.short + '</span>' +
      '<span class="filter-name">' + escapeHtml_(meta.label) + '</span>' +
      '<span class="filter-count" data-count="' + escapeHtml_(cat) + '">0件</span>';
    label.querySelector('input').addEventListener('change', (e) => {
      state.filter[cat] = e.target.checked;
      label.classList.toggle('on', e.target.checked);
      renderPins();
    });
    list.appendChild(label);
  });
})();

function renderStats(){
  const pins = Object.keys(state.pins).map(id => state.pins[id]);
  countTo($('#stat-total'), pins.length);

  const counts = {};
  CATEGORY_ORDER.forEach(c => { counts[c] = 0; });
  pins.forEach(p => { counts[CATEGORY_META[p.category] ? p.category : 'その他']++; });
  CATEGORY_ORDER.forEach(c => {
    const el = $('[data-count="' + c + '"]');
    if (el) el.textContent = counts[c] + '件';
  });

  const top = pins.filter(p => (p.votes || 0) > 0)
    .sort((a, b) => (b.votes - a.votes) || (new Date(b.postedAt) - new Date(a.postedAt)))
    .slice(0, 5);
  const rank = $('#rank-list');
  rank.innerHTML = '';
  if (top.length === 0) {
    rank.innerHTML = '<li class="rank-empty">まだ共感の票がありません。ピンを開いて「危ないと思う」を押してみましょう。</li>';
    return;
  }
  top.forEach((pin, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rank-item';
    b.style.setProperty('--i', i);
    b.innerHTML =
      '<span class="rank-no">' + (i + 1) + '</span>' +
      '<span class="rank-text">' + escapeHtml_(metaOf(pin).label) + '：' + escapeHtml_(pin.detail) + '</span>' +
      '<span class="rank-votes">' + pin.votes + '票</span>';
    b.addEventListener('click', () => focusPublicPin(pin.id));
    li.appendChild(b);
    rank.appendChild(li);
  });
}

function focusPublicPin(id){
  const pin = state.pins[id];
  if (!pin || !publicMap) return;
  if (!state.filter[pin.category]) {
    state.filter[pin.category] = true;
    const input = $$('#filter-list .filter-item')[CATEGORY_ORDER.indexOf(pin.category)];
    if (input) { input.classList.add('on'); input.querySelector('input').checked = true; }
    renderPins();
  }
  $('#public-map').scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'center' });
  publicMap.setView([pin.lat, pin.lng], Math.max(publicMap.getZoom(), 16), { animate: !prefersReduced });
  setTimeout(() => openSheet(id, 'pub'), 380);
}

/* =========================================================
   ボトムシート（ピンの詳細）
========================================================= */
const sheet = $('#sheet');
const btnVotePin = $('#btn-vote-pin');
const btnDeletePin = $('#btn-delete-pin');

function fillSheet(pin){
  const meta = metaOf(pin);
  const tag = $('#sheet-tag');
  tag.style.setProperty('--c', meta.color);
  tag.innerHTML = '<span class="glyph" aria-hidden="true" style="--c:' + meta.color + '">' + meta.short + '</span>' + escapeHtml_(meta.label);
  $('#sheet-text').textContent = pin.detail;
  $('#sheet-date').textContent = formatDate_(pin.postedAt);
  $('#sheet-coord').textContent = pin.lat.toFixed(5) + ', ' + pin.lng.toFixed(5);
  updateVoteButton_(pin);

  const mine = !!getTokens()[pin.id];
  btnDeletePin.hidden = !mine;
  $('#own-note').hidden = !mine;
}

function updateVoteButton_(pin){
  const voted = getVoted().indexOf(pin.id) !== -1;
  btnVotePin.classList.toggle('voted', voted);
  btnVotePin.setAttribute('aria-pressed', voted ? 'true' : 'false');
  $('#vote-label').textContent = voted ? '投票済み' : '危ないと思う';
  $('#vote-count').textContent = pin.votes || 0;
}

function closeConfirm_(){ $('#delete-confirm').hidden = true; btnDeletePin.hidden = !getTokens()[state.selectedId]; }

function openSheet(id, kind){
  const pin = state.pins[id];
  if (!pin) return;
  state.selectedId = id;
  if (kind) sheetKind = kind;
  fillSheet(pin);
  closeConfirm_();

  sheet.inert = false;
  sheet.setAttribute('aria-hidden', 'false');
  sheet.classList.remove('dragging');
  sheet.style.transform = '';
  // 開き直したときにも出現アニメーションが再生されるようにする
  sheet.classList.remove('open'); void sheet.offsetWidth; sheet.classList.add('open');

  markSelected(id);
  setTimeout(() => $('#sheet-title').focus({ preventScroll: true }), 60);
  panForSheet_(pin);
  updateFab();
}

function closeSheet(silent){
  if (!sheet.classList.contains('open')) { state.selectedId = null; return; }
  const prevId = state.selectedId;
  sheet.classList.remove('open');
  sheet.style.transform = '';
  sheet.setAttribute('aria-hidden', 'true');
  sheet.inert = true;
  state.selectedId = null;
  markSelected(null);
  if (!silent && prevId) {
    const mk = markers[sheetKind] && markers[sheetKind][prevId];
    const el = mk && mk.getElement && mk.getElement();
    if (el) el.focus({ preventScroll: true });
  }
  updateFab();
}
$('#sheet-close').addEventListener('click', () => closeSheet(false));

// シートに隠れないよう、選んだピンが見える位置まで地図を動かす
function panForSheet_(pin){
  const m = sheetKind === 'edit' ? editMap : publicMap;
  if (!m) return;
  requestAnimationFrame(() => {
    const h = sheet.offsetHeight;
    const sheetTop = window.innerHeight - h;
    const cp = m.latLngToContainerPoint([pin.lat, pin.lng]);
    const rect = m.getContainer().getBoundingClientRect();
    const pinY = rect.top + cp.y;
    const limit = sheetTop - 80;
    const headerBottom = $('#site-header').getBoundingClientRect().bottom + 70;
    if (pinY > limit) m.panBy([0, pinY - limit], { animate: !prefersReduced });
    else if (pinY < headerBottom) m.panBy([0, pinY - headerBottom], { animate: !prefersReduced });
  });
}

// ドラッグで下に引いて閉じる
(function initSheetDrag(){
  let startY = 0, dy = 0, startT = 0, dragging = false;
  function down(e){
    if (e.target.closest('button')) return;
    dragging = true; startY = e.clientY; dy = 0; startT = performance.now();
    sheet.classList.add('dragging');
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
  }
  function move(e){
    if (!dragging) return;
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = 'translate(-50%, ' + dy + 'px)';
  }
  function up(){
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    const v = dy / Math.max(1, performance.now() - startT);   // px/ms
    if (dy > 90 || v > 0.6) closeSheet(false);
    else sheet.style.transform = '';
  }
  [$('#sheet-grab'), $('.sheet-head', sheet)].forEach(el => {
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
})();

/* ---------- 共感の投票 ---------- */
async function votePin(id){
  const pin = state.pins[id];
  if (!pin) return;
  const voted = getVoted();
  if (voted.indexOf(id) !== -1) { toast('この投稿にはすでに投票済みです。'); return; }

  // 先に画面へ反映し、失敗したら元に戻す
  pin.votes = (pin.votes || 0) + 1;
  voted.push(id);
  store.set('kbm_voted', voted);
  state.sig = '';
  refreshPinViews(id);
  btnVotePin.classList.remove('burst-go'); void btnVotePin.offsetWidth; btnVotePin.classList.add('burst-go');
  setTimeout(() => btnVotePin.classList.remove('burst-go'), 800);

  try {
    pin.votes = await callApi('votePin', id);
    refreshPinViews(id);
  } catch (err) {
    pin.votes = Math.max(0, (pin.votes || 1) - 1);
    store.set('kbm_voted', getVoted().filter(v => v !== id));
    refreshPinViews(id);
    toast('投票に失敗しました: ' + errMsg_(err), 'error');
  }
}
btnVotePin.addEventListener('click', () => { if (state.selectedId) votePin(state.selectedId); });

/** 票数が変わったとき、シートを閉じずに見た目だけ更新する */
function refreshPinViews(id){
  const pin = state.pins[id];
  if (!pin) return;
  ['edit', 'pub'].forEach(k => {
    const mk = markers[k][id];
    if (!mk) return;
    mk.setIcon(pinIcon_(pin, false, 0));
    if (mk.options) { mk.options.title = pinTitle_(pin); }
  });
  if (state.selectedId === id) { updateVoteButton_(pin); markSelected(id); }
  renderStats();
}

/* ---------- 削除（シート内で確認する） ---------- */
btnDeletePin.addEventListener('click', () => {
  btnDeletePin.hidden = true;
  $('#delete-confirm').hidden = false;
  $('#btn-delete-cancel').focus();
});
$('#btn-delete-cancel').addEventListener('click', () => { closeConfirm_(); btnDeletePin.focus(); });
$('#btn-delete-ok').addEventListener('click', async () => {
  const id = state.selectedId;
  if (!id) return;
  const tokens = getTokens();
  const okBtn = $('#btn-delete-ok');
  okBtn.disabled = true;
  try {
    const ok = await callApi('deletePin', id, tokens[id] || '');
    if (ok) {
      delete state.pins[id];
      delete tokens[id];
      store.set('kbm_tokens', tokens);
      state.sig = '';
      closeSheet(true);
      renderPins();
      renderStats();
      toast('投稿を削除しました。', 'ok');
    } else {
      toast('この投稿は既に削除されています。');
      closeSheet(true);
      fetchPins(true, { silent: true }).catch(() => {});
    }
  } catch (err) {
    toast('削除に失敗しました: ' + errMsg_(err), 'error');
  } finally {
    okBtn.disabled = false;
    closeConfirm_();
  }
});

/* =========================================================
   投稿フォーム
========================================================= */
const btnSubmitPin = $('#btn-submit-pin');
const inputCategory = $('#input-category');
const inputDetail = $('#input-detail');
const submitStatus = $('#submit-status');
const fabPost = $('#fab-post');

function setSubmitStatus(text, kind){
  submitStatus.textContent = text || '';
  submitStatus.className = 'status-line' + (kind ? ' ' + kind : '');
}

function updateSteps(done3){
  const has1 = !!state.pendingLatLng;
  const has2 = has1 && inputDetail.value.trim().length > 0;
  $$('#steps li').forEach(li => {
    const n = li.dataset.step;
    li.classList.toggle('done', !!done3 || (n === '1' && has1) || (n === '2' && has2));
  });
}
inputDetail.addEventListener('input', () => {
  $('#detail-count').textContent = inputDetail.value.length + ' / 200';
  updateSteps();
});

function updateFab(){
  const show = !!state.pendingLatLng && currentTarget === 'view-map' && !sheet.classList.contains('open');
  fabPost.classList.toggle('show', show);
}
fabPost.addEventListener('click', () => {
  $('#post-panel').scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
  setTimeout(() => inputDetail.focus({ preventScroll: true }), 450);
});

btnSubmitPin.addEventListener('click', async () => {
  if (!state.pendingLatLng) return;

  const pinData = {
    lat: state.pendingLatLng.lat,
    lng: state.pendingLatLng.lng,
    category: inputCategory.value,
    detail: inputDetail.value.trim()
  };

  btnSubmitPin.disabled = true;
  btnSubmitPin.classList.add('is-loading');
  setSubmitStatus('投稿を保存しています…');

  try {
    const saved = await callApi('addPin', pinData, getClientId());

    // 削除用の鍵は、投稿した端末にだけ保存する
    const tokens = getTokens();
    tokens[saved.id] = saved.ownerToken;
    store.set('kbm_tokens', tokens);
    delete saved.ownerToken;

    state.pins[saved.id] = saved;
    state.sig = '';
    if (pendingMarker) { editMap.removeLayer(pendingMarker); pendingMarker = null; }
    state.pendingLatLng = null;
    renderPins();
    renderStats();

    updateSteps(true);
    setTimeout(() => updateSteps(false), 2200);
    inputDetail.value = '';
    $('#detail-count').textContent = '0 / 200';
    $('#coord-text').textContent = '地図をタップすると座標が表示されます';
    $('#coord-readout').classList.remove('is-set');
    setSubmitStatus('投稿を保存しました。「みんなの危険マップ」にも反映されます。', 'ok');
    updateFab();
    openSheet(saved.id, 'edit');
    toast('投稿を保存しました。', 'ok');      // シートを開いたあとに出して、シートの上に重ならないようにする
  } catch (err) {
    btnSubmitPin.disabled = false;
    setSubmitStatus('保存に失敗しました: ' + errMsg_(err), 'error');
  } finally {
    btnSubmitPin.classList.remove('is-loading');
  }
});

(function renderEditLegend(){
  $('#edit-legend').innerHTML = CATEGORY_ORDER.map(cat => {
    const m = CATEGORY_META[cat];
    return '<li><span class="glyph" aria-hidden="true" style="--c:' + m.color + '">' + m.short + '</span>' + escapeHtml_(m.label) + '</li>';
  }).join('');
})();

/* =========================================================
   引っ張って更新（プルトゥリフレッシュ）
   ・地図の外（見出しやツールバーの余白）を、ページ最上部から下へ引く
   ・地図の上は、これまでどおり地図のドラッグに使われる
========================================================= */
const ptr = $('#ptr');
const ptrText = $('#ptr-text');
const mainEl = $('#main');
const PTR_THRESHOLD = 64, PTR_MAX = 120;
let ptrRefreshing = false;

function setPull(px){
  ptr.style.setProperty('--pull', px);
  mainEl.style.transform = px ? 'translateY(' + (px * 0.8).toFixed(1) + 'px)' : '';
}
function setPtrIcon(name){ ptr.querySelector('use').setAttribute('href', '#i-' + name); }
function resetPull(){
  ptr.classList.remove('pulling', 'ready', 'refreshing', 'done');
  document.body.classList.remove('ptr-active');
  ptrText.textContent = '下に引っ張って更新';
  setPtrIcon('refresh-cw');
  setPull(0);
}

(function initPullToRefresh(){
  let startY = 0, startX = 0, pulling = false, locked = false, dist = 0, wasReady = false;

  function eligible(target){
    if (ptrRefreshing) return false;
    if (currentTarget !== 'view-public-map' && currentTarget !== 'view-map') return false;
    if (window.scrollY > 0 || drawer.classList.contains('open')) return false;
    return !target.closest('.leaflet-container, .sheet, .drawer, select, textarea, input, .menu-btn');
  }

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || !eligible(e.target)) return;
    startY = e.touches[0].clientY; startX = e.touches[0].clientX;
    pulling = true; locked = false; dist = 0; wasReady = false;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    const dx = Math.abs(e.touches[0].clientX - startX);
    if (!locked) {
      if (Math.abs(dy) < 8 && dx < 8) return;
      if (dy < 0 || dx > Math.abs(dy)) { pulling = false; return; }     // 上向き・横向きの操作は対象外
      locked = true;
      ptr.classList.add('pulling');
      document.body.classList.add('ptr-active');
    }
    dist = Math.min(PTR_MAX, dy * 0.5);                                   // 引くほど重くなる
    if (e.cancelable) e.preventDefault();
    setPull(dist);
    const ready = dist >= PTR_THRESHOLD;
    if (ready !== wasReady) {
      wasReady = ready;
      ptr.classList.toggle('ready', ready);
      ptrText.textContent = ready ? '離して更新' : '下に引っ張って更新';
      if (ready && navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
    }
  }, { passive: false });

  function end(){
    if (!pulling) return;
    pulling = false;
    if (!locked) return;
    ptr.classList.remove('pulling');
    if (dist >= PTR_THRESHOLD) doRefresh(); else resetPull();
  }
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);

  async function doRefresh(){
    ptrRefreshing = true;
    ptr.classList.remove('ready'); ptr.classList.add('refreshing');
    ptrText.textContent = '更新中…';
    setPull(PTR_THRESHOLD);
    let ok = true;
    try { await fetchPins(true, { silent: true }); } catch (err) { ok = false; }
    ptr.classList.remove('refreshing');
    if (ok) { ptr.classList.add('done'); setPtrIcon('check'); ptrText.textContent = '更新しました'; }
    else { ptrText.textContent = '更新できませんでした'; }
    setTimeout(() => { resetPull(); ptrRefreshing = false; }, 900);
  }
  window._doRefresh = doRefresh;   // 動作確認用
})();

$('#btn-refresh').addEventListener('click', () => fetchPins(true).catch(() => {}));
$('#btn-refresh-2').addEventListener('click', () => fetchPins(true).catch(() => {}));

/* ---------- 起動時の初期化 ---------- */
ensurePublicMap();
setTimeout(() => publicMap && publicMap.invalidateSize(), 120);
fetchPins(false).catch(() => {});
// 表示中は2分ごとにそっと更新（内容が変わったときだけ再描画）
setInterval(() => {
  if (!document.hidden && !sheet.classList.contains('open') && (currentTarget === 'view-public-map' || currentTarget === 'view-map')) fetchPins(false).catch(() => {});
}, 120000);


/* =========================================================
   クイズ問題データ（カテゴリ別）
========================================================= */
const QUIZ_BANK = {

  basic: {
    label: '基本ルール',
    description: '車道通行・歩道の走り方など、まず押さえたい基本。',
    questions: [
      {
        question: '自転車が車道を走るとき、原則としてどちら側を通行しますか？',
        options: [
          '道路の右側端',
          '道路の左側端',
          '道路の中央',
          '決まりはない'
        ],
        correctIndex: 1,
        explanation: '自転車は軽車両として扱われ、車道のある道路では左側端を通行するのが原則です。右側通行は対向車との正面衝突の危険を高めます。'
      },
      {
        question: '歩道を自転車で通行してよい場合、どのように走るべきですか？',
        options: [
          'できるだけスピードを出して素早く通過する',
          '車道寄りを徐行し、歩行者を優先する',
          '歩道の中央を自由に走ってよい',
          'ベルを鳴らして歩行者をどかせる'
        ],
        correctIndex: 1,
        explanation: '歩道はあくまで歩行者のための空間です。自転車で通行できる場合も車道寄りを徐行し、歩行者の通行を妨げないようにする必要があります。'
      },
      {
        question: '次のうち、自転車運転中に禁止されている行為はどれですか？',
        options: [
          '一時停止',
          '傘をさしながらの片手運転',
          'ライトの点灯',
          '車道左側端の通行'
        ],
        correctIndex: 1,
        explanation: '傘をさしながらの片手運転はハンドル操作が不安定になり危険なため禁止されています。スマートフォンを見ながらの運転も同様に禁止です。'
      },
      {
        question: '自転車の飲酒運転についての説明で正しいものはどれですか？',
        options: [
          '自転車は車両ではないので飲酒運転は問題ない',
          '少量なら問題ない',
          '自転車も車両にあたり、飲酒運転は禁止されている',
          '押して歩けば飲酒運転にならない'
        ],
        correctIndex: 2,
        explanation: '自転車も車両の一種であり、飲酒運転は禁止されています。バランス感覚や判断力が低下した状態での走行は非常に危険です。'
      },
      {
        question: '2台の自転車が横に並んで走る「並走」について正しいのはどれですか？',
        options: [
          '「並進可」の標識がある道路以外では禁止されている',
          'どんな道路でも自由に並走できる',
          '夜間のみ禁止されている',
          '子どもと大人なら並走してよい'
        ],
        correctIndex: 0,
        explanation: '並走は「並進可」の標識がある道路でのみ認められています。それ以外の道路では、車道の幅を占有し他の交通の妨げになるため禁止です。'
      },
      {
        question: '自転車が歩道を通行できるのは、次のうちどの場合ですか？',
        options: [
          '歩道に「普通自転車歩道通行可」の標識があるとき',
          '車道が混んでいて急いでいるとき',
          '夜になって車道が暗いとき',
          '歩行者が一人もいないとき'
        ],
        correctIndex: 0,
        explanation: '歩道は歩行者のための場所で、自転車は車道を通行するのが原則です。「普通自転車歩道通行可」の標識があるとき、運転者が13歳未満・70歳以上・身体の不自由な人のとき、車道の状況からやむを得ないときに限って通行できます。'
      },
      {
        question: '自転車の二人乗りについて、正しい説明はどれですか？',
        options: [
          '短い距離なら、誰を乗せてもよい',
          '友達どうしなら、荷台に乗せてよい',
          '大人が運転するなら、何人でも乗せてよい',
          '原則禁止。ただし幼児用座席に6歳未満の子どもを乗せる場合などは例外'
        ],
        correctIndex: 3,
        explanation: '自転車の二人乗りは原則として禁止です。例外として、16歳以上の運転者が、6歳未満の子どもを幼児用の座席に乗せる場合などが認められています。'
      },
      {
        question: '自転車に乗りながらスマートフォンを使うことについて、正しい説明はどれですか？',
        options: [
          '片手で持っていれば、使ってもよい',
          '歩道を走っているときなら、使ってもよい',
          '通話や画面の注視は禁止されていて、罰則もある',
          '短い時間なら、画面を見ながら走ってもよい'
        ],
        correctIndex: 2,
        explanation: '自転車に乗りながらの通話や画面の注視（ながらスマホ）は禁止です。2024年11月から罰則が設けられ、事故の危険を生じさせた場合はさらに重くなります。歩道でも、短い時間でも同じです。'
      },
      {
        question: '車道を走る自転車が従うべき信号は、次のうちどれですか？',
        options: [
          '歩行者用の信号だけ',
          '自動車と同じ、車両用の信号',
          '青信号のときだけ従えばよい',
          'どの信号にも従わなくてよい'
        ],
        correctIndex: 1,
        explanation: '自転車は軽車両なので、車道を走るときは自動車と同じ車両用の信号に従います。歩道を通行するときや、「歩行者・自転車専用」の信号機があるときは、そちらに従います。'
      },
      {
        question: '自転車のベル（警音器）を鳴らしてよいのは、どんな場合ですか？',
        options: [
          '「警笛鳴らせ」の標識がある場所や、危険を避けるためにやむを得ないとき',
          '前の歩行者に、道をあけてもらいたいとき',
          '前の自転車を追い越したいとき',
          '友達にあいさつするとき'
        ],
        correctIndex: 0,
        explanation: 'ベルは、「警笛鳴らせ」の標識がある場所や、危険を防ぐためにやむを得ないときだけ鳴らします。歩行者に道をあけさせるために鳴らすのは違反です。速度を落として通り過ぎるか、降りて押して歩きましょう。'
      },
      {
        question: '自転車から降りて、押して歩いているとき、その人は法律上どのように扱われますか？',
        options: [
          'これまでどおり軽車両として扱われる',
          '歩行者でも自転車でもない特別な扱いになる',
          '原動機付自転車として扱われる',
          '歩行者として扱われる'
        ],
        correctIndex: 3,
        explanation: '自転車を押して歩いている人は歩行者として扱われ、歩道などを通行できます。混雑した歩道や自転車で通れない場所では、降りて押して歩くのが安全です。'
      },
      {
        question: '自転車で歩行者と接触してケガをさせてしまいました。まず何をすべきですか？',
        options: [
          '相手が「大丈夫」と言えば、そのまま立ち去ってよい',
          '急いでいるので、あとで連絡すると伝えて離れる',
          'すぐに止まって負傷者を救護し、警察に連絡する',
          '連絡先だけ伝えて、その場を離れる'
        ],
        correctIndex: 2,
        explanation: '事故を起こしたら、すぐに止まって負傷者を救護し、警察に報告する義務があります。これらを果たさずに立ち去ると、ひき逃げとして扱われます。自転車の事故でも、自動車と同じです。'
      },
      {
        question: '道路交通法では、自転車はどのような乗り物として扱われますか？',
        options: [
          '歩行者と同じ扱い',
          '軽車両（車両の一種）',
          '原動機付自転車の一種',
          '特別な決まりのない乗り物'
        ],
        correctIndex: 1,
        explanation: '自転車は道路交通法上の「軽車両」で、車両の仲間です。そのため、信号や標識に従い、車道の左側を通行するなど、自動車と同じように交通ルールを守る必要があります。'
      },
      {
        question: '自転車を止めるときの行動として、正しいものはどれですか？',
        options: [
          '駐輪場など決められた場所に止め、歩行者の通行や点字ブロックをふさがない',
          '短い時間なら、歩道の真ん中に止めてよい',
          '点字ブロックの上は平らなので、止めてよい',
          '店の前なら、どこに止めてもよい'
        ],
        correctIndex: 0,
        explanation: '自転車は駐輪場など決められた場所に止めます。歩道や点字ブロックの上に止めると、歩行者や目の不自由な人、車いすの人の通行をさまたげて危険です。'
      },
      {
        question: '2026年4月から始まった自転車の「青切符」制度について、正しい説明はどれですか？',
        options: [
          '自転車の違反は、これまでどおり罰則がない',
          '13歳未満の子どもだけが対象になる',
          '自転車に乗る人全員が、毎年お金を納める制度',
          '16歳以上の自転車運転者の一定の交通違反に、反則金を納める制度'
        ],
        correctIndex: 3,
        explanation: '青切符は、一定の交通違反をした16歳以上の自転車運転者に反則金を納めてもらう制度で、2026年4月1日に始まりました。「知らなかった」では済まされないため、ルールを正しく覚えておきましょう。'
      }
    ]
  },

  signs: {
    label: '標識・標示',
    description: '道路標識や路面表示が示す意味を確認しよう。',
    questions: [
      {
        question: '「自転車専用」の標識がある道路の意味として正しいのはどれですか？',
        options: [
          '自転車だけが通行できる道路である',
          '自転車の通行が禁止されている',
          '自転車は歩道のみ通行できる',
          '自転車は押して歩く必要がある'
        ],
        correctIndex: 0,
        explanation: '「自転車専用」の標識は、その道路（または車線）が自転車のためだけに使われることを示しています。'
      },
      {
        question: '赤い縁の丸の中に自転車の絵が描かれた標識が示す意味はどれですか？',
        options: [
          '自転車専用道路',
          '自転車通行止め',
          '自転車駐輪場',
          '自転車優先道路'
        ],
        correctIndex: 1,
        explanation: '赤い縁の丸い標識は「禁止」を表します。自転車の絵が描かれたこの標識は、自転車の通行を禁止する「自転車通行止め」です。青い丸に自転車の標識は「自転車専用」を表すので、色の違いに注意しましょう。'
      },
      {
        question: '道路上に描かれた矢印付きの青い自転車マーク（自転車ナビマーク）の役割は何ですか？',
        options: [
          '自転車が走行すべき進行方向を示す',
          '駐輪禁止を示す',
          '自転車の速度制限を示す',
          '歩行者専用道路であることを示す'
        ],
        correctIndex: 0,
        explanation: '自転車ナビマークは、車道のどの位置をどちら向きに走ればよいかを示す路面表示で、車道混在区間などに設置されます。'
      },
      {
        question: '「止まれ」の標識がある交差点で、自転車はどうする必要がありますか？',
        options: [
          '徐行すれば通過してよい',
          '一時停止して安全を確認する',
          '自転車には関係ない標識である',
          '歩道に上がれば止まらなくてよい'
        ],
        correctIndex: 1,
        explanation: '「止まれ」の標識は車両に対する一時停止の指示であり、軽車両である自転車も従う義務があります。'
      },
      {
        question: '「一方通行」の標識に「軽車両を除く」の補助標識がついている道路では、自転車はどうできますか？',
        options: [
          '一方通行の向きにしか通行できない',
          '標識が示す向きと反対方向にも通行できる',
          '自転車は通行できない',
          '歩道だけ通行できる'
        ],
        correctIndex: 1,
        explanation: '「軽車両を除く」の補助標識は、自転車などの軽車両には一方通行の規制がかからないことを表します。この場合、自転車は両方向に通行できます。補助標識がないときは、自転車も一方通行を守る必要があります。'
      },
      {
        question: '青い丸に歩行者の絵が描かれた「歩行者専用」の標識がある道路では、自転車はどうすべきですか？',
        options: [
          '自転車を降りて、押して歩く',
          'ゆっくり乗ったまま通行してよい',
          'ベルを鳴らしながら通行する',
          '自転車は、いつでも通行できる'
        ],
        correctIndex: 0,
        explanation: '歩行者専用の道路は、自転車などの車両は乗ったまま通行できません。通行したいときは、自転車を降りて押して歩きます（歩行者として扱われます）。'
      },
      {
        question: '自転車の絵が描かれた青い四角形の「自転車横断帯」の標識は、何を示していますか？',
        options: [
          '自転車の駐輪場',
          '自転車が一時停止する場所',
          '歩行者が道路を横断する場所',
          '自転車が道路を横断するときに通る場所'
        ],
        correctIndex: 3,
        explanation: '自転車横断帯は、自転車が道路を横断するために通る場所です。近くにあるときは、そこを通って横断します。歩行者が渡る横断歩道とは別の場所です。'
      },
      {
        question: '黄色いひし形（ダイヤ形）の標識は、どんな意味ですか？',
        options: [
          'この先で通行が禁止されていることを示す',
          'この先で必ず一時停止することを示す',
          'この先に注意が必要な場所があることを知らせる',
          'この先が自転車専用道路であることを示す'
        ],
        correctIndex: 2,
        explanation: '黄色いひし形の標識は「警戒標識」といい、踏切・すべりやすい路面・合流など、この先に注意が必要な場所や状況を知らせます。速度を落として、注意して進みましょう。'
      },
      {
        question: '赤い縁の丸い標識は、多くの場合どのような意味を表しますか？',
        options: [
          '通行できることを案内する',
          'してはいけないこと（禁止）や制限',
          'この先に危険があること',
          '道路の名前や行き先'
        ],
        correctIndex: 1,
        explanation: '赤い縁の丸い標識は、通行止めや駐車禁止などの「禁止・制限」を表します。青い丸の標識は「その方法で通行しなさい」という指定、黄色いひし形の標識は「注意」を表します。'
      },
      {
        question: '車道の左端に設けられた「自転車通行帯」について、正しい説明はどれですか？',
        options: [
          '自転車はその通行帯を走る。自動車は原則として入れない',
          '自転車は、通行帯の外側の車線を走る',
          '歩行者のための通行帯である',
          '自動車と自転車が自由に走ってよい'
        ],
        correctIndex: 0,
        explanation: '自転車通行帯は、車道の左端に自転車が走る場所として区切られたレーンで、標識や路面の自転車マークなどで示されます。自転車はこの通行帯を走り、自動車は原則として通行帯に入れません。'
      },
      {
        question: '青い丸に自転車と歩行者の絵が並んだ「自転車および歩行者専用」の標識がある道路では、自転車はどうしますか？',
        options: [
          '歩行者専用なので、必ず降りて押して歩く',
          '歩行者を追い越すため、速度を上げて走る',
          '自転車だけが通行できる',
          '通行できるが、歩行者に配慮して走る'
        ],
        correctIndex: 3,
        explanation: '「自転車および歩行者専用」の道路は、自転車と歩行者だけが通行できます。自転車は歩行者の通行をさまたげないよう、速度を落として走ります。自動車やバイクは通行できません。'
      },
      {
        question: '「止まれ」の標識で一時停止したあと、左右の見通しが悪いときは、自転車はどうしますか？',
        options: [
          '一度止まったので、そのまま速度を上げて通過する',
          'ベルを鳴らして、周りに知らせながら進む',
          '見通しのきく場所までゆっくり進み、もう一度安全を確認する',
          '相手が止まってくれるはずなので、そのまま進む'
        ],
        correctIndex: 2,
        explanation: '「止まれ」では、停止線の手前で止まります。そこから左右が見えないときは、徐行して見通しのきく場所まで進み、もう一度止まって安全を確認します。「相手が止まってくれる」と思い込まないことが大切です。'
      },
      {
        question: '赤い縁の白い丸だけが描かれた「車両通行止め」の標識がある道路で、自転車はどうなりますか？',
        options: [
          '自転車は車両ではないので、乗ったまま通行できる',
          '自転車も車両なので、乗ったままでは通行できない',
          '時速10km以下なら、乗ったまま通行できる',
          '夜間だけ、乗ったまま通行できる'
        ],
        correctIndex: 1,
        explanation: '「車両通行止め」は、自動車だけでなく自転車などの軽車両も通行できません。通りたいときは、自転車を降りて押して歩きます（歩行者として扱われます）。'
      },
      {
        question: '道路の端にある白線の「歩行者用路側帯」（白線が2本）について、自転車の通行で正しいのはどれですか？',
        options: [
          '自転車は通行できない。通るときは降りて押して歩く',
          '自転車も左側であれば、乗ったまま通行できる',
          '自転車は、路側帯の右側を通行する',
          '自転車は、速度を落とせば通行できる'
        ],
        correctIndex: 0,
        explanation: '路側帯のうち、白線が2本引かれた「歩行者用路側帯」は、歩行者のための場所で、自転車は乗って通行できません。白線が1本の路側帯は、道路の左側のものに限って通行できます。'
      },
      {
        question: '一方通行の出口側にある、赤い丸の中央に白い横線がある標識（車両進入禁止）の意味はどれですか？',
        options: [
          'この先で一時停止する',
          'この先は自転車専用道路になる',
          'この先で自転車を止めてよい',
          'この方向から、自転車を含む車両は入れない'
        ],
        correctIndex: 3,
        explanation: '赤い丸に白い横線の標識は「車両進入禁止」で、一方通行の出口側などに設置され、その方向から車両が入ることを禁止します。自転車も車両なので、乗ったままでは進入できません。'
      }
    ]
  },

  crossing: {
    label: '交差点・進路',
    description: '右左折や踏切など、進路の判断が必要な場面。',
    questions: [
      {
        question: '見通しの悪い交差点に近づいたとき、自転車はどうすべきですか？',
        options: [
          'スピードを上げて早く通過する',
          '速度を落とし、必要に応じて一時停止して安全確認する',
          '対向車や歩行者に道を譲らせる',
          '目をつぶって通過する'
        ],
        correctIndex: 1,
        explanation: '見通しの悪い交差点では速度を落とし、必要であれば一時停止して左右を確認することが事故防止につながります。'
      },
      {
        question: '自転車が交差点を右折するとき、原則として行うべき方法はどれですか？',
        options: [
          '車と同じように斜めに右折する',
          '交差点の向こう側まで直進してから向きを変える「二段階右折」',
          '右折はせず必ずUターンする',
          '歩道を斜めに突っ切る'
        ],
        correctIndex: 1,
        explanation: '自転車は軽車両のため、交差点では車のように斜めに右折せず、交差点を直進してから向きを変える二段階右折を行うのが原則です。'
      },
      {
        question: '踏切の手前で自転車が行うべきことは何ですか？',
        options: [
          '速度を落とさず一気に通過する',
          '一時停止して安全を確認する',
          '踏切の遮断機が下りていなければ確認不要',
          '自転車を降りる必要は一切ない'
        ],
        correctIndex: 1,
        explanation: '踏切の手前では車と同じく一時停止し、電車が来ていないか、遮断機や警報の状態を確認してから渡る必要があります。'
      },
      {
        question: '歩行者用信号が点滅を始めたとき、横断歩道の手前にいる自転車はどうすべきですか？',
        options: [
          '急いで渡り切る',
          '無理に渡らず、次の青信号を待つ',
          '車道を走っているので関係ない',
          'ベルを鳴らしながら渡る'
        ],
        correctIndex: 1,
        explanation: '信号が点滅している場合は青信号の終わりが近いサインです。無理に渡ろうとせず、次の青信号を待つほうが安全です。'
      },
      {
        question: '路地から広い道路に出るとき、自転車が最初に行うべきことは何ですか？',
        options: [
          '一時停止して左右の安全を確認する',
          'そのままの速度で進入する',
          'ベルを鳴らせば確認は不要',
          '広い道路の車が必ず止まってくれる'
        ],
        correctIndex: 0,
        explanation: '見通しの悪い路地から広い道路に出る際は、必ず一時停止して左右の安全を確認してから進入することが基本です。'
      },
      {
        question: '交差点を直進する自転車が、左折しようとする自動車の横を走るのが危険なのはなぜですか？',
        options: [
          '自動車の排気ガスを吸い込むから',
          '自転車のブレーキが効きにくくなるから',
          '自動車の左側に巻き込まれるおそれがあるから',
          '自動車のライトがまぶしいから'
        ],
        correctIndex: 2,
        explanation: '左折する自動車は、運転席から左後ろが見えにくく、自転車を巻き込む事故が起きやすくなります。左折しようとする自動車がいるときは、横を走らず、止まって先に行かせるのが安全です。'
      },
      {
        question: '二段階右折をするとき、交差点の向こう側に着いたあとはどうしますか？',
        options: [
          '止まらずに、そのまま右へ曲がり続ける',
          '左端で止まって向きを変え、進む方向の信号が青になるのを待つ',
          '歩道に上がって、信号を待つ',
          '向きを変えずに、後ろの自動車の信号に従う'
        ],
        correctIndex: 1,
        explanation: '二段階右折は、まず信号が青のうちに交差点の向こう側の左端まで直進し、そこで止まって進む方向へ向きを変えます。そして、進む方向の信号が青になるのを待ってから渡ります。'
      },
      {
        question: '横断歩道を渡ろうとしている歩行者がいるとき、自転車はどうすべきですか？',
        options: [
          '一時停止して、歩行者を先に通す',
          'ベルを鳴らして、歩行者に急いでもらう',
          '歩行者の前を、素早く通り抜ける',
          '歩行者に近づいて、様子を見ながら進む'
        ],
        correctIndex: 0,
        explanation: '横断歩道を渡る歩行者や、渡ろうとする歩行者がいるときは、自転車も一時停止して歩行者を優先します。横断歩道は、自転車を降りて押して渡るとより安全です。'
      },
      {
        question: '自転車で交差点に近づいたとき、信号が黄色に変わりました。どうすべきですか？',
        options: [
          '「急げ」の合図なので、速度を上げて渡る',
          '赤になるまでは、いつも通り進んでよい',
          '歩行者用の信号が青なら、進んでよい',
          '安全に止まれないほど近い場合を除き、停止線の手前で止まる'
        ],
        correctIndex: 3,
        explanation: '黄色信号は「止まれ」の合図です。停止線の手前で安全に止まれるなら止まります。止まれないほど近づいているときだけ、周りを確認して通過します。急ブレーキで転ばないよう、早めに速度を落とすことが大切です。'
      },
      {
        question: '熊本市電の線路（軌道）を横切るとき、タイヤが溝にはまって転ばないための方法はどれですか？',
        options: [
          '線路と平行に近い角度で、斜めに渡る',
          'スピードを上げて、勢いよく渡る',
          '線路に対して、できるだけ直角に近い角度で渡る',
          '線路の上をしばらく走ってから渡る'
        ],
        correctIndex: 2,
        explanation: '線路の溝に細いタイヤが挟まると、転倒する危険があります。線路には、できるだけ直角に近い角度で渡りましょう。雨の日は線路がぬれて滑りやすいので、ブレーキや急なハンドル操作に特に注意が必要です。'
      },
      {
        question: '道路に停まっている自動車のすぐ横を通るとき、特に注意すべきことは何ですか？',
        options: [
          '自動車の真横ぎりぎりを、速く通り抜ける',
          'ドアが急に開くことがあるので、間隔をあけて速度を落とす',
          'ベルを鳴らして、運転者に知らせながら進む',
          '自動車の陰から人が出てくることはない'
        ],
        correctIndex: 1,
        explanation: '停まっている自動車の運転者や同乗者が、突然ドアを開けることがあります。また、車の陰から歩行者が出てくることもあります。十分に間隔をあけ、速度を落として通過しましょう。'
      },
      {
        question: '青信号で交差点を直進するとき、特に気をつけることは何ですか？',
        options: [
          '右折や左折をしてくる自動車がいないか確認する',
          '青信号なら安全なので、確認せずに進む',
          '自動車より先に通るため、速度を上げる',
          '歩行者用の信号だけを見ればよい'
        ],
        correctIndex: 0,
        explanation: '青信号でも、右折・左折してくる自動車がいます。交差点では速度を落として左右を確認し、「相手が止まってくれる」と思い込まないことが大切です。'
      },
      {
        question: '見通しの悪い交差点にあるカーブミラーについて、正しい使い方はどれですか？',
        options: [
          'ミラーに車が映らなければ、そのまま進んでよい',
          'ミラーがあるので、一時停止しなくてもよい',
          'ミラーは歩行者だけを映すので、車の確認には使えない',
          'ミラーで確認したうえで、一時停止して自分の目でも安全を確認する'
        ],
        correctIndex: 3,
        explanation: 'カーブミラーに映る像は、実際より小さく、距離も分かりにくくなります。ミラーだけに頼らず、必ず一時停止して、自分の目で左右を確認してから進みましょう。'
      },
      {
        question: '信号も標識もなく、道幅がほぼ同じ交差点で、左から車両が来ているとき、自転車はどうすべきですか？',
        options: [
          '自転車は小さいので、先に通ってよい',
          '右から来る車両が優先なので、左は気にしない',
          '左から来る車両が優先なので、その進行をさまたげない',
          'ベルを鳴らして、先に通る'
        ],
        correctIndex: 2,
        explanation: '信号や標識がなく、道幅がほぼ同じ交差点では、自分から見て左から来る車両が優先です（左方優先）。自転車も車両なので、左から来る車両の進行をさまたげてはいけません。'
      },
      {
        question: '自転車が交差点で左折するとき、正しい走り方はどれですか？',
        options: [
          '交差点の中央に寄ってから、大きく曲がる',
          'あらかじめ道路の左端に寄り、左端に沿って徐行しながら曲がる',
          '速度を落とさず、ななめに曲がる',
          '右側に寄ってから、急に曲がる'
        ],
        correctIndex: 1,
        explanation: '左折するときは、あらかじめ道路の左端に寄り、左端に沿って徐行して曲がります。歩行者や、後ろから来る自動車・自転車がいないか、振り返って確認することも大切です。'
      }
    ]
  },

  night: {
    label: '夜間・視認性',
    description: 'ライトや服装など、暗い時間帯の見え方に関わるルール。',
    questions: [
      {
        question: '日没後に自転車に乗るとき、必ず行うべきことは何ですか？',
        options: [
          'ライトを点灯する',
          'ベルを鳴らし続ける',
          'できるだけ速く走る',
          '何もしなくてよい'
        ],
        correctIndex: 0,
        explanation: '日没から日の出までの無灯火走行は法律違反です。ライトの点灯と反射材の活用は、周囲から自分を発見してもらうために重要です。'
      },
      {
        question: '夜間の自転車事故を減らすために有効な対策として正しいものはどれですか？',
        options: [
          '黒っぽい服装でなるべく目立たなくする',
          '反射材やタスキを身につけて視認性を高める',
          'できるだけライトを暗く調整する',
          '交差点ではライトを消す'
        ],
        correctIndex: 1,
        explanation: '反射材やタスキは車や歩行者からの被視認性を高め、夜間の事故防止に効果的です。暗い服装はかえって発見が遅れる原因になります。'
      },
      {
        question: '霧や大雨などで視界が悪いときの自転車走行で気をつけるべきことは何ですか？',
        options: [
          '普段より速度を上げて早く目的地に着く',
          '速度を落とし、車間・視界の確保を意識する',
          '傘をさしながら片手で運転する',
          '特に注意することはない'
        ],
        correctIndex: 1,
        explanation: '視界が悪い状況では自分にも周囲にも危険が及びやすいため、速度を落として慎重に走行することが重要です。'
      },
      {
        question: '自転車のライトについて正しい説明はどれですか？',
        options: [
          '前照灯（前のライト）だけあれば後ろは何もなくてよい',
          '前照灯に加えて尾灯や反射材で後方からの視認性も確保する必要がある',
          '住宅街ではライトをつけなくてよい',
          '満月の夜はライトが不要になる'
        ],
        correctIndex: 1,
        explanation: '前方を照らす前照灯だけでなく、後方の車などから気づいてもらうための尾灯や反射材の装備も、夜間走行の安全には欠かせません。'
      },
      {
        question: '昼間でも自転車のライトを点灯したほうがよいのは、どんなときですか？',
        options: [
          '晴れていて、見通しのよい道を走るとき',
          '信号待ちで止まっているとき',
          '友達と並んで走るとき',
          'トンネルの中や薄暗い場所を通るとき'
        ],
        correctIndex: 3,
        explanation: 'トンネルや薄暗い場所、雨や霧で見えにくいときは、昼間でもライトを点灯すると、周りから見つけてもらいやすくなります。ライトは「見る」ためだけでなく「見られる」ためにも大切です。'
      },
      {
        question: '「自分には道が見えるから、ライトはつけなくても大丈夫」という考え方について、正しいのはどれですか？',
        options: [
          '正しい。月明かりがあれば必要ない',
          '正しい。街灯のある道なら必要ない',
          '間違い。ライトは、周りから見つけてもらうためにも必要',
          '正しい。歩道を走るなら必要ない'
        ],
        correctIndex: 2,
        explanation: '夜間のライトは、前を照らすだけでなく、自動車や歩行者に自分の存在を知らせる役割があります。街灯や月明かりがある道でも、無灯火は見つけてもらえず、事故のもとです。'
      },
      {
        question: '夜間、自転車のライトを「点滅」モードだけにして走ることについて、正しいのはどれですか？',
        options: [
          '点滅のほうが目立つので、点滅だけで十分',
          '点滅だけでは灯火として足りないとされ、常時点灯が基本',
          '点滅のときは、前のライトを消してよい',
          '点滅は、歩道を走るときだけ使える'
        ],
        correctIndex: 1,
        explanation: '点滅ライトだけでは、法律で求められる「灯火」の要件を満たさないとされています。前のライトは常時点灯を基本にして、点滅は補助のライトとして使うのがおすすめです。'
      },
      {
        question: '雨の日の路面について、正しい説明はどれですか？',
        options: [
          '白線・マンホール・鉄板はぬれるとすべりやすいので、その上でのブレーキやカーブは避ける',
          '白線・マンホール・鉄板は、ぬれるとかえってすべりにくくなる',
          'ぬれた路面でも、乾いた路面と同じようにブレーキが効く',
          '雨の日は、急にハンドルを切ったほうが安全'
        ],
        correctIndex: 0,
        explanation: '横断歩道の白線、マンホール、工事用の鉄板などは、雨にぬれるととてもすべりやすくなります。その上でのブレーキや急なハンドル操作、急カーブは避けましょう。'
      },
      {
        question: '雨の日の自転車のブレーキについて、正しい説明はどれですか？',
        options: [
          '雨の日も、ブレーキの効きは変わらない',
          '前後のブレーキを一気に強く握るほうが止まりやすい',
          'ブレーキは使わず、足で止まる',
          'ブレーキが効くまでの距離が長くなるので、早めにブレーキをかける'
        ],
        correctIndex: 3,
        explanation: 'ぬれたブレーキやすべりやすい路面のため、雨の日は止まるまでの距離が長くなります。いつもより速度を落とし、余裕をもって早めにブレーキをかけましょう。'
      },
      {
        question: '雨の日の自転車に適した雨具はどれですか？',
        options: [
          '片手で傘をさしながら運転する',
          '裾が長くてひらひらする雨具',
          '視界をさえぎらず、裾や袖が車輪に巻き込まれにくい雨具',
          'フードを深くかぶって、視界が狭くなる雨具'
        ],
        correctIndex: 2,
        explanation: '雨の日に、傘をさしたり持ったりして運転するのは禁止です。視界をさえぎらず、裾や袖が車輪に巻き込まれにくい雨具を選び、両手でハンドルを持って走りましょう。'
      },
      {
        question: '夜に走っている途中、ライトの電池が切れてしまいました。どうすべきですか？',
        options: [
          '街灯のある道だけを選んで走る',
          '無灯火で走らず、安全な場所で電池を交換するか、押して歩く',
          'ゆっくり走れば、ライトなしでも走ってよい',
          '後ろの反射板だけで走る'
        ],
        correctIndex: 1,
        explanation: '夜間にライトをつけずに走る無灯火は違反で、とても危険です。ライトがつかないときは、無理に乗らず、安全な場所で電池を交換するか、自転車を押して歩きましょう。出かける前に、ライトが点くか確かめる習慣も大切です。'
      },
      {
        question: '夕方の薄暗い時間帯に、自転車の事故を減らすために有効な方法はどれですか？',
        options: [
          'まだ明るくても、早めにライトを点灯する',
          '真っ暗になるまで、ライトは点けない',
          '暗い色の服を着て、目立たないようにする',
          'いつもより速いスピードで走る'
        ],
        correctIndex: 0,
        explanation: '日が沈む前後の夕暮れどきは、自動車から自転車が見えにくく、事故が多い時間帯です。暗くなるのを待たずに早めにライトを点灯し、明るい色の服や反射材も使いましょう。'
      },
      {
        question: '自転車の前のライト（前照灯）の色として、多くの都道府県の規則で定められているのはどれですか？',
        options: [
          '赤色',
          '青色',
          '緑色',
          '白色か淡黄色'
        ],
        correctIndex: 3,
        explanation: '前のライトは白色か淡黄色で、前方約10m先の障害物が確認できる明るさが必要と、多くの都道府県の規則で定められています。後ろのライトや反射器材は、赤色が一般的です。'
      },
      {
        question: '強い風が吹いている日の自転車の走り方として、適切なのはどれですか？',
        options: [
          '速度を上げて、風に負けないように走る',
          '傘をさして、風を防ぎながら走る',
          '速度を落とし、横風でふらつく危険があるときは無理に乗らず押して歩く',
          '荷物をハンドルにかけて、重しにする'
        ],
        correctIndex: 2,
        explanation: '強風では、とくに横風にあおられてふらつき、車道側へ倒れる危険があります。速度を落とし、危険を感じるときは乗るのをやめて、押して歩きましょう。'
      },
      {
        question: '夜、自動車の運転者から自転車はどのように見えると考えて走るべきですか？',
        options: [
          '自転車は大きいので、必ず見えている',
          'ライトや反射材がないと見つけにくく、気づいてもらえないかもしれないと考える',
          '手を振れば、必ず気づいてもらえる',
          '自動車のライトが照らすので、必ず見えている'
        ],
        correctIndex: 1,
        explanation: '夜間は、自動車の運転者から歩行者や自転車が見つけにくくなります。「見えているはず」と思い込まず、ライトや反射材で存在を知らせ、交差点では特に注意しましょう。'
      }
    ]
  },

  maintenance: {
    label: '点検・整備・マナー',
    description: '車体の点検やヘルメット、子ども乗せなど装備面のポイント。',
    questions: [
      {
        question: '自転車に乗る前の日常点検で確認すべき項目として適切でないものはどれですか？',
        options: [
          'ブレーキの効き具合',
          'タイヤの空気圧',
          'ベルの音量の大きさ',
          'サドルやハンドルのがたつき'
        ],
        correctIndex: 2,
        explanation: 'ベルの音量は安全性に直接関わる項目ではありません。ブレーキやタイヤ、各部のがたつきは事故防止のために毎回確認すべき項目です。'
      },
      {
        question: 'ヘルメットの着用について、現在の努力義務の対象として正しいものはどれですか？',
        options: [
          '13歳未満の子どもだけが対象',
          '65歳以上の高齢者だけが対象',
          '年齢を問わず、すべての自転車利用者が対象',
          '長距離を走る人だけが対象'
        ],
        correctIndex: 2,
        explanation: '道路交通法の改正により、年齢を問わずすべての自転車利用者に対してヘルメット着用が努力義務とされています。'
      },
      {
        question: '幼児を自転車の幼児用座席に乗せるときに正しいのはどれですか？',
        options: [
          'シートベルトやヘルメットは特に必要ない',
          '幼児にもヘルメットを着用させ、ベルトでしっかり固定する',
          '荷台に直接座らせればよい',
          '片手で抱っこしながら運転すればよい'
        ],
        correctIndex: 1,
        explanation: '幼児用座席に乗せる場合も、幼児にヘルメットを着用させ、ベルトでしっかり固定することが転落や事故の防止につながります。'
      },
      {
        question: '自転車の防犯登録について正しい説明はどれですか？',
        options: [
          '任意であり、登録しなくても法律上まったく問題ない',
          '購入時などに義務づけられており、盗難時の確認にも役立つ',
          '登録すると保険に自動的に加入したことになる',
          '子どもの自転車には不要な制度である'
        ],
        correctIndex: 1,
        explanation: '防犯登録は法律で義務づけられており、盗難時に持ち主を確認する手がかりになります。年齢を問わずすべての自転車が対象です。'
      },
      {
        question: '自転車損害賠償責任保険（自転車保険）についての説明で正しいものはどれですか？',
        options: [
          'すべての都道府県で加入は任意である',
          '万が一の事故で歩行者などにケガをさせた場合の賠償に備えるものである',
          '自分の自転車が壊れたときの修理費だけをカバーする制度である',
          'ヘルメットを着用していれば加入は不要になる'
        ],
        correctIndex: 1,
        explanation: '自転車保険は、事故で相手にケガをさせてしまった場合などの高額な賠償責任に備えるための保険です。自治体によっては加入が義務化されています。'
      },
      {
        question: '乗る前のブレーキの点検として、適切なのはどれですか？',
        options: [
          '前後のレバーを握り、しっかり効くか確かめる',
          '音がしなければ、確認しなくてよい',
          '片方だけ確認すればよい',
          '効きが悪いときは、速度を上げて走ってごまかす'
        ],
        correctIndex: 0,
        explanation: 'ブレーキは前後とも、レバーを握ったときにしっかり効くかを確認します。効きが悪い、大きな音がする、ブレーキシューがすり減っているときは、乗らずに自転車店で整備してもらいましょう。'
      },
      {
        question: 'タイヤの空気が少ないまま走ると、どうなりやすいですか？',
        options: [
          '軽く走れて、ブレーキもよく効く',
          'タイヤがすり減りにくくなる',
          'ライトが明るくなる',
          'ペダルが重くなり、パンクもしやすくなる'
        ],
        correctIndex: 3,
        explanation: '空気が減るとタイヤがつぶれて、走りが重くなり、パンクもしやすくなります。ブレーキのときにふらつくなど、危険も増えます。定期的に空気の量を確認しましょう。'
      },
      {
        question: '自転車のチェーンの手入れとして、適切なのはどれですか？',
        options: [
          '油はたっぷり注いで、あふれさせておく',
          '水で洗ったら、油をささずに乾かす',
          '汚れをふき取り、ときどき専用の油をさす',
          'サビても、走れるうちは何もしない'
        ],
        correctIndex: 2,
        explanation: 'チェーンは、汚れをふき取ってから専用の油を適度にさすと、サビを防ぎ、走りが軽くなります。油をさしすぎるとほこりや泥がつきやすくなるので、余分な油はふき取ります。'
      },
      {
        question: '自転車に貼られている「TSマーク」の説明として、正しいのはどれですか？',
        options: [
          '盗まれたときの、防犯登録の証明',
          '自転車安全整備店で点検・整備を受けた自転車に貼られ、保険が付く',
          '自転車の最高速度を示すマーク',
          'ヘルメットの安全基準を表すマーク'
        ],
        correctIndex: 1,
        explanation: 'TSマークは、自転車安全整備店で有料の点検・整備を受けた自転車に貼られるマークです。有効期間は1年間で、賠償責任保険と傷害保険が付いています。年に1回は点検を受けましょう。'
      },
      {
        question: '自転車のサドルの高さの目安として、適切なのはどれですか？',
        options: [
          'サドルに座ったまま、両足のつま先が地面につく高さ',
          'サドルに座ると、両足が地面にまったく届かない高さ',
          'サドルに座ると、ひざが胸につくほど低い高さ',
          'ハンドルより高く、前に大きくかがむ高さ'
        ],
        correctIndex: 0,
        explanation: 'サドルが高すぎると、止まるときに足が届かず、不安定になって転びやすくなります。座ったままで、両足のつま先が地面につくくらいを目安に調整しましょう。'
      },
      {
        question: 'ヘルメットのかぶり方として、正しいのはどれですか？',
        options: [
          'あごひもは外して、頭にのせるだけにする',
          'ヘルメットを後ろにずらして、おでこを出す',
          'あごひもは、ゆるめにしておく',
          'あごひもをしっかり締めて、ぐらつかないようにかぶる'
        ],
        correctIndex: 3,
        explanation: 'ヘルメットは、おでこをしっかり覆うようにまっすぐかぶり、あごひもを締めて、前後左右にぐらつかないようにします。ゆるいと、転倒したときに外れて頭を守れません。'
      },
      {
        question: '一度大きな衝撃を受けたヘルメットは、どうするのがよいですか？',
        options: [
          '傷が見えなければ、そのまま使い続ける',
          'ひび割れだけテープで直して使う',
          '見た目に傷がなくても、内部が傷んでいるおそれがあるので交換する',
          '他の人にゆずって使ってもらう'
        ],
        correctIndex: 2,
        explanation: 'ヘルメットは、衝撃を吸収して頭を守る道具です。強い衝撃を受けたものは、見た目に傷がなくても内部が傷んでいることがあるので、交換しましょう。買うときは、SGマークなど安全基準を満たした製品が目安になります。'
      },
      {
        question: '自転車で歩行者にぶつかって大けがをさせてしまったとき、運転者に起こりうることとして正しいのはどれですか？',
        options: [
          '自転車は軽いので、賠償を求められることはない',
          '損害賠償を求められ、高額になる場合もある',
          '子どもが運転した場合は、誰も責任を問われない',
          '謝れば、賠償は必ず免除される'
        ],
        correctIndex: 1,
        explanation: '自転車の事故でも、相手にケガをさせれば損害賠償の責任が生じます。裁判で高額の賠償が命じられた例もあります。万が一に備えて、自転車保険などに加入しておくことが大切です。'
      },
      {
        question: '自転車の盗難を防ぐ方法として、有効なのはどれですか？',
        options: [
          '短い時間でも必ず鍵をかけ、できれば鍵を2つ以上つける',
          'すぐ戻るときは、鍵をかけなくてよい',
          '鍵はつけずに、目立つ場所に止める',
          '暗くて人通りのない場所のほうが、盗まれにくい'
        ],
        correctIndex: 0,
        explanation: '鍵をかけていない自転車は盗まれやすくなります。短い時間でも必ず鍵をかけ、できれば「ツーロック」といって2つ以上の鍵を使い、明るく人通りのある駐輪場に止めましょう。'
      },
      {
        question: '電動アシスト自転車のアシスト力は、時速何kmを超えるとゼロになるよう基準で決められていますか？',
        options: [
          '時速10km',
          '時速40km',
          '時速60km',
          '時速24km'
        ],
        correctIndex: 3,
        explanation: '電動アシスト自転車は、人がこぐ力を電動モーターで補助する自転車で、アシスト力は時速24kmを超えるとゼロになるよう基準で決められています。それ以上の速度は人の力で走るため、下り坂などでの出しすぎに注意しましょう。'
      }
    ]
  }
};

/* =========================================================
   交通安全クイズ（カテゴリ選択 → 出題 → 結果）
========================================================= */
const QUIZ_CATEGORY_ORDER = ['basic', 'signs', 'crossing', 'night', 'maintenance'];
const RANDOM_QUIZ_SIZE = 10;
const QUIZ_ICONS = { basic: 'bike', signs: 'info', crossing: 'map-pin', night: 'clock', maintenance: 'circle-check', random: 'trophy' };

let currentQuizKey = '';
let currentQuizQuestions = [];
let currentQuestionIndex = 0;
let correctCount = 0;
let answered = false;
let currentCategoryLabel = '';
let wrongQuestions = [];

const quizCategorySelect = $('#quiz-category-select');
const quizActiveWrap = $('#quiz-active-wrap');
const quizCategoryLabelEl = $('#quiz-category-label');
const btnQuizBack = $('#btn-quiz-back');
const quizProgressText = $('#quiz-progress-text');
const quizScoreText = $('#quiz-score-text');
const quizTrack = $('#quiz-track');
const quizTrackFill = $('#quiz-track-fill');
const quizBike = $('#quiz-bike');
const quizCard = $('#quiz-card');
const quizQno = $('#quiz-qno');
const quizQuestion = $('#quiz-question');
const quizOptions = $('#quiz-options');
const quizFeedback = $('#quiz-feedback');
const quizVerdict = $('#quiz-verdict');
const quizExplanation = $('#quiz-explanation');
const btnNextQuestion = $('#btn-next-question');
const nextLabel = $('#next-label');
const quizResult = $('#quiz-result');
const quizResultScore = $('#quiz-result-score');
const quizResultComment = $('#quiz-result-comment');
const quizReview = $('#quiz-review');
const ringFg = $('#ring-fg');
const ringNum = $('#ring-num');
const btnRetryQuiz = $('#btn-retry-quiz');
const btnRetryWrong = $('#btn-retry-wrong');
const btnOtherCategory = $('#btn-other-category');
const RING_LEN = 326.7;

function shuffleArray_(array){
  const result = array.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function getQuizBest(key){ return (store.get('kbm_quiz_best', {}) || {})[key] || null; }
function saveQuizBest(key, score, total){
  const all = store.get('kbm_quiz_best', {}) || {};
  const prev = all[key];
  if (!prev || score / total > prev.score / prev.total) {
    all[key] = { score: score, total: total };
    store.set('kbm_quiz_best', all);
  }
}

// 進み具合（バーと、ゴールへ向かう自転車）
function setQuizProgress(done){
  const total = currentQuizQuestions.length || 1;
  const pct = Math.round((done / total) * 100);
  quizTrackFill.style.width = pct + '%';
  quizBike.style.left = Math.min(Math.max(pct, 4), 96) + '%';
  quizTrack.setAttribute('aria-valuenow', String(pct));
}

/* ---------- カテゴリ選択 ---------- */
function categoryCardHtml_(key, name, desc, count, best, accent){
  return '<span class="cat-ico">' + ic(QUIZ_ICONS[key] || 'circle', 'icon-lg') + '</span>' +
    '<span class="cat-body">' +
      '<span class="cat-name">' + escapeHtml_(name) + '</span>' +
      '<span class="cat-desc">' + escapeHtml_(desc) + '</span>' +
      '<span class="cat-meta"><span class="chip">' + escapeHtml_(count) + '</span>' +
        (best ? '<span class="chip best">' + ic('trophy') + '自己ベスト ' + best.score + ' / ' + best.total + '</span>' : '') +
      '</span>' +
    '</span>' +
    ic('chevron-right', 'cat-arrow');
}

function renderCategorySelect(){
  quizCategorySelect.innerHTML = '';

  QUIZ_CATEGORY_ORDER.forEach((key, i) => {
    const cat = QUIZ_BANK[key];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'cat-card stagger-in';
    card.style.setProperty('--i', i);
    card.innerHTML = categoryCardHtml_(key, cat.label, cat.description, '全' + cat.questions.length + '問', getQuizBest(key));
    card.addEventListener('click', () => startQuiz(key));
    quizCategorySelect.appendChild(card);
  });

  const totalQuestions = QUIZ_CATEGORY_ORDER.reduce((sum, key) => sum + QUIZ_BANK[key].questions.length, 0);
  const randomCard = document.createElement('button');
  randomCard.type = 'button';
  randomCard.className = 'cat-card accent stagger-in';
  randomCard.style.setProperty('--i', QUIZ_CATEGORY_ORDER.length);
  randomCard.innerHTML = categoryCardHtml_('random', '総合ランダム' + RANDOM_QUIZ_SIZE + '問',
    '全カテゴリ（計' + totalQuestions + '問）からランダムに出題する腕試しモード。', '毎回内容が変わります', getQuizBest('random'));
  randomCard.addEventListener('click', () => startQuiz('random'));
  quizCategorySelect.appendChild(randomCard);
}

function startQuiz(categoryKey, customQuestions){
  currentQuizKey = categoryKey;

  if (customQuestions) {
    currentQuizQuestions = shuffleArray_(customQuestions);
  } else if (categoryKey === 'random') {
    const all = QUIZ_CATEGORY_ORDER.reduce((list, key) => list.concat(QUIZ_BANK[key].questions), []);
    currentQuizQuestions = shuffleArray_(all).slice(0, RANDOM_QUIZ_SIZE);
    currentCategoryLabel = '総合ランダム';
  } else {
    currentQuizQuestions = shuffleArray_(QUIZ_BANK[categoryKey].questions);   // 出題順もシャッフル
    currentCategoryLabel = QUIZ_BANK[categoryKey].label;
  }

  currentQuestionIndex = 0;
  correctCount = 0;
  wrongQuestions = [];

  quizCategoryLabelEl.textContent = currentCategoryLabel;
  quizCategorySelect.hidden = true;
  quizActiveWrap.hidden = false;
  quizResult.hidden = true;
  quizCard.hidden = false;
  ringFg.style.strokeDashoffset = String(RING_LEN);

  setQuizProgress(0);
  renderQuestion(true);
  window.scrollTo({ top: 0, behavior: prefersReduced ? 'auto' : 'smooth' });
}

function backToCategorySelect(){
  quizActiveWrap.hidden = true;
  quizCategorySelect.hidden = false;
  renderCategorySelect();
  const h1 = $('#h-quiz');
  if (h1) h1.focus({ preventScroll: true });
}

btnQuizBack.addEventListener('click', backToCategorySelect);
btnOtherCategory.addEventListener('click', backToCategorySelect);

/* ---------- 出題 ---------- */
function renderQuestion(focusQuestion){
  answered = false;
  const q = currentQuizQuestions[currentQuestionIndex];

  quizProgressText.textContent = '問題 ' + (currentQuestionIndex + 1) + ' / ' + currentQuizQuestions.length;
  quizScoreText.textContent = '正解 ' + correctCount + ' 問';
  setQuizProgress(currentQuestionIndex);

  quizQno.textContent = 'Q' + (currentQuestionIndex + 1);
  quizQuestion.textContent = q.question;
  quizOptions.innerHTML = '';
  quizFeedback.hidden = true;
  quizFeedback.className = 'q-feedback';
  btnNextQuestion.hidden = true;

  // 選択肢は毎回シャッフルして、位置では覚えられないようにする
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const choices = shuffleArray_(q.options.map((text, idx) => ({ text: text, correct: idx === q.correctIndex })));
  choices.forEach((choice, i) => {
    const optBtn = document.createElement('button');
    optBtn.type = 'button';
    optBtn.className = 'q-option';
    optBtn.style.setProperty('--i', i);
    optBtn.innerHTML = '<span class="q-letter" aria-hidden="true"><b>' + letters[i] + '</b>' + ic('check') + '</span><span class="q-text-opt"></span>';
    optBtn.querySelector('.q-text-opt').textContent = choice.text;
    optBtn.dataset.correct = choice.correct ? '1' : '0';
    optBtn.addEventListener('click', () => handleAnswer(choice.correct, optBtn));
    quizOptions.appendChild(optBtn);
  });

  // 問題が切り替わるたびに、カードをふわっと出し直す
  quizCard.classList.remove('enter');
  void quizCard.offsetWidth;
  quizCard.classList.add('enter');

  if (focusQuestion) {
    quizQuestion.setAttribute('tabindex', '-1');
    quizQuestion.focus({ preventScroll: true });
  }
}

function handleAnswer(isCorrect, selectedBtn){
  if (answered) return;
  answered = true;

  const q = currentQuizQuestions[currentQuestionIndex];
  const optionButtons = $$('.q-option', quizOptions);
  optionButtons.forEach(b => { b.disabled = true; });

  if (isCorrect) correctCount++;
  else wrongQuestions.push(q);

  selectedBtn.classList.add(isCorrect ? 'correct' : 'incorrect');
  if (!isCorrect) {
    const useEl = selectedBtn.querySelector('.q-letter use');
    if (useEl) useEl.setAttribute('href', '#i-x');
    const right = optionButtons.find(b => b.dataset.correct === '1');
    if (right) right.classList.add('correct');
  }
  optionButtons.forEach(b => {
    if (!b.classList.contains('correct') && !b.classList.contains('incorrect')) b.classList.add('dim');
  });

  quizVerdict.innerHTML = ic(isCorrect ? 'circle-check' : 'circle-x', 'icon-lg') + '<span>' + (isCorrect ? '正解です！' : '不正解です') + '</span>';
  quizExplanation.textContent = q.explanation;
  quizFeedback.className = 'q-feedback ' + (isCorrect ? 'ok' : 'ng');
  quizFeedback.hidden = false;

  quizScoreText.textContent = '正解 ' + correctCount + ' 問';
  setQuizProgress(currentQuestionIndex + 1);
  btnNextQuestion.hidden = false;
  nextLabel.textContent = (currentQuestionIndex === currentQuizQuestions.length - 1) ? '結果を見る' : '次の問題へ';

  // 解説が見える位置まで送り、次へ進むボタンにフォーカスを移す
  setTimeout(() => {
    btnNextQuestion.focus({ preventScroll: true });
    quizFeedback.scrollIntoView({ block: 'nearest', behavior: prefersReduced ? 'auto' : 'smooth' });
  }, 60);
}

btnNextQuestion.addEventListener('click', () => {
  currentQuestionIndex++;
  if (currentQuestionIndex >= currentQuizQuestions.length) showQuizResult();
  else {
    renderQuestion(true);
    quizCard.scrollIntoView({ block: 'nearest', behavior: prefersReduced ? 'auto' : 'smooth' });
  }
});

/* ---------- 結果 ---------- */
function showQuizResult(){
  const total = currentQuizQuestions.length;
  quizCard.hidden = true;
  quizResult.hidden = false;
  setQuizProgress(total);
  quizProgressText.textContent = '問題 ' + total + ' / ' + total;

  quizResultScore.textContent = correctCount + ' / ' + total + ' 問正解';

  let comment;
  if (correctCount === total) {
    comment = '満点です。「' + currentCategoryLabel + '」の内容をしっかり理解できています。';
  } else if (correctCount >= total - Math.ceil(total * 0.2)) {
    comment = 'よくできました。間違えた問題の解説を振り返っておきましょう。';
  } else {
    comment = '「' + currentCategoryLabel + '」の内容をもう一度確認してみましょう。';
  }
  quizResultComment.textContent = comment;

  // 円グラフ（リング）と数字を動かす
  const pct = Math.round((correctCount / total) * 100);
  ringNum.textContent = prefersReduced ? pct + '%' : '0%';
  ringFg.style.strokeDashoffset = String(RING_LEN);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ringFg.style.strokeDashoffset = String(RING_LEN * (1 - correctCount / total));
  }));
  if (!prefersReduced) {
    const t0 = performance.now(), dur = 1100;
    (function tick(now){
      const p = Math.min((now - t0) / dur, 1);
      ringNum.textContent = Math.round(pct * (1 - Math.pow(1 - p, 3))) + '%';
      if (p < 1) requestAnimationFrame(tick);
    })(t0);
  }

  // 間違えた問題の振り返り
  if (wrongQuestions.length > 0) {
    quizReview.hidden = false;
    quizReview.innerHTML = '<h3>' + ic('circle-x') + '間違えた問題（' + wrongQuestions.length + '問）</h3><ul>' +
      wrongQuestions.map(q =>
        '<li>' + escapeHtml_(q.question) + '<b>' + ic('circle-check') + '<span>答え：' + escapeHtml_(q.options[q.correctIndex]) + '</span></b></li>'
      ).join('') + '</ul>';
    btnRetryWrong.hidden = false;
  } else {
    quizReview.hidden = true;
    btnRetryWrong.hidden = true;
  }

  if (!currentQuizKey.startsWith('wrong:')) saveQuizBest(currentQuizKey, correctCount, total);

  quizResultScore.setAttribute('tabindex', '-1');
  quizResultScore.focus({ preventScroll: true });
  quizResult.scrollIntoView({ block: 'start', behavior: prefersReduced ? 'auto' : 'smooth' });
}

btnRetryQuiz.addEventListener('click', () => {
  const key = currentQuizKey.startsWith('wrong:') ? currentQuizKey.slice(6) : currentQuizKey;
  startQuiz(key);
});

btnRetryWrong.addEventListener('click', () => {
  if (wrongQuestions.length === 0) return;
  const baseKey = currentQuizKey.startsWith('wrong:') ? currentQuizKey.slice(6) : currentQuizKey;
  const baseLabel = currentCategoryLabel.replace(/（復習）$/, '');
  const retry = wrongQuestions.slice();
  currentCategoryLabel = baseLabel + '（復習）';
  startQuiz('wrong:' + baseKey, retry);
});

renderCategorySelect();


/* =========================================================
   ④ ◯✕ゲーム
   ・IIFEで包んでいるため、上のコードとは変数が一切干渉しません
   ・問題データは サーバーの /api/quiz から取得します
========================================================= */
(function(){
  'use strict';
 
  var LIMIT = 20;                       // 1問の制限時間（秒）
  var root  = document.getElementById('quizOxRoot');
  if (!root) return;
 
  var DATA  = null;                     // サーバーから受け取る {categories, questions}
  var state = {
    cat:null, queue:[], cur:null,
    streak:0, total:0, best:{},
    timer:null, left:LIMIT,
    inQuestion:false, paused:false
  };
 
  /* ---------- ユーティリティ ---------- */
  function esc(s){
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function catById(id){
    for (var i=0;i<DATA.categories.length;i++){
      if (DATA.categories[i].id === id) return DATA.categories[i];
    }
    return null;
  }
  function qsOf(id){
    return DATA.questions.filter(function(q){ return q.cat === id; });
  }
  function shuffle(a){
    a = a.slice();
    for (var i=a.length-1;i>0;i--){
      var j = Math.floor(Math.random()*(i+1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function stopTimer(){
    if (state.timer){ clearInterval(state.timer); state.timer = null; }
  }
  function keepBest(){
    if (state.cat && state.streak > (state.best[state.cat] || 0)){
      state.best[state.cat] = state.streak;
    }
  }
  // ページ全体ではなく、ゲーム枠の先頭に視点を戻す
  function scrollToTop(){
    if (root.getBoundingClientRect().top < 0){
      root.scrollIntoView({ block:'start', behavior: prefersReduced ? 'auto' : 'smooth' });
    }
  }
 
  /* ---------- スタート画面（分野選択） ---------- */
  function renderStart(msg){
    stopTimer();
    state.inQuestion = false;
 
    var h = '<h2 class="quizOxTitle">自転車の交通ルール<br>◯✕クイズ</h2>'
          + '<p class="quizOxLead">分野を選んでスタート。1問でも間違えるとそこで終了です。</p>'
          + '<div class="quizOxRoadline"></div>';
 
    if (msg){ h += '<p class="quizOxNotice">' + esc(msg) + '</p>'; }
 
    h += '<div class="quizOxCats">';
    DATA.categories.forEach(function(c){
      var n = qsOf(c.id).length;
      var b = state.best[c.id] || 0;
      h += '<button type="button" class="quizOxCat" data-quizox-act="start" data-quizox-cat="' + esc(c.id) + '">'
         +   '<span class="quizOxCatName">' + esc(c.name) + '</span>'
         +   '<span class="quizOxCatDesc">' + esc(c.desc) + '</span>'
         +   '<span class="quizOxCatCount">全' + n + '問'
         +     (b ? '　これまでの最高 ' + b + '問連続正解' : '')
         +   '</span>'
         + '</button>';
    });
    h += '</div>'
       + '<div class="quizOxNote">'
       +   '<p><b>ルール</b>　1問' + LIMIT + '秒。時間切れも不正解です。間違えるとスコアはリセットされ、この画面に戻ります。</p>'
       +   '<p>' + esc(DATA.source || '') + '</p>'
       + '</div>';
 
    root.innerHTML = h;
    scrollToTop();
  }
 
  /* ---------- 出題 ---------- */
  function start(catId){
    state.cat    = catId;
    state.queue  = shuffle(qsOf(catId));
    state.streak = 0;
    state.total  = state.queue.length;
    nextQuestion();
  }
 
  function nextQuestion(){
    if (state.queue.length === 0){ return renderClear(); }
    state.cur  = state.queue.shift();
    state.left = LIMIT;
    state.inQuestion = true;
    renderQuestion();
    runTimer();
  }
 
  function runTimer(){
    stopTimer();
    if (state.paused) return;           // 他タブ表示中はカウントしない
    state.timer = setInterval(function(){
      state.left--;
      updateTimerView();
      if (state.left <= 0){
        stopTimer();
        state.inQuestion = false;
        renderJudge(null);              // 時間切れ＝不正解
      }
    }, 1000);
  }
 
  function updateTimerView(){
    var bar = root.querySelector('[data-quizox-bar]');
    var box = root.querySelector('[data-quizox-timer]');
    var sec = root.querySelector('[data-quizox-sec]');
    if (bar) bar.style.width = Math.max(state.left, 0) / LIMIT * 100 + '%';
    if (sec){
      sec.textContent = state.paused ? '一時停止中' : '残り ' + Math.max(state.left, 0) + '秒';
      sec.className = 'quizOxSec' + (state.paused ? ' quizOxPaused' : '');
    }
    if (box) box.className = 'quizOxTimer' + (state.left <= 5 && !state.paused ? ' quizOxWarn' : '');
  }
 
  function headerHtml(){
    return '<div class="quizOxBar">'
         +   '<span class="quizOxTag">' + esc(catById(state.cat).name) + '</span>'
         +   '<span class="quizOxStreak">連続正解 <b>' + state.streak + '</b></span>'
         +   '<button type="button" class="quizOxQuit" data-quizox-act="quit">やめる</button>'
         + '</div>';
  }
 
  function renderQuestion(){
    var q = state.cur;
    var done = state.total - state.queue.length;
 
    root.innerHTML =
        headerHtml()
      + '<div class="quizOxTimer" data-quizox-timer><i data-quizox-bar></i></div>'
      + '<div class="quizOxSec" data-quizox-sec>残り ' + LIMIT + '秒</div>'
      + '<p class="quizOxQno">第' + done + '問／全' + state.total + '問</p>'
      + '<p class="quizOxQtext">' + esc(q.q) + '</p>'
      + '<div class="quizOxChoices">'
      +   '<button type="button" class="quizOxCh quizOxMaru" data-quizox-act="answer" data-quizox-val="1">'
      +     '<span class="quizOxMark">' + ic('circle') + '</span>正しい</button>'
      +   '<button type="button" class="quizOxCh quizOxBatsu" data-quizox-act="answer" data-quizox-val="0">'
      +     '<span class="quizOxMark">' + ic('x') + '</span>誤り</button>'
      + '</div>';
 
    updateTimerView();
    scrollToTop();
  }
 
  /* ---------- 判定・解説 ---------- */
  function renderJudge(v){
    stopTimer();
    state.inQuestion = false;
 
    var q      = state.cur;
    var timeup = (v === null);
    var ok     = (!timeup && v === q.a);
    if (ok){ state.streak++; }
 
    var head = ok
      ? '<p class="quizOxVerdict quizOxOk">' + ic('circle-check') + '正解</p>'
      : '<p class="quizOxVerdict quizOxNg">' + ic(timeup ? 'clock' : 'circle-x') + (timeup ? '時間切れ' : '不正解') + '</p>';
 
    var h = headerHtml()
          + head
          + '<p class="quizOxQtextSub">' + esc(q.q) + '</p>'
          + '<div class="quizOxPanel">'
          +   '<h3>答え：' + (q.a ? '正しい（◯）' : '誤り（✕）') + '</h3>'
          +   '<p>' + esc(q.e) + '</p>'
          +   (q.g ? '<p class="quizOxGloss">用語の備考　' + esc(q.g) + '</p>' : '')
          + '</div>'
          + '<p class="quizOxSrc">問題ID ' + esc(q.id) + (q.p ? '　資料 p.' + esc(q.p) : '') + '</p>';
 
    if (ok){
      h += '<button type="button" class="quizOxAct" data-quizox-act="next">次の問題へ</button>';
    } else {
      keepBest();
      h += '<button type="button" class="quizOxAct" data-quizox-act="over">結果を見る</button>';
    }
 
    root.innerHTML = h;
    scrollToTop();
  }
 
  /* ---------- ゲームオーバー／全問クリア ---------- */
  function renderOver(){
    var c = catById(state.cat);
    root.innerHTML =
        '<h2 class="quizOxTitle">ゲームオーバー</h2>'
      + '<div class="quizOxRoadline"></div>'
      + '<p class="quizOxScore"><b>' + state.streak + '</b>　問連続正解</p>'
      + '<p class="quizOxLead">' + esc(c.name) + '　（最高記録 ' + (state.best[c.id] || 0) + '問）</p>'
      + '<button type="button" class="quizOxAct" data-quizox-act="start" data-quizox-cat="' + esc(c.id) + '">同じ分野でもう一度</button>'
      + '<button type="button" class="quizOxAct quizOxGhost" data-quizox-act="reset">分野を選び直す</button>';
    state.streak = 0;
    scrollToTop();
  }
 
  function renderClear(){
    stopTimer();
    state.inQuestion = false;
    keepBest();
    var c = catById(state.cat);
    root.innerHTML =
        '<h2 class="quizOxTitle quizOxClear">全問クリア</h2>'
      + '<div class="quizOxRoadline"></div>'
      + '<p class="quizOxScore"><b>' + state.total + '</b>　問すべて正解</p>'
      + '<p class="quizOxLead">' + esc(c.name) + '　制覇です。ほかの分野にも挑戦してみてください。</p>'
      + '<button type="button" class="quizOxAct" data-quizox-act="reset">分野を選び直す</button>';
    state.streak = 0;
    scrollToTop();
  }
 
  function quit(){
    stopTimer();
    state.inQuestion = false;
    keepBest();
    var s = state.streak;
    state.streak = 0;
    renderStart('途中終了しました。今回は ' + s + ' 問連続正解。');
  }
 
  function reset(){
    state.streak = 0;
    renderStart();
  }
 
  /* ---------- イベント委譲（グローバル関数を作らない） ---------- */
  root.addEventListener('click', function(ev){
    var btn = ev.target.closest('[data-quizox-act]');
    if (!btn || !root.contains(btn)) return;
 
    switch (btn.getAttribute('data-quizox-act')){
      case 'start':
        start(btn.getAttribute('data-quizox-cat'));
        break;
      case 'answer':
        if (!state.inQuestion) return;          // 二重回答の防止
        state.inQuestion = false;
        stopTimer();
        renderJudge(btn.getAttribute('data-quizox-val') === '1');
        break;
      case 'next':  nextQuestion(); break;
      case 'over':  renderOver();   break;
      case 'quit':  quit();         break;
      case 'reset': reset();        break;
    }
  });
 
  /* ---------- 他タブに移動している間はタイマーを一時停止 ---------- */
  (function watchVisibility(){
    var section = root.closest('.view');
    if (!section || typeof MutationObserver === 'undefined') return;
 
    function sync(){
      var visible = section.classList.contains('active');
      if (!visible && !state.paused){
        state.paused = true;
        stopTimer();
        updateTimerView();
      } else if (visible && state.paused){
        state.paused = false;
        updateTimerView();
        if (state.inQuestion) runTimer();      // 出題中だった場合だけ再開
      }
    }
 
    new MutationObserver(sync).observe(section, { attributes:true, attributeFilter:['class'] });
    sync();
  })();
 
  // ブラウザのタブ自体が非表示になったときも同様に止める
  document.addEventListener('visibilitychange', function(){
    if (document.hidden){
      if (!state.paused){ state.paused = true; stopTimer(); updateTimerView(); }
    } else {
      var section = root.closest('.view');
      if (section && !section.classList.contains('active')) return;
      if (state.paused){
        state.paused = false;
        updateTimerView();
        if (state.inQuestion) runTimer();
      }
    }
  });
 
  /* ---------- サーバーから問題データを取得して起動 ---------- */
  function boot(data){
    if (!data || !data.categories || !data.questions){
      root.innerHTML = '<p class="quizOxError">問題データの形式が正しくありません。</p>';
      return;
    }
    DATA = data;
    renderStart();
  }
 
  callApi('getQuizData')
    .then(boot)
    .catch(function(err){
      root.innerHTML = '<p class="quizOxError">問題データの読み込みに失敗しました。<br>'
                     + esc(err && err.message ? err.message : err)
                     + '<br>ページを再読み込みしてください。</p>';
    });
})();
