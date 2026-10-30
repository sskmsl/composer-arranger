# ブラウザによる復旧・生成検証（Issue #224・4番）

Playwright1.62.1を固定し、実Appを使うブラウザテストを追加。通常の公開distにはテスト入口・fixtureを含めず、別のdist-e2eへ同じApp/Workerを本番ビルドしてpreviewする。CIと手動Pagesの両方で既存build/Vitestの後に実行し、ブラウザ失敗からはPages artifactへ進まない。失敗時のみスクリーンショット/トレース/レポートを7日保存する。既存Node/Actionsの版、既存テスト・閾値は維持。Vitestから除外するのは新規e2e/**だけ。

## 実ブラウザ検証

1280pxと390pxの各11ケース、計22ケースすべて成功（45.4秒、再試行0）。

- 編集→端末保存→再読み込み、実MIDIダウンロードのMThdヘッダ。
- 保存のQuotaExceededErrorを注入→警告/編集保持→JSON実ファイル退避→復旧/再試行→再読込で最後の編集保持。
- 起動時のDB open失敗→読み込み中で停止せず→既存DBを消さず再試行。
- 更新reloadは保存失敗で中止、成功後に最後の編集を保持。不必要なbeforeunload確認も出さない（handlerはeffect解除前にも現在の保存状態を参照）。
- 遅延JSを遮断→ErrorBoundary→保存後reloadで復旧。
- Workerキャンセルで未適用。計算中の編集は旧結果に上書きされない。
- 実module Workerと同期処理の全生成JSON（createdAtだけ除く）が8条件で一致：4/4・3/4・6/8×seed19/41、部分変更recipe、履歴からの版復元。リフ診断も別輸送後に一致し、JSONへ追加しない。
- 前面のまま60秒後に更新を検知。実Worker成功で版が適用され、待機中にUIスレッドのタイマーが動く。
- 相談案は準備中に「変更なし」と表示せず、未準備で適用できない。完了後は適用できる。

保存順序の追加テスト前の統合Vitestは207ファイル成功/6skip、1585テスト成功/7skip（177.22秒）。その後、曲を切り替えて戻る保存順序のテストで修正前の失敗を確認し、キューの最新編集を末尾へ置く修正で保存関連7件成功。最新headの全体結果はPR本文に記録する。build成功、lintは既存importMidi.tsの警告1件のみ、actionlint成功。

証拠は同-evidenceのケース別結果・Worker一致結果・ログ。障害注入はAPIを制御しており、実ディスクを満杯にした試験ではない。認証入口を使わないローカルfixtureのため、認証/クラウド保存・外部AI呼出しは検証していない。OS保存ダイアログ、Safari、実機スマートフォン、聴感/DAWは未確認。390pxはChromiumのviewport検証である。

## 再現とCI

`npm ci`、`npx playwright install --with-deps chromium`、`npm run test:e2e`。Chromeを手元で使う場合はPLAYWRIGHT_CHROMIUM_EXECUTABLE_PATHを指定可能。CIは固定版が要求するChromiumを使う。外部サービスのキーをブラウザテストへ渡さない。

[Playwright公式CI手順](https://playwright.dev/docs/ci-intro)のブラウザ導入/実行/失敗証拠保存に沿う。全アプリテスト・build・lint/actionlintと各PRの最新結果はPR本文へ記録する。新規マージ/公開は所有者判断。
