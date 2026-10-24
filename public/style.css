/* ベース設定 */
:root {
  --md-sys-color-primary: #00639b;
  --md-sys-color-on-primary: #ffffff;
  --md-sys-color-primary-container: #ceeaef;
  --md-sys-color-surface: #f8f9ff;
  --md-sys-color-on-surface: #191c20;
  --md-sys-color-surface-variant: #e1e2ec;
  --md-sys-color-outline: #74777f;
  --md-radius-large: 16px;
  --md-radius-full: 9999px;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  font-family: 'Noto Sans JP', sans-serif;
  -webkit-tap-highlight-color: transparent;
}

body, html {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--md-sys-color-surface);
  color: var(--md-sys-color-on-surface);
}

/* スプラッシュ画面 */
#splash-screen {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background-color: var(--md-sys-color-primary-container);
  display: flex;
  justify-content: center;
  align-items: center;
  transition: opacity 0.6s ease, visibility 0.6s;
}

#splash-screen.fade-out {
  opacity: 0;
  visibility: hidden;
}

.splash-content {
  text-align: center;
}

.splash-pin {
  width: 64px;
  height: 64px;
  color: var(--md-sys-color-primary);
  animation: bounce 1.2s infinite alternate cubic-bezier(0.5, 0.05, 0.1, 0.3);
}

.kinetic-text {
  display: flex;
  gap: 2px;
  margin-top: 16px;
  font-size: 1.2rem;
  font-weight: 700;
  color: var(--md-sys-color-primary);
}

.kinetic-text span {
  display: inline-block;
  animation: wave 1.5s infinite ease-in-out;
}

.kinetic-text span:nth-child(2) { animation-delay: 0.1s; }
.kinetic-text span:nth-child(3) { animation-delay: 0.2s; }
.kinetic-text span:nth-child(4) { animation-delay: 0.3s; }
.kinetic-text span:nth-child(5) { animation-delay: 0.4s; }
.kinetic-text span:nth-child(6) { animation-delay: 0.5s; }
.kinetic-text span:nth-child(7) { animation-delay: 0.6s; }

@keyframes bounce {
  from { transform: translateY(0); }
  to { transform: translateY(-24px); }
}

@keyframes wave {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

/* メインアプリ構造 */
#app-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  transition: filter 0.5s ease;
}

#app-container.blurred {
  filter: blur(8px);
}

/* App Bar */
.md3-app-bar {
  height: 64px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: var(--md-sys-color-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  z-index: 1000;
}

.app-title {
  font-size: 1.15rem;
  font-weight: 700;
}

.icon-btn {
  background: none;
  border: none;
  width: 40px;
  height: 40px;
  border-radius: var(--md-radius-full);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--md-sys-color-on-surface);
}

.icon-btn.filled-tonal {
  background-color: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-primary);
}

/* マップ */
.main-content {
  flex: 1;
  position: relative;
}

#map {
  width: 100%;
  height: 100%;
}

/* Pull to Refresh */
.ptr-indicator {
  position: absolute;
  top: -50px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--md-sys-color-surface);
  padding: 8px 16px;
  border-radius: var(--md-radius-full);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 1001;
  transition: transform 0.2s ease;
}

.spin-icon {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  100% { transform: rotate(360deg); }
}

/* ボトムシート */
.bottom-sheet {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--md-sys-color-surface);
  border-top-left-radius: 28px;
  border-top-right-radius: 28px;
  padding: 16px 24px 32px;
  box-shadow: 0 -4px 16px rgba(0,0,0,0.15);
  z-index: 2000;
  transform: translateY(100%);
  transition: transform 0.3s cubic-bezier(0.1, 0.9, 0.2, 1);
}

.bottom-sheet.active {
  transform: translateY(0);
}

.sheet-handle {
  width: 32px;
  height: 4px;
  background: var(--md-sys-color-outline);
  border-radius: 2px;
  margin: 0 auto 16px;
  opacity: 0.4;
}

.sheet-desc {
  font-size: 0.85rem;
  color: var(--md-sys-color-outline);
  margin-top: 4px;
  margin-bottom: 16px;
}

.input-group {
  margin-bottom: 12px;
}

.input-group label {
  display: block;
  font-size: 0.8rem;
  font-weight: 500;
  margin-bottom: 4px;
}

.m3-input {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: 8px;
  background: transparent;
  font-size: 0.95rem;
}

.sheet-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 20px;
}

.m3-btn {
  padding: 10px 20px;
  border-radius: var(--md-radius-full);
  border: none;
  font-weight: 500;
  cursor: pointer;
}

.text-btn {
  background: transparent;
  color: var(--md-sys-color-primary);
}

.filled-btn {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}
