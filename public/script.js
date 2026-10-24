// Lucideアイコンの初期化
lucide.createIcons();

// 【1】スプラッシュ画面の制御
window.addEventListener('load', () => {
  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    const app = document.getElementById('app-container');
    
    splash.classList.add('fade-out');
    app.classList.remove('blurred');
  }, 1800);
});

// 【2】Leaflet地図の初期化（熊本市中心部）
const map = L.map('map', {
  zoomControl: false
}).setView([32.8032, 130.7079], 14);

L.control.zoom({ position: 'bottomright' }).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// 【3】ピン投稿用ボトムシートの制御
const addBtn = document.getElementById('add-btn');
const pinSheet = document.getElementById('pin-bottom-sheet');
const cancelPin = document.getElementById('cancel-pin');
const submitPin = document.getElementById('submit-pin');
let tempMarker = null;

// 「＋」ボタンでボトムシートを表示
addBtn.addEventListener('click', () => {
  pinSheet.classList.add('active');
});

// キャンセルボタン
cancelPin.addEventListener('click', () => {
  closeBottomSheet();
});

// 地図タップで仮ピンを置く
map.on('click', (e) => {
  if (!pinSheet.classList.contains('active')) return;
  
  if (tempMarker) map.removeLayer(tempMarker);
  tempMarker = L.marker(e.latlng).addTo(map);
});

// 投稿ボタン（仮の動作）
submitPin.addEventListener('click', () => {
  const type = document.getElementById('danger-type').value;
  const reason = document.getElementById('danger-reason').value;

  if (!tempMarker) {
    alert('地図上をタップしてピンを置く場所を選んでください。');
    return;
  }

  // ポップアップをセットしてピンを確定
  tempMarker.bindPopup(`<b>【${type}】</b><br>${reason}`).openPopup();
  
  // 状態のリセット
  tempMarker = null;
  document.getElementById('danger-reason').value = '';
  closeBottomSheet();
  
  alert('仮投稿が完了しました！');
});

function closeBottomSheet() {
  pinSheet.classList.remove('active');
  if (tempMarker) {
    map.removeLayer(tempMarker);
    tempMarker = null;
  }
}

// 【4】Pull to Refresh（引っ張って更新）制御
let startY = 0;
let isPulling = false;
const ptrIndicator = document.getElementById('ptr-indicator');
const ptrArea = document.getElementById('map');

ptrArea.addEventListener('touchstart', e => {
  if (window.scrollY === 0) {
    startY = e.touches[0].clientY;
    isPulling = true;
  }
}, { passive: true });

ptrArea.addEventListener('touchmove', e => {
  if (!isPulling) return;
  const y = e.touches[0].clientY;
  const deltaY = y - startY;

  if (deltaY > 0 && deltaY < 120) {
    ptrIndicator.style.transform = `translateY(${deltaY}px)`;
  }
}, { passive: true });

ptrArea.addEventListener('touchend', e => {
  if (!isPulling) return;
  isPulling = false;
  const y = e.changedTouches[0].clientY;
  const deltaY = y - startY;

  if (deltaY > 60) {
    ptrIndicator.style.transform = 'translateY(60px)';
    setTimeout(() => {
      ptrIndicator.style.transform = 'translateY(0)';
      document.getElementById('map').style.opacity = 0.5;
      setTimeout(() => document.getElementById('map').style.opacity = 1, 300);
    }, 1000);
  } else {
    ptrIndicator.style.transform = 'translateY(0)';
  }
});
