/* =========================================================
   共通ユーティリティ
========================================================= */
const $  = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// localStorage が使えない環境（プライベートモード等）でも動くようにする
const store = {
  get(key, fallback){
    try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  },
  set(key, val){
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 保存できなくても動作は続ける */ }
  }
};

function escapeHtml_(text){
  return String(text).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatDate_(iso){
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '日時不明';
  return d.toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  });
}

let toastTimer = null;
function toast(message, type){
  const el = $('#toast');
  el.textContent = message;
  el.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
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

// google.script.run を Promise で扱うためのラッパー
function gas(fnName){
  const args = Array.prototype.slice.call(arguments, 1);
  return new Promise((resolve, reject) => {
    if (!(window.google && google.script && google.script.run)) {
      reject(new Error('GASのウェブアプリとして開いてください。'));
      return;
    }
    const runner = google.script.run.withSuccessHandler(resolve).withFailureHandler(reject);
    runner[fnName].apply(runner, args);
  });
}
function errMsg_(err){ return (err && err.message) ? err.message : String(err); }

/* =========================================================
   起動イントロ：大きな自転車が現れて、ペダルをこいで走り去る
========================================================= */
(function initIntro(){
  const el = $('#intro-splash');
  if (!el) return;
  const root = document.documentElement;
  root.classList.add('intro-lock');

  let finished = false;
  let raf = 0;
  const timers = [];

  function finish(){
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    cancelAnimationFrame(raf);
    el.classList.add('intro-hide');
    root.classList.remove('intro-lock');
    setTimeout(() => el.remove(), 900);
  }
  el.addEventListener('click', finish);

  if (prefersReduced) {
    timers.push(setTimeout(finish, 700));
    return;
  }

  /* --- ペダルをこぐライダーを逆運動学(IK)で描画 --- */
  const HIP = { x: 162, y: 78 };
  const BB  = { x: 185, y: 170 };
  const CRANK = 30, L1 = 66, L2 = 68;

  function kneeOf(foot){
    const dx = foot.x - HIP.x, dy = foot.y - HIP.y;
    const d = Math.min(Math.hypot(dx, dy), L1 + L2 - 0.5);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const ux = dx / d, uy = dy / d;
    const mx = HIP.x + ux * a, my = HIP.y + uy * a;
    const k1 = { x: mx - uy * h, y: my + ux * h };
    const k2 = { x: mx + uy * h, y: my - ux * h };
    return k1.x > k2.x ? k1 : k2;       // ひざは前（右）に曲がる
  }

  const parts = {
    legNear: $('#leg-near'),  legFar: $('#leg-far'),
    crankNear: $('#crank-near'), crankFar: $('#crank-far'),
    pedalNear: $('#pedal-near'), pedalFar: $('#pedal-far')
  };

  function drawLeg(angle, leg, crank, pedal){
    const foot = { x: BB.x + Math.cos(angle) * CRANK, y: BB.y + Math.sin(angle) * CRANK };
    const knee = kneeOf(foot);
    leg.setAttribute('points', HIP.x + ',' + HIP.y + ' ' + knee.x.toFixed(1) + ',' + knee.y.toFixed(1) + ' ' + foot.x.toFixed(1) + ',' + (foot.y + 2).toFixed(1));
    crank.setAttribute('x2', foot.x.toFixed(1));
    crank.setAttribute('y2', foot.y.toFixed(1));
    pedal.setAttribute('x1', (foot.x - 8).toFixed(1));
    pedal.setAttribute('x2', (foot.x + 9).toFixed(1));
    pedal.setAttribute('y1', foot.y.toFixed(1));
    pedal.setAttribute('y2', foot.y.toFixed(1));
  }

  let angle = 0.6;
  let last = performance.now();
  const t0 = last;
  function frame(now){
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = (now - t0) / 1000;
    const speed = t < 1.5 ? 4.2 : Math.min(4.2 + (t - 1.5) * 14, 17);   // 走り出すと一気に加速
    angle += speed * dt;
    drawLeg(angle, parts.legNear, parts.crankNear, parts.pedalNear);
    drawLeg(angle + Math.PI, parts.legFar, parts.crankFar, parts.pedalFar);
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  timers.push(setTimeout(() => el.classList.add('ride'), 1550));   // 走り出す
  timers.push(setTimeout(finish, 3500));                            // 画面を開く
})();

/* =========================================================
   タブ切り替え（スライドバー＋自転車がページを運ぶ演出）
========================================================= */
const tabButtons = $$('.tab-btn');
const views = $$('.view');
const sweepEl = $('#tab-sweep');
const sweepLabel = $('#sweep-label');
const tabIndicator = $('#tab-indicator');
let currentTarget = 'view-public-map';
let sweeping = false;

function moveIndicator(btn){
  if (!tabIndicator || !btn) return;
  tabIndicator.style.width = btn.offsetWidth + 'px';
  tabIndicator.style.transform = 'translateX(' + btn.offsetLeft + 'px)';
}

function showView(id){
  views.forEach(v => v.classList.toggle('active', v.id === id));
  currentTarget = id;
  window.scrollTo(0, 0);

  if (id === 'view-map') {
    ensureEditMap();
    setTimeout(() => editMap && editMap.invalidateSize(), 80);
  }
  if (id === 'view-public-map') {
    setTimeout(() => publicMap && publicMap.invalidateSize(), 80);
  }
  updateFab();
}

function switchTab(btn){
  const id = btn.dataset.target;
  if (id === currentTarget || sweeping) return;

  const order = tabButtons.map(b => b.dataset.target);
  const dir = order.indexOf(id) > order.indexOf(currentTarget) ? 'ltr' : 'rtl';

  tabButtons.forEach(b => {
    b.classList.toggle('active', b === btn);
    b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
  });
  moveIndicator(btn);
  try { btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' }); } catch (e) {}

  if (prefersReduced) { showView(id); return; }

  sweeping = true;
  sweepLabel.textContent = btn.textContent.trim();
  sweepEl.className = 'tab-sweep go ' + dir;
  setTimeout(() => showView(id), 430);                                    // 画面が完全に覆われている間に中身を入れ替える
  setTimeout(() => { sweepEl.className = 'tab-sweep'; sweeping = false; }, 960);
}

tabButtons.forEach(btn => btn.addEventListener('click', () => switchTab(btn)));
window.addEventListener('resize', () => moveIndicator($('.tab-btn.active')));
window.addEventListener('load', () => moveIndicator($('.tab-btn.active')));
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveIndicator($('.tab-btn.active')));
moveIndicator($('.tab-btn.active'));

// カードが順番にふわっと出るための遅延番号
$$('.rules-grid > *, .map-layout > .panel, .side-stack > .panel').forEach((el, i) => el.style.setProperty('--i', i));

// ページ先頭へ戻るボタン
const toTopBtn = $('#to-top');
window.addEventListener('scroll', () => toTopBtn.classList.toggle('show', window.scrollY > 500), { passive: true });
toTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// 「↑ 地図に戻る」
$$('[data-scroll-top="map"]').forEach(b => b.addEventListener('click', () => {
  const m = $('#map');
  if (m) m.scrollIntoView({ behavior: 'smooth', block: 'center' });
}));

/* =========================================================
   マップ機能（google.script.run でスプレッドシートと通信）
========================================================= */
const CATEGORY_META = {
  '事故多発':    { color: '#c0392b', label: '事故多発エリア' },
  '見通し不良':  { color: '#d9822b', label: '見通し不良' },
  '段差・悪路':  { color: '#8e6c3a', label: '段差・悪路' },
  '違法駐輪':    { color: '#5b6b8c', label: '違法駐輪・通行妨害' },
  'その他':      { color: '#8391a5', label: 'その他' }
};
const CATEGORY_ORDER = ['事故多発', '見通し不良', '段差・悪路', '違法駐輪', 'その他'];
const KUMAMOTO_CITY_HALL = [32.8032, 130.7079];

// 画面の状態（実データはスプレッドシート側が正。ここは表示用のコピー）
const state = {
  pins: {},                 // id -> pin
  sig: '',                  // 前回取得時の内容（変化検知用）
  filter: {},               // カテゴリ -> 表示するか
  selectedId: null,
  pendingLatLng: null
};
CATEGORY_ORDER.forEach(c => { state.filter[c] = true; });

let editMap = null;
let publicMap = null;
const layers = { edit: null, pub: null };
const markers = { edit: {}, pub: {} };
let pendingMarker = null;

function metaOf(pin){ return CATEGORY_META[pin.category] || CATEGORY_META['その他']; }
function radiusOf(pin){ return 8 + Math.min(pin.votes || 0, 10) * 0.7; }   // 共感が多いほどピンが大きい

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

  // ポップアップ内の「危ないと思う」ボタン（ポップアップごとに1回だけ設定）
  m.on('popupopen', (e) => {
    const popupEl = e.popup.getElement();
    if (!popupEl || popupEl._voteBound) return;
    popupEl._voteBound = true;
    popupEl.addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-vote]');
      if (btn) votePin(btn.getAttribute('data-vote'));
    });
  });
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
      a.textContent = '◎';
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
      interactive: false
    }).addTo(m);
    m.setView(ll, Math.max(m.getZoom(), 16));
    toast('現在地を表示しました。', 'ok');
  }, () => {
    toast('現在地を取得できませんでした。位置情報の許可をご確認ください。', 'error');
  }, { enableHighAccuracy: true, timeout: 10000 });
}

function ensurePublicMap(){
  if (publicMap) return;
  publicMap = createMap('public-map', 14);
  layers.pub = L.layerGroup().addTo(publicMap);
  renderPins();
}

function ensureEditMap(){
  if (editMap) return;
  editMap = createMap('map', 15);
  window._map = editMap;
  layers.edit = L.layerGroup().addTo(editMap);

  editMap.on('click', (e) => {
    state.pendingLatLng = e.latlng;
    $('#coord-readout').textContent =
      '選択中の座標: 緯度 ' + e.latlng.lat.toFixed(5) + ' / 経度 ' + e.latlng.lng.toFixed(5);
    $('#btn-submit-pin').disabled = false;

    if (pendingMarker) editMap.removeLayer(pendingMarker);
    pendingMarker = L.marker(e.latlng, {
      icon: L.divIcon({
        className: 'pending-pin-icon',
        html: '<div class="pending-pin"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      }),
      interactive: false
    }).addTo(editMap);
    updateFab();
  });
  renderPins();
}

/* ---------- ピンの描画 ---------- */
function popupHtml_(pin){
  const meta = metaOf(pin);
  const voted = getVoted().indexOf(pin.id) !== -1;
  return '<div class="pin-popup">'
    + '<strong style="color:' + meta.color + '">' + escapeHtml_(meta.label) + '</strong>'
    + '<p>' + escapeHtml_(pin.detail) + '</p>'
    + '<div class="pin-meta">' + escapeHtml_(formatDate_(pin.postedAt)) + '</div>'
    + '<button type="button" class="vote-btn' + (voted ? ' voted' : '') + '" data-vote="' + escapeHtml_(pin.id) + '">'
    + (voted ? '投票済み' : '危ないと思う') + '（' + (pin.votes || 0) + '）</button>'
    + '</div>';
}

function makeMarker_(pin, kind){
  const meta = metaOf(pin);
  const mk = L.circleMarker([pin.lat, pin.lng], {
    radius: radiusOf(pin),
    color: '#ffffff',
    weight: 2,
    fillColor: meta.color,
    fillOpacity: 0.95
  });
  mk.bindPopup(popupHtml_(pin));
  if (kind === 'edit') mk.on('click', () => showPinDetail(pin.id));
  return mk;
}

function renderPins(){
  const pins = Object.keys(state.pins).map(id => state.pins[id]);

  if (editMap && layers.edit) {
    layers.edit.clearLayers();
    markers.edit = {};
    pins.forEach(pin => {
      const mk = makeMarker_(pin, 'edit');
      mk.addTo(layers.edit);
      markers.edit[pin.id] = mk;
    });
  }
  if (publicMap && layers.pub) {
    layers.pub.clearLayers();
    markers.pub = {};
    pins.forEach(pin => {
      if (!state.filter[pin.category] && CATEGORY_META[pin.category]) return;   // 絞り込みで非表示
      const mk = makeMarker_(pin, 'pub');
      mk.addTo(layers.pub);
      markers.pub[pin.id] = mk;
    });
  }
}

/** 票数が変わったとき、ポップアップを閉じずに見た目だけ更新する */
function refreshPinViews(id){
  const pin = state.pins[id];
  if (!pin) return;
  ['edit', 'pub'].forEach(k => {
    const mk = markers[k][id];
    if (!mk) return;
    mk.setRadius(radiusOf(pin));
    mk.setPopupContent(popupHtml_(pin));
  });
  if (state.selectedId === id) showPinDetail(id);
  renderStats();
}

/* ---------- サーバーからの読み込み ---------- */
async function fetchPins(manual){
  const btn = $('#btn-refresh');
  if (manual) btn.classList.add('loading');
  try {
    const list = await gas('getPins');
    const sig = JSON.stringify(list.map(p => [p.id, p.votes]));
    if (manual || sig !== state.sig) {
      state.pins = {};
      list.forEach(p => { state.pins[p.id] = p; });
      state.sig = sig;
      renderPins();
      renderStats();
      if (state.selectedId && !state.pins[state.selectedId]) clearDetail();
    }
    $('#stat-updated').textContent = '最終更新 ' + new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    if (manual) toast('最新の情報に更新しました。', 'ok');
  } catch (err) {
    console.error('ピンの読み込みに失敗しました:', err);
    $('#stat-updated').textContent = '読み込みに失敗しました';
    if (manual) toast('読み込みに失敗しました: ' + errMsg_(err), 'error');
  } finally {
    btn.classList.remove('loading');
  }
}

/* ---------- 統計・絞り込み・ランキング ---------- */
function renderStats(){
  const pins = Object.keys(state.pins).map(id => state.pins[id]);
  $('#stat-total').textContent = pins.length;

  const counts = {};
  CATEGORY_ORDER.forEach(c => { counts[c] = 0; });
  pins.forEach(p => { counts[CATEGORY_META[p.category] ? p.category : 'その他']++; });

  const list = $('#filter-list');
  list.innerHTML = '';
  CATEGORY_ORDER.forEach(cat => {
    const meta = CATEGORY_META[cat];
    const label = document.createElement('label');
    label.className = 'filter-item' + (state.filter[cat] ? '' : ' off');
    label.innerHTML =
      '<input type="checkbox" ' + (state.filter[cat] ? 'checked' : '') + '>' +
      '<span class="legend-dot" style="background:' + meta.color + '"></span>' +
      '<span>' + escapeHtml_(meta.label) + '</span>' +
      '<span class="count">' + counts[cat] + '</span>';
    label.querySelector('input').addEventListener('change', (e) => {
      state.filter[cat] = e.target.checked;
      renderPins();
      renderStats();
    });
    list.appendChild(label);
  });

  // 共感が多い順（票のあるものだけ）
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
  if (!state.filter[pin.category]) { state.filter[pin.category] = true; renderPins(); renderStats(); }
  $('#public-map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  publicMap.setView([pin.lat, pin.lng], Math.max(publicMap.getZoom(), 16), { animate: true });
  const mk = markers.pub[id];
  if (mk) setTimeout(() => mk.openPopup(), 350);
}

/* ---------- 投稿 ---------- */
const coordReadout = $('#coord-readout');
const btnSubmitPin = $('#btn-submit-pin');
const inputCategory = $('#input-category');
const inputDetail = $('#input-detail');
const submitStatus = $('#submit-status');
const fabPost = $('#fab-post');

function setSubmitStatus(text, isError){
  submitStatus.textContent = text || '';
  submitStatus.classList.toggle('error', !!isError);
}

inputDetail.addEventListener('input', () => {
  $('#detail-count').textContent = inputDetail.value.length + ' / 200';
});

// スマホ：地図をタップしたら「この場所を投稿する」ボタンを出す
function updateFab(){
  const show = !!state.pendingLatLng && currentTarget === 'view-map';
  fabPost.classList.toggle('show', show);
}
fabPost.addEventListener('click', () => {
  $('#post-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  setSubmitStatus('投稿を保存しています…', false);

  try {
    const saved = await gas('addPin', pinData, getClientId());

    // 削除用の鍵は、投稿した端末にだけ保存する
    const tokens = getTokens();
    tokens[saved.id] = saved.ownerToken;
    store.set('kbm_tokens', tokens);
    delete saved.ownerToken;

    state.pins[saved.id] = saved;
    state.sig = '';                       // 次回の自動更新で整合を取る
    if (pendingMarker) { editMap.removeLayer(pendingMarker); pendingMarker = null; }
    state.pendingLatLng = null;
    renderPins();
    renderStats();

    inputDetail.value = '';
    $('#detail-count').textContent = '0 / 200';
    coordReadout.textContent = '地図をタップすると座標が表示されます';
    setSubmitStatus('投稿を保存しました。ありがとうございます！', false);
    toast('投稿を保存しました。', 'ok');
    updateFab();
    showPinDetail(saved.id);
    if (markers.edit[saved.id]) markers.edit[saved.id].openPopup();
  } catch (err) {
    btnSubmitPin.disabled = false;
    setSubmitStatus('保存に失敗しました: ' + errMsg_(err), true);
  }
});

/* ---------- 詳細パネル・共感・削除 ---------- */
const detailEmpty = $('#detail-empty');
const detailCard = $('#detail-card');
const btnVotePin = $('#btn-vote-pin');
const btnDeletePin = $('#btn-delete-pin');

function clearDetail(){
  state.selectedId = null;
  detailCard.classList.remove('show');
  detailEmpty.style.display = 'block';
}

function showPinDetail(pinId){
  const pin = state.pins[pinId];
  if (!pin) return;
  const meta = metaOf(pin);
  state.selectedId = pinId;

  detailEmpty.style.display = 'none';
  detailCard.classList.add('show');

  $('#detail-tag').textContent = meta.label;
  $('#detail-tag').style.background = meta.color;
  $('#detail-title').textContent = '投稿内容';
  $('#detail-body').textContent = pin.detail;
  $('#detail-meta').textContent =
    '投稿日時: ' + formatDate_(pin.postedAt) + ' ／ 座標: ' + pin.lat.toFixed(5) + ', ' + pin.lng.toFixed(5);

  const voted = getVoted().indexOf(pinId) !== -1;
  btnVotePin.classList.toggle('voted', voted);
  btnVotePin.innerHTML = (voted ? '投票済み' : '危ないと思う') + '（<span id="detail-votes">' + (pin.votes || 0) + '</span>）';

  const mine = !!getTokens()[pinId];
  btnDeletePin.style.display = mine ? 'block' : 'none';
  $('#own-note').style.display = mine ? 'block' : 'none';
}

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

  try {
    pin.votes = await gas('votePin', id);
    refreshPinViews(id);
  } catch (err) {
    pin.votes = Math.max(0, (pin.votes || 1) - 1);
    store.set('kbm_voted', getVoted().filter(v => v !== id));
    refreshPinViews(id);
    toast('投票に失敗しました: ' + errMsg_(err), 'error');
  }
}
btnVotePin.addEventListener('click', () => { if (state.selectedId) votePin(state.selectedId); });

btnDeletePin.addEventListener('click', async () => {
  const id = state.selectedId;
  if (!id) return;
  if (!confirm('この投稿を削除しますか？（スプレッドシートからも削除されます）')) return;

  const tokens = getTokens();
  try {
    const ok = await gas('deletePin', id, tokens[id] || '');
    if (ok) {
      delete state.pins[id];
      delete tokens[id];
      store.set('kbm_tokens', tokens);
      state.sig = '';
      renderPins();
      renderStats();
      clearDetail();
      toast('投稿を削除しました。', 'ok');
    } else {
      toast('この投稿は既に削除されています。');
      fetchPins(true);
    }
  } catch (err) {
    toast('削除に失敗しました: ' + errMsg_(err), 'error');
  }
});

/* ---------- 凡例（投稿タブ） ---------- */
(function renderEditLegend(){
  $('#edit-legend').innerHTML = CATEGORY_ORDER.map(cat => {
    const m = CATEGORY_META[cat];
    return '<div class="legend-item"><span class="legend-dot" style="background:' + m.color + '"></span>' + escapeHtml_(m.label) + '</div>';
  }).join('');
})();

/* ---------- 起動時の初期化 ---------- */
$('#btn-refresh').addEventListener('click', () => fetchPins(true));
ensurePublicMap();
setTimeout(() => publicMap.invalidateSize(), 120);
fetchPins(false);
// 他の人の投稿・共感を取り込むため、表示中は2分ごとにそっと更新（内容が変わったときだけ再描画）
setInterval(() => { if (!document.hidden && currentTarget === 'view-public-map') fetchPins(false); }, 120000);


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
        options: ['道路の右側端', '道路の左側端', '道路の中央', '決まりはない'],
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
        options: ['一時停止', '傘をさしながらの片手運転', 'ライトの点灯', '車道左側端の通行'],
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
        question: '丸に自転車のイラストと斜線が入った標識が示す意味はどれですか？',
        options: ['自転車専用道路', '自転車通行止め', '自転車駐輪場', '自転車優先道路'],
        correctIndex: 1,
        explanation: '斜線が入った標識は「通行止め」を意味し、この場合は自転車の通行が禁止されていることを示します。'
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
      }
    ]
  },
 
  night: {
    label: '夜間・視認性',
    description: 'ライトや服装など、暗い時間帯の見え方に関わるルール。',
    questions: [
      {
        question: '日没後に自転車に乗るとき、必ず行うべきことは何ですか？',
        options: ['ライトを点灯する', 'ベルを鳴らし続ける', 'できるだけ速く走る', '何もしなくてよい'],
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
      }
    ]
  },
 
  maintenance: {
    label: '点検・整備・マナー',
    description: '車体の点検やヘルメット、子ども乗せなど装備面のポイント。',
    questions: [
      {
        question: '自転車に乗る前の日常点検で確認すべき項目として適切でないものはどれですか？',
        options: ['ブレーキの効き具合', 'タイヤの空気圧', 'ベルの音量の大きさ', 'サドルやハンドルのがたつき'],
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
      }
    ]
  }
 
};

/* =========================================================
   クイズ機能（カテゴリ選択 → 出題 → 結果）
========================================================= */

const QUIZ_CATEGORY_ORDER = ['basic', 'signs', 'crossing', 'night', 'maintenance'];
const RANDOM_QUIZ_SIZE = 10;

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
const quizTrackFill = $('#quiz-track-fill');
const quizBike = $('#quiz-bike');
const quizCard = $('#quiz-card');
const quizQuestion = $('#quiz-question');
const quizOptions = $('#quiz-options');
const quizFeedback = $('#quiz-feedback');
const quizVerdict = $('#quiz-verdict');
const quizExplanation = $('#quiz-explanation');
const btnNextQuestion = $('#btn-next-question');
const quizResult = $('#quiz-result');
const quizResultScore = $('#quiz-result-score');
const quizResultComment = $('#quiz-result-comment');
const quizReview = $('#quiz-review');
const quizParade = $('#quiz-parade');
const btnRetryQuiz = $('#btn-retry-quiz');
const btnRetryWrong = $('#btn-retry-wrong');
const btnOtherCategory = $('#btn-other-category');

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

function setQuizProgress(done){
  const total = currentQuizQuestions.length || 1;
  const pct = (done / total) * 100;
  quizTrackFill.style.width = pct + '%';
  quizBike.style.left = Math.min(Math.max(pct, 4), 96) + '%';   // 自転車がゴールに向かって進む
}

function renderCategorySelect(){
  quizCategorySelect.innerHTML = '';

  QUIZ_CATEGORY_ORDER.forEach((key, i) => {
    const cat = QUIZ_BANK[key];
    const best = getQuizBest(key);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'quiz-category-card';
    card.style.setProperty('--i', i);
    card.innerHTML =
      '<h3>' + escapeHtml_(cat.label) + '</h3>' +
      '<p>' + escapeHtml_(cat.description) + '</p>' +
      '<span class="quiz-category-count">全' + cat.questions.length + '問</span>' +
      (best ? '<span class="quiz-best">自己ベスト ' + best.score + ' / ' + best.total + '</span>' : '');
    card.addEventListener('click', () => startQuiz(key));
    quizCategorySelect.appendChild(card);
  });

  const totalQuestions = QUIZ_CATEGORY_ORDER.reduce((sum, key) => sum + QUIZ_BANK[key].questions.length, 0);
  const bestRandom = getQuizBest('random');
  const randomCard = document.createElement('button');
  randomCard.type = 'button';
  randomCard.className = 'quiz-category-card random';
  randomCard.style.setProperty('--i', QUIZ_CATEGORY_ORDER.length);
  randomCard.innerHTML =
    '<h3>総合ランダム' + RANDOM_QUIZ_SIZE + '問</h3>' +
    '<p>全カテゴリ（計' + totalQuestions + '問）からランダムに出題する腕試しモードです。</p>' +
    '<span class="quiz-category-count">毎回出題内容が変わります</span>' +
    (bestRandom ? '<span class="quiz-best">自己ベスト ' + bestRandom.score + ' / ' + bestRandom.total + '</span>' : '');
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
  quizCategorySelect.style.display = 'none';
  quizActiveWrap.style.display = 'block';
  quizResult.classList.remove('show');
  quizParade.classList.remove('go');
  quizCard.style.display = 'block';

  setQuizProgress(0);
  renderQuestion();
}

function backToCategorySelect(){
  quizActiveWrap.style.display = 'none';
  quizCategorySelect.style.display = 'grid';
  renderCategorySelect();
}

btnQuizBack.addEventListener('click', backToCategorySelect);
btnOtherCategory.addEventListener('click', backToCategorySelect);

function renderQuestion(){
  answered = false;
  const q = currentQuizQuestions[currentQuestionIndex];

  quizProgressText.textContent = '問題 ' + (currentQuestionIndex + 1) + ' / ' + currentQuizQuestions.length;
  quizScoreText.textContent = '正解 ' + correctCount + ' 問';
  setQuizProgress(currentQuestionIndex);

  quizQuestion.textContent = q.question;
  quizOptions.innerHTML = '';
  quizFeedback.classList.remove('show');
  btnNextQuestion.style.display = 'none';

  // 選択肢は毎回シャッフルして、位置では覚えられないようにする
  const choices = shuffleArray_(q.options.map((text, idx) => ({ text: text, correct: idx === q.correctIndex })));
  choices.forEach((choice) => {
    const optBtn = document.createElement('button');
    optBtn.type = 'button';
    optBtn.className = 'quiz-option';
    optBtn.textContent = choice.text;
    optBtn.dataset.correct = choice.correct ? '1' : '0';
    optBtn.addEventListener('click', () => handleAnswer(choice.correct, optBtn));
    quizOptions.appendChild(optBtn);
  });

  // 問題が切り替わるたびに、カードをふわっと出し直す
  quizCard.classList.remove('enter');
  void quizCard.offsetWidth;
  quizCard.classList.add('enter');
}

function handleAnswer(isCorrect, selectedBtn){
  if (answered) return;
  answered = true;

  const q = currentQuizQuestions[currentQuestionIndex];
  const optionButtons = $$('.quiz-option', quizOptions);
  optionButtons.forEach(b => { b.disabled = true; });

  if (isCorrect) correctCount++;
  else wrongQuestions.push(q);

  selectedBtn.classList.add(isCorrect ? 'correct' : 'incorrect');
  if (!isCorrect) {
    const right = optionButtons.find(b => b.dataset.correct === '1');
    if (right) right.classList.add('correct');
  }

  quizVerdict.textContent = isCorrect ? '正解です！' : '不正解です';
  quizExplanation.textContent = q.explanation;
  quizFeedback.classList.add('show');

  quizScoreText.textContent = '正解 ' + correctCount + ' 問';
  setQuizProgress(currentQuestionIndex + 1);
  btnNextQuestion.style.display = 'inline-block';
  btnNextQuestion.textContent =
    (currentQuestionIndex === currentQuizQuestions.length - 1) ? '結果を見る' : '次の問題へ';
}

btnNextQuestion.addEventListener('click', () => {
  currentQuestionIndex++;
  if (currentQuestionIndex >= currentQuizQuestions.length) showQuizResult();
  else renderQuestion();
});

function showQuizResult(){
  const total = currentQuizQuestions.length;
  quizCard.style.display = 'none';
  quizResult.classList.add('show');
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

  // 8割以上なら、自転車が画面を駆け抜けてお祝い
  quizParade.classList.remove('go');
  if (correctCount / total >= 0.8 && !prefersReduced) {
    void quizParade.offsetWidth;
    quizParade.classList.add('go');
  }

  // 間違えた問題の振り返り
  if (wrongQuestions.length > 0) {
    quizReview.style.display = 'block';
    quizReview.innerHTML = '<h4>間違えた問題（' + wrongQuestions.length + '問）</h4><ul>' +
      wrongQuestions.map(q =>
        '<li>' + escapeHtml_(q.question) + '<b>答え：' + escapeHtml_(q.options[q.correctIndex]) + '</b></li>'
      ).join('') + '</ul>';
    btnRetryWrong.style.display = '';
  } else {
    quizReview.style.display = 'none';
    btnRetryWrong.style.display = 'none';
  }

  if (!currentQuizKey.startsWith('wrong:')) saveQuizBest(currentQuizKey, correctCount, total);
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
   ・問題データは google.script.run.getQuizData() で取得します
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
      root.scrollIntoView({ block:'start', behavior:'smooth' });
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
      +     '<span class="quizOxMark">◯</span>正しい</button>'
      +   '<button type="button" class="quizOxCh quizOxBatsu" data-quizox-act="answer" data-quizox-val="0">'
      +     '<span class="quizOxMark">✕</span>誤り</button>'
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
      ? '<p class="quizOxVerdict quizOxOk">正解</p>'
      : '<p class="quizOxVerdict quizOxNg">' + (timeup ? '時間切れ' : '不正解') + '</p>';
 
    var h = headerHtml()
          + head
          + '<p class="quizOxQtextSub">' + esc(q.q) + '</p>'
          + '<div class="quizOxPanel">'
          +   '<h3>答え：' + (q.a ? '◯（正しい）' : '✕（誤り）') + '</h3>'
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
 
  if (typeof google !== 'undefined' && google.script && google.script.run){
    google.script.run
      .withSuccessHandler(boot)
      .withFailureHandler(function(err){
        root.innerHTML = '<p class="quizOxError">問題データの読み込みに失敗しました。<br>'
                       + esc(err && err.message ? err.message : err)
                       + '<br>Code.gs に getQuizData() があるか確認してください。</p>';
      })
      .getQuizData();
  } else {
    root.innerHTML = '<p class="quizOxError">この画面はGASウェブアプリとして公開した状態でご利用ください。</p>';
  }
})();