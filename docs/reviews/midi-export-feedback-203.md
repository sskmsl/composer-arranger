# 曲全体MIDIの容量超過通知：Issue #203

基点 main `7e6959a4f348333d35a65dd4fa9116a61aac45f6`。

曲全体MIDIでGMの容量超過が起きたとき、書き出しボタン付近へ理由と対処（楽器を揃える/同時レイヤーを減らして再試行）を表示する。内部の例外名・tick・program番号は利用者に出さない。role=alertとボタンのaria-describedbyで関連づける。成功した再試行では案内を消し、別プロジェクトには前の案内を表示しない。

`SongMidiExportButton` が既存のボタンを置き換え、`prepareSongMidiExport` が容量例外だけを利用者向けの結果へ変換する。他の例外は同じままthrowし、正常時は既存のexportSongMidiとdownloadMidiを使う。音色の割当・音符・保存/交換形式・ダウンロード処理は変更しない。

## 検証

- 基線：197ファイル成功/6skip、1556テスト成功/7skip（166.54秒）。
- 実装後全体：198ファイル成功/6skip、1560テスト成功/7skip（175.76秒）。新規4件。整理後の対象4件も再成功。
- tsc -b/build成功。lintは既存importMidi.ts:174警告1件のみ。既存assert/fixture/hash/閾値の変更なし。
- 単体テストは16の異なる保存音色を同時に鳴らし、実際のGmChannelCapacityErrorを発生させる。案内の対処文・内部名非表示・入力不変を確認。
- GM/Logicの正常出力は既存exportSongMidiとバイト列一致。予期しない例外は通知に置き換えず伝播。初期状態は通知なし、空曲はボタン無効。
- 最終コードをローカルChromeで確認。実際の容量例外→通知・ダウンロード抑止、15楽器に減らした再試行→ダウンロード成功・通知消去、別projectで通知非表示、Logic形式で成功、予期しない例外のpageerror伝播を確認。390pxで横あふれなし。aria-describedbyが通知を参照する。

ブラウザ確認はshowSaveFilePickerを無効にし、既存のブラウザダウンロード経路を使った。OSネイティブ保存ダイアログ、実機スクリーンリーダー、DAWは未確認。既存の保存ダイアログ処理には変更していない。

## 再現

同-evidenceのbrowser.html/browser.tsxをそれぞれtools/pr203-browser.html、tools/pr203-browser.tsxへコピーしてViteを127.0.0.1:5183で起動する。Playwrightが利用できるNode環境でbrowser-check.mjsを実行する。PLAYWRIGHT_MODULEでモジュールの場所、CHROME_EXECUTABLEでChromeの場所、BASE_URLでローカルサーバーを指定できる。出力は/private/tmp/pr203-browser-result.json。終了後はtools内の一時2ファイルを削除する。通常CIにブラウザ用依存は追加していない。

本報告時点ではPRのCI・独立レビューは未完了。最新結果はPRへ記録する。マージは所有者判断。
