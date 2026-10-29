# Issue #218: リフの不採用理由と検証の拡充

## 変更

PR #219 (7b1bf54) を基点に、実際に試したリフ候補の棄却箇所へ診断だけを追加。既存の全曲案パネルへ、短いフレーズ・境界の重なり・品質バランスに対応した説明を表示する。最終結果で鳴る区間は不採用表示から除く。複数の試行で棄却された場合、最後に実際に得た理由を使う（すべての候補の唯一の原因とは限らない）。音作り指示による自動追加停止も説明する。

診断は生成オブジェクトをキーとするWeakMapだけに保持し、保存形式・JSON・MIDIへ追加しない。保存から開いたデータや別オブジェクトへ組み直した結果では理由を推測せず表示しない。候補順序・採否・音符・品質閾値は変更していない。

## 検証

- 新規9テスト成功。表示4件、3/4・6/8×seed19/41の実MIDI4件、保存音色/ミュートと再生成1件。seed19は両拍子で実リフ採用を必須とし、seed41の正当な不採用も検証する。全4条件で採用されるとは主張しない。
- 実主旋律・ベースの存在を確認したうえで、旋律との近接重なり、ベースとの半音、音域、境界窓（前2/後4、休符1、最大2層）を確認。保存往復のMIDI一致、保存音色program29/ミュート保持、指定トラック以外の不変を確認。
- 全体199ファイル成功/6skip、1565テスト成功/7skip、187.17秒。tsc/build成功、lint既存警告1件（importMidi.ts）。既存テスト・fixture・閾値の変更なし。
- 最新main7e6959aとの24条件でcreatedAtのみ除いた全生成結果hashが一致。A/B×3ジャンル×3seedと、13区間×16小節/4/4・3/4・6/8×2seed。診断をJSONへ漏らさないことも検証。
- 実Chrome、390px幅で既知のサビ2の説明、保存データでの非表示、長い区間名の横あふれなし、音作り指示の説明、pageerrorなしを確認。

## 試聴・DAW確認の材料

同-evidence/listeningに9個の実MIDIとmanifestを用意。review-aはA/neo/seed19、review-bはB/electro/seed41、meter-3-4は13区間×16小節/seed19。各ケースの-gmは曲全体GM、-logicは曲全体の従来Logic形式、-riffはリフ単体。manifestに区間開始小節とリフ発音小節数を記録。

確認時はまず曲全体GMを読み込み、manifestの区間位置でリフの入り/抜け、旋律の聞き取りやすさ、低音の濁りを聴く。次に-riff単体でフレーズと休符を確認。Logic形式は既存のパート音源を割り当て、同じ区間の配置・長さを照合する。3/4では拍子と小節位置も確認する。音量や音源差があるためGM/Logicの音色一致は求めない。

**実際の聴感評価、実機GM音源、DAWへの読み込みは未実施。** manifestのlisteningPerformed/dawVerifiedもfalseのまま。自動検証と材料準備は完了したが、この人間による確認は残る。

## 再現

`npm test -- --run src/app/GuitarRiffDecisionNotice.test.tsx src/melody-engine/guitarRiffMeters.test.ts --maxWorkers=1`。全体は`npm test -- --maxWorkers=2`。証拠スクリプトは通常テスト対象から外した.tsとして保存。listening-material.tsをtools/配下の一時.test.tsへ置く場合、fixture importを./qa/riffMeterSongへ向け、出力先ディレクトリを作って実行する。ブラウザは同梱harnessをtools/pr218-browser.{html,tsx}へ戻してVite5184で実行（Playwright/Chromeパスは環境に合わせる）。
