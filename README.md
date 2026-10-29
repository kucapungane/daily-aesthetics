# 每日美學課程

每天早上 06:53 一堂查證過來源的美學課。網站：https://kucapungane.github.io/daily-aesthetics/

## 運作方式

1. 雲端排程「每日美學課程」每天 06:53 撰寫一堂課，存進 Google 雲端硬碟資料夾「每日美學課程」。
2. 雲端排程「每日美學課程：發布到網站」每天 07:30 檢查資料夾，把網站還沒有的課程用 `tools/import-lesson.py` 轉成 `lessons/NNN.html`，推到 `claude/` 開頭的分支。
3. GitHub Actions（`.github/workflows/pages.yml`）把該分支合併進 `main`，執行 `node build.mjs`，把 `dist/` 發布到 GitHub Pages。

## 課程檔格式：`lessons/NNN.html`

```html
<!-- lesson
number: 2
title: 模仿論
date: 2026-10-30
domain: 劇場
contrast: 音樂
doc: https://docs.google.com/document/d/…/edit
-->
<h2>今日重點</h2>
…八段 <h2>，與寫進 Google 文件的 HTML 相同…
```

- `number`、`title`、`date`（YYYY-MM-DD）必填；`domain` 是主例領域、`contrast` 是對照領域，用課綱的七個領域名稱。
- 段落開頭寫 `<strong>史料｜一句標題。</strong>`，網站會把類型顯示成來源標記。
- 今日練習的三步各用一段 `<p><strong>看（5 分鐘）</strong></p>`，網站會變成計時器。
- 圖片用 `<p><img src="…" width="…"></p>` 加下一段 `<p><em>圖 N｜…</em></p>`；圖片網址可以是 Wikimedia、quickchart，或放在 `lessons/img/` 的檔案。

## 搜尋引擎

每次建置都會產生 `sitemap.xml`（首頁、全部課程、每一堂）。Google Search Console 的驗證：把驗證碼填進 `build.mjs` 的 `GOOGLE_SITE_VERIFICATION`，或把 `googleXXXX.html` 驗證檔放進 `src/root/`。

## 在本機預覽

```bash
node build.mjs
```

輸出在 `dist/`。需要 Node 18 以上，沒有其他相依套件。

## 圖片授權

首頁與課程頁的圖片都是公有領域，來源與作者見 `credits.json` 與各頁頁尾。
