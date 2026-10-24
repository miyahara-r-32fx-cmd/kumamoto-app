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

addBtn.addEventListener('click', () => {
  pinSheet.classList.add('active');
});

cancelPin.addEventListener('click', () => {
  closeBottomSheet();
});

map.on('click', (e) => {
  if (!pinSheet.classList.contains('active')) return;
  if (tempMarker) map.removeLayer(tempMarker);
  tempMarker = L.marker(e.latlng).addTo(map);
});

submitPin.addEventListener('click', () => {
  const type = document.getElementById('danger-type').value;
  const reason = document.getElementById('danger-reason').value;

  if (!tempMarker) {
    alert('地図上をタップしてピンを置く場所を選んでください。');
    return;
  }

  tempMarker.bindPopup(`<b>【${type}】</b><br>${reason}`).openPopup();
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

// 【4】交通安全クイズ機能の制御
const quizData = [
  {
    question: "自転車で歩道を走るとき、優先されるのはどちらでしょうか？",
    options: ["自転車", "歩行者", "どちらも対等"],
    answer: 1,
    explanation: "歩道は歩行者優先です。自転車はすぐに停止できる速度（徐行）で車道寄りを通行しなければなりません。"
  },
  {
    question: "夜間、自転車で走行する際にライトをつけることは法律上どう決められている？",
    options: ["努力義務（つければ良い）", "義務（必ず点灯）", "明るければ点灯不要"],
    answer: 1,
    explanation: "夜間のライト点灯は道路交通法上の義務です。無灯火走行は違反となります。"
  },
  {
    question: "自転車で傘を差しながら運転することは認められている？",
    options: ["雨が強い日はOK", "片手運転になるため禁止", "速度を落とせばOK"],
    answer: 1,
    explanation: "傘差し運転は片手運転となり、視界や安全操作を妨げるため禁止されています。"
  }
];

let currentQuizIndex = 0;

const menuBtn = document.getElementById('menu-btn');
const quizModal = document.getElementById('quiz-modal');
const closeQuizBtn = document.getElementById('close-quiz');
const quizNumberEl = document.getElementById('quiz-number');
const quizQuestionEl = document.getElementById('quiz-question');
const quizOptionsEl = document.getElementById('quiz-options');
const quizResultEl = document.getElementById('quiz-result');
const resultStatusEl = document.getElementById('result-status');
const resultExplanationEl = document.getElementById('result-explanation');
const nextQuizBtn = document.getElementById('next-quiz-btn');

// 左上ボタンでクイズ画面を開く
menuBtn.addEventListener('click', () => {
  currentQuizIndex = 0;
  loadQuiz(currentQuizIndex);
  quizModal.classList.remove('hidden');
});

closeQuizBtn.addEventListener('click', () => {
  quizModal.classList.add('hidden');
});

function loadQuiz(index) {
  const quiz = quizData[index];
  quizNumberEl.textContent = `第 ${index + 1} 問 / 全 ${quizData.length} 問`;
  quizQuestionEl.textContent = quiz.question;
  quizOptionsEl.innerHTML = '';
  quizResultEl.classList.add('hidden');

  quiz.options.forEach((opt, optIdx) => {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => checkAnswer(optIdx, quiz.answer, quiz.explanation));
    quizOptionsEl.appendChild(btn);
  });
}

function checkAnswer(selectedIndex, correctIndex, explanation) {
  const options = quizOptionsEl.querySelectorAll('.option-btn');
  options.forEach(btn => btn.disabled = true);

  if (selectedIndex === correctIndex) {
    resultStatusEl.textContent = '⭕ 正解！';
    resultStatusEl.className = 'result-status correct';
  } else {
    resultStatusEl.textContent = '❌ 残念…不正解';
    resultStatusEl.className = 'result-status wrong';
  }

  resultExplanationEl.textContent = explanation;
  quizResultEl.classList.remove('hidden');
}

nextQuizBtn.addEventListener('click', () => {
  currentQuizIndex++;
  if (currentQuizIndex < quizData.length) {
    loadQuiz(currentQuizIndex);
  } else {
    alert('全問終了です！お疲れ様でした。');
    quizModal.classList.add('hidden');
  }
});

// 【5】Pull to Refresh 制御
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
  const deltaY = e.touches[0].clientY - startY;
  if (deltaY > 0 && deltaY < 120) {
    ptrIndicator.style.transform = `translateY(${deltaY}px)`;
  }
}, { passive: true });

ptrArea.addEventListener('touchend', e => {
  if (!isPulling) return;
  isPulling = false;
  const deltaY = e.changedTouches[0].clientY - startY;
  if (deltaY > 60) {
    ptrIndicator.style.transform = 'translateY(60px)';
    setTimeout(() => {
      ptrIndicator.style.transform = 'translateY(0)';
    }, 1000);
  } else {
    ptrIndicator.style.transform = 'translateY(0)';
  }
});