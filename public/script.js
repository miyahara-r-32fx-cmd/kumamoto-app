// Lucideアイコンの初期化
lucide.createIcons();

// --- 1. オープニングアニメーション制御 ---
window.addEventListener('DOMContentLoaded', () => {
  // アニメーション完了（約2.5秒）を待ってブラーとローディング画面を消す
  setTimeout(() => {
    const splash = document.getElementById('splash-screen');
    const appContainer = document.getElementById('app-container');
    
    splash.style.opacity = '0';
    appContainer.classList.remove('blurred');
    
    // フェードアウト後に完全に非表示（操作の邪魔にならないように）
    setTimeout(() => {
      splash.style.display = 'none';
      splash.style.pointerEvents = 'none';
    }, 500);
  }, 2500);
});

// --- 2. ハンバーガーメニュー制御 ---
const menuBtn = document.getElementById('menu-btn');
const navDrawer = document.getElementById('nav-drawer');
const drawerScrim = document.getElementById('drawer-scrim');
const menuItems = document.querySelectorAll('.menu-item');
const views = document.querySelectorAll('.view');

function toggleDrawer() {
  navDrawer.classList.toggle('open');
  drawerScrim.classList.toggle('visible');
}
menuBtn.addEventListener('click', toggleDrawer);
drawerScrim.addEventListener('click', toggleDrawer);

// タブ(画面)切り替え
menuItems.forEach(item => {
  item.addEventListener('click', (e) => {
    // アクティブ状態の切り替え
    menuItems.forEach(m => m.classList.remove('active'));
    e.currentTarget.classList.add('active');
    
    // 画面の切り替え
    const targetId = e.currentTarget.getAttribute('data-target');
    views.forEach(v => v.classList.remove('active-view'));
    document.getElementById(targetId).classList.add('active-view');
    
    // メニューを閉じる
    toggleDrawer();
    
    // マップ表示の場合、サイズ再計算 (Leaflet特有のバグ対策)
    if(targetId === 'map-view' && map) {
      setTimeout(() => map.invalidateSize(), 300);
    }
  });
});

// --- 3. ボトムシート (ピン詳細 UI) ---
const bottomSheet = document.getElementById('bottom-sheet');
const sheetScrim = document.getElementById('sheet-scrim');
const closeSheetBtn = document.getElementById('close-sheet-btn');

function openSheet(title, desc) {
  document.getElementById('sheet-title').textContent = title;
  document.getElementById('sheet-desc').textContent = desc;
  bottomSheet.classList.add('open');
  sheetScrim.classList.add('visible');
}
function closeSheet() {
  bottomSheet.classList.remove('open');
  sheetScrim.classList.remove('visible');
}
closeSheetBtn.addEventListener('click', closeSheet);
sheetScrim.addEventListener('click', closeSheet);

// --- 4. Leaflet マップ初期化 ---
const map = L.map('map', { zoomControl: false }).setView([32.803, 130.707], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors'
}).addTo(map);
// M3風のズームボタンを右下に配置
L.control.zoom({ position: 'bottomright' }).addTo(map);

// サンプルピン (タップでボトムシート展開)
const marker = L.marker([32.803, 130.707]).addTo(map);
marker.on('click', () => {
  openSheet("事故多発地点", "ここは夕方に見通しが悪くなり、自転車と歩行者の接触事故が多発しています。十分スピードを落としてください。");
});

// --- 5. アコーディオン (交通ルール) ---
document.querySelectorAll('.accordion-header').forEach(button => {
  button.addEventListener('click', () => {
    const item = button.parentElement;
    item.classList.toggle('active');
  });
});

// --- 6. Pull-to-Refresh (引っ張って更新) ---
const ptrArea = document.getElementById('ptr-area');
const ptrIndicator = document.getElementById('ptr-indicator');
let startY = 0;
let isPulling = false;

ptrArea.addEventListener('touchstart', e => {
  if (ptrArea.scrollTop === 0) {
    startY = e.touches[0].clientY;
    isPulling = true;
  }
}, { passive: true });

ptrArea.addEventListener('touchmove', e => {
  if (!isPulling) return;
  const y = e.touches[0].clientY;
  const deltaY = y - startY;
  // 下に引っ張る挙動
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
    // 更新処理を疑似的に実行
    ptrIndicator.style.transform = `translateY(60px)`;
    setTimeout(() => {
      // 完了したら戻す
      ptrIndicator.style.transform = `translateY(0)`;
      // ここにデータ再読み込み処理を書く (今回は簡易的に画面をフラッシュ)
      document.getElementById('map').style.opacity = 0.5;
      setTimeout(() => document.getElementById('map').style.opacity = 1, 300);
    }, 1500);
  } else {
    ptrIndicator.style.transform = `translateY(0)`;
  }
});


