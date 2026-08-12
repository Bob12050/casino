# MIDNIGHT ARCADE

海外カジノのテーブルゲームと、日本のスロット・パチンコをまとめた無料ブラウザゲームです。

## Games

- **HANABI 3** — 3リール＋個別STOPボタンの和風スロット
- **ROUGE 37** — シングルゼロ方式のヨーロピアンルーレット
- **BLACK 21** — HIT / STAND / DOUBLE対応のブラックジャック
- **P SAKURA ∞** — 先バレ・4保留・SPリーチ・4R/10R大当たり・ST30回のRUSHを備えたデジタルパチンコ

## Features

- すべて換金できない仮想クレジットでプレイ
- 共通残高、総プレイ回数、最高獲得額をブラウザに自動保存
- PC・タブレット・スマートフォン対応
- キーボード操作、ライブリージョン、Reduced Motion対応
- 外部ライブラリ、画像、通信、課金なし

## Run locally

静的サイトなので、そのまま `index.html` を開くか、ローカルサーバーを起動してください。

```powershell
python -m http.server 4187
```

その後、`http://127.0.0.1:4187/` を開きます。

## Deploy

GitHub Pagesは `main` ブランチのルートを配信元として使用します。

