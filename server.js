const express = require('express');
const path = require('path');
const app = express();

// publicフォルダの中に入っているHTMLやCSSなどを公開する設定
app.use(express.static(path.join(__dirname, 'public')));

// JSONデータ（ピンのデータなど）を受け取るための設定（今後の準備）
app.use(express.json());

// サーバーを起動する
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました！`);
});