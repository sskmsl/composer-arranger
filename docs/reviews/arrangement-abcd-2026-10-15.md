# A〜D 実装・測定報告（2026-10-15）

対象: f6abe3f を起点とした main。公開・デプロイはしていません。実音源での聴感評価ではなく、指定フィクスチャのMIDIノート単位の測定です。

## 実装

- A / 2f1b6cd: melodyBreathing.ts と store の新規生成後段で、フレーズ末尾の音を短縮して休符を作ります。音程・発音位置・音数は不変。セクション最終音は短縮しません。変奏でも土台の休符境界を保持します。取り込み／採用済み旋律を後から書き換えません。
- B / 2b05e3d: パッドのボイシングを55以上中心に整理。lowRegisterSeparation.ts を仕上げとCriticで共有し、低弦と近い低音をオクターブで分離します。ピッチクラスと音数は維持。新しいコードでは和声の入口を弾き直します。
- C / 52d01dd、e818ac8: ジャンル・歌の密度・保続低音の既存挙動を保ち、役割別リズムと短い半音アプローチを追加。サビではキックに同期。サブ層はアプローチ音を持続複製しません。間奏にも持続低音を置き、モチーフ受け渡しでコード頭・分数コードの指定低音が消えないようにしました。
- D: GeneratedArrangementNote.voiceId を任意項目で追加。パッドは3声、単旋律の弦は1声として生成時に付与し、派生・演奏処理・Criticでも保持。発音時刻順の同一声部だけで10半音以上の跳躍を数えます。IDなしの旧データは従来strideを厳密に維持。拍当たり密度比は診断にだけ追加しました。
- 回帰対応: 候補が変わっても、サビ2の層数・大サビへの強弱差を保持。奥行きの指定で近景の鋭い装飾が増えないようにしました。明示的な音の指示は優先します。

品質下限76、減点の重み、Auditionの閾値は変更していません。

## A: 息継ぎ

|指標|修正前（今回再測定）|最終|
|---|---:|---:|
|休符のない8小節以上のセクション|17|0|
|休符を含む4小節区間|126/192 (65.63%)|184/192 (95.83%)|
|総ノート数|2499|2499|
|1小節あたりの音数|3.25|3.25|

全108セクションのうち8小節以上は84セクション。今回の起点では17件で、ご提示の27件とは一致しませんでした。フック・末尾の和声と長さ・繰り返し変奏の既存基準は回帰テストで維持しています。

## B: 低域の濁り

|曲/seed|修正前|B終了時|最終|パッド音数 前→最終|
|---|---:|---:|---:|---:|
|A/1|8.01%|0.20%|0.00%|142 → 133|
|A/2|8.01%|0.00%|0.00%|136 → 148|
|A/3|13.28%|3.13%|0.00%|157 → 127|
|B/1|12.30%|0.00%|0.00%|104 → 100|
|B/2|6.64%|0.00%|0.00%|107 → 127|
|B/3|10.55%|0.59%|0.00%|98 → 121|
|平均／音数合計|9.80%|0.65%|0.00%|744 → 756|

パッド総音数は修正前の101.61%。90%の判定は6回合計の総数です。個別のA/3は候補選抜も変わり、音数は修正前の約81%です。この個別減少は残っています。

### 組み合わせ別（6回合計）

|組み合わせ|修正前の検出ペア数|最終|
|---|---:|---:|
|str-cello / syn-dark-pad|144|0|
|syn-bass / syn-dark-pad|69|0|
|syn-dark-pad / syn-dark-pad|63|0|
|str-cello / syn-pad-motion|34|0|
|syn-bass-mid / syn-dark-pad|30|0|
|str-contrabass / syn-bass|26|0|
|str-cello / syn-bass|21|0|
|str-contrabass / syn-dark-pad|21|0|
|syn-bass / syn-pad-motion|16|0|
|str-contrabass / syn-bass-mid|14|0|
|str-cello / syn-bass-mid|11|0|
|syn-dark-pad / syn-pad-motion|10|0|
|syn-bass-mid / syn-pad-motion|9|0|
|str-contrabass / syn-arp-low|3|0|
|syn-chord-wide / syn-dark-pad|3|0|
|syn-chord-wide / syn-pad-motion|3|0|
|syn-dark-pad / syn-pulse|2|0|
|str-contrabass / syn-pulse|2|0|
|syn-sub-bass / syn-sub-bass|1|0|
|syn-bass / syn-pulse|1|0|
|str-cello / syn-pulse|1|0|
|str-cello / syn-arp-low|1|0|
|syn-bass / syn-sub-bass|1|0|
|str-cello / syn-chord-wide|1|0|
|str-contrabass / syn-chord-wide|1|0|
|syn-arp-low / syn-dark-pad|1|0|

同一フレームで複数ペアがあるため、ペア数と濁りフレーム数は一致しません。

## C: ベース（role別）

比率はroleごとの全測定の合計、リズム種類数は各セクションの最小〜最大。

|役割|アプローチ率 前→後|リズム種類 前→後|キック同時率 前→後|コード頭の指定低音一致率 前→後|
|---|---:|---:|---:|---:|
|イントロ|0.00% → 0.00%|1〜3 → 1〜3|52.94% → 61.76%|75.00% → 100.00%|
|Aメロ|0.00% → 14.29%|1〜4 → 2〜5|54.13% → 62.04%|100.00% → 100.00%|
|Bメロ|23.81% → 69.05%|2〜4 → 4〜6|66.91% → 76.23%|97.92% → 100.00%|
|サビ|16.67% → 100.00%|1〜4 → 3〜5|61.85% → 99.63%|93.14% → 100.00%|
|大サビ|14.29% → 100.00%|2〜3 → 4〜7|35.00% → 100.00%|70.59% → 100.00%|
|間奏|0.00% → 0.00%|1〜1 → 2〜3|— → —|0.00% → 100.00%|
|アウトロ|0.00% → 0.00%|1〜1 → 1〜1|— → —|100.00% → 100.00%|

コード頭の指定低音は393/393、分数コードも全件一致。休符の演出・静かな保続低音の既存テストも維持。アプローチは次コードへ解決する短いedge音です。

## D: 同一出力での新旧比較

同じ最終トラックを旧方式／新方式で再計算した値です。候補選抜自体も変わるため、起点の品質点とは別に比較します。

|曲/seed|パッド 旧/新|チェロ 旧/新|ヴィオラ 旧/新|Vln1 旧/新|Vln2 旧/新|品質 旧→新|拍当たり密度比（診断のみ）|
|---|---:|---:|---:|---:|---:|---:|---:|
|A/1|2/9|0/0|0/0|0/0|0/0|87.67 → 79.67|21.63|
|A/2|6/23|0/0|0/0|0/0|0/0|80.61 → 80.61|23.67|
|A/3|3/14|0/0|0/0|0/0|0/0|87.77 → 81.77|22.33|
|B/1|4/5|0/0|0/0|0/0|0/0|84.00 → 82.00|17.29|
|B/2|5/14|0/0|0/0|0/0|0/0|83.20 → 81.20|19.25|
|B/3|1/9|0/0|0/0|0/0|0/0|90.62 → 80.62|16.63|

今回は誤減点の解消だけでなく、旧方式の見逃しも検出しました。新方式の件数が多く、品質点が上がった結果ではありません。閾値・重みは据え置きで減点を受け入れています。

### 新方式で残った跳躍（全件）

|曲/seed|トラック|セクション|小節|声部|前の拍→次の拍|前の音→次の音|半音数|
|---|---|---|---:|---|---|---|---:|
|A/1|syn-dark-pad|Aメロ|9|syn-dark-pad:voice:1|16.00 → 34.75|60 → 48|12|
|A/1|syn-dark-pad|Aメロ|9|syn-dark-pad:voice:2|16.00 → 34.75|52 → 65|13|
|A/1|syn-dark-pad|Aメロ|10|syn-dark-pad:voice:1|34.75 → 36.00|48 → 59|11|
|A/1|syn-dark-pad|Aメロ|12|syn-dark-pad:voice:2|40.00 → 44.00|64 → 52|12|
|A/1|syn-dark-pad|Aメロ2|34|syn-dark-pad:voice:2|121.50 → 132.00|53 → 64|11|
|A/1|syn-dark-pad|サビ2|38|syn-dark-pad:voice:1|144.50 → 148.00|48 → 59|11|
|A/1|syn-dark-pad|間奏|46|syn-dark-pad:voice:2|176.00 → 180.00|65 → 53|12|
|A/1|syn-dark-pad|間奏|47|syn-dark-pad:voice:2|180.00 → 184.00|53 → 64|11|
|A/1|syn-dark-pad|間奏|50|syn-dark-pad:voice:2|195.00 → 196.00|65 → 52|13|
|A/2|syn-dark-pad|イントロ|2|syn-dark-pad:voice:2|0.00 → 4.00|52 → 64|12|
|A/2|syn-dark-pad|イントロ|3|syn-dark-pad:voice:2|4.00 → 8.00|64 → 53|11|
|A/2|syn-dark-pad|イントロ|4|syn-dark-pad:voice:2|8.00 → 14.25|53 → 64|11|
|A/2|syn-dark-pad|Aメロ|6|syn-dark-pad:voice:2|16.00 → 20.00|64 → 52|12|
|A/2|syn-dark-pad|Aメロ|8|syn-dark-pad:voice:1|25.00 → 30.50|60 → 48|12|
|A/2|syn-dark-pad|Aメロ|8|syn-dark-pad:voice:2|25.00 → 30.50|53 → 65|12|
|A/2|syn-dark-pad|Aメロ|9|syn-dark-pad:voice:2|30.50 → 32.00|65 → 53|12|
|A/2|syn-dark-pad|Aメロ|9|syn-dark-pad:voice:1|30.50 → 32.00|48 → 60|12|
|A/2|syn-dark-pad|Aメロ|11|syn-dark-pad:voice:2|32.00 → 41.00|53 → 64|11|
|A/2|syn-dark-pad|Aメロ|12|syn-dark-pad:voice:2|41.00 → 44.00|64 → 52|12|
|A/2|syn-dark-pad|サビ|24|syn-dark-pad:voice:2|88.00 → 92.00|64 → 52|12|
|A/2|syn-dark-pad|サビ|25|syn-dark-pad:voice:2|92.00 → 96.75|52 → 65|13|
|A/2|syn-dark-pad|Aメロ2|30|syn-dark-pad:voice:2|112.00 → 116.00|64 → 52|12|
|A/2|syn-dark-pad|Aメロ2|32|syn-dark-pad:voice:1|121.00 → 124.00|60 → 48|12|
|A/2|syn-dark-pad|Aメロ2|32|syn-dark-pad:voice:2|121.00 → 124.00|53 → 65|12|
|A/2|syn-dark-pad|Aメロ2|33|syn-dark-pad:voice:1|124.00 → 128.00|48 → 60|12|
|A/2|syn-dark-pad|Aメロ2|34|syn-dark-pad:voice:1|128.00 → 132.00|60 → 47|13|
|A/2|syn-dark-pad|Aメロ2|35|syn-dark-pad:voice:1|132.00 → 136.00|47 → 60|13|
|A/2|syn-dark-pad|サビ2|40|syn-dark-pad:voice:2|152.00 → 156.00|64 → 52|12|
|A/2|syn-dark-pad|サビ2|41|syn-dark-pad:voice:2|156.00 → 160.75|52 → 65|13|
|A/2|syn-dark-pad|サビ2|43|syn-dark-pad:voice:2|164.00 → 168.00|64 → 53|11|
|A/2|syn-dark-pad|間奏|52|syn-dark-pad:voice:2|200.00 → 204.00|64 → 52|12|
|A/2|syn-dark-pad|大サビ|60|syn-dark-pad:voice:2|232.00 → 236.00|67 → 54|13|
|A/3|syn-dark-pad|イントロ|4|syn-dark-pad:voice:2|8.00 → 13.00|53 → 64|11|
|A/3|syn-dark-pad|Aメロ|7|syn-dark-pad:voice:1|16.00 → 24.00|60 → 48|12|
|A/3|syn-dark-pad|Aメロ|9|syn-dark-pad:voice:2|24.00 → 32.00|65 → 53|12|
|A/3|syn-dark-pad|Aメロ|9|syn-dark-pad:voice:1|24.00 → 32.00|48 → 60|12|
|A/3|syn-dark-pad|Aメロ|11|syn-dark-pad:voice:2|38.50 → 41.75|52 → 64|12|
|A/3|syn-dark-pad|サビ|27|syn-dark-pad:voice:2|102.00 → 104.00|64 → 53|11|
|A/3|syn-dark-pad|Aメロ2|31|syn-dark-pad:voice:1|112.00 → 120.00|60 → 48|12|
|A/3|syn-dark-pad|Aメロ2|33|syn-dark-pad:voice:1|124.00 → 128.00|48 → 60|12|
|A/3|syn-dark-pad|Aメロ2|34|syn-dark-pad:voice:2|128.00 → 132.00|65 → 52|13|
|A/3|syn-dark-pad|Aメロ2|35|syn-dark-pad:voice:2|132.00 → 136.00|52 → 64|12|
|A/3|syn-dark-pad|サビ2|43|syn-dark-pad:voice:2|166.00 → 168.00|64 → 53|11|
|A/3|syn-dark-pad|間奏|49|syn-dark-pad:voice:2|180.00 → 193.25|53 → 65|12|
|A/3|syn-dark-pad|大サビ|56|syn-dark-pad:voice:2|216.00 → 220.00|66 → 54|12|
|A/3|syn-dark-pad|大サビ|57|syn-dark-pad:voice:2|220.00 → 224.25|54 → 67|13|
|B/1|syn-dark-pad|Verse 2|33|syn-dark-pad:voice:2|112.00 → 128.00|64 → 53|11|
|B/1|syn-dark-pad|Verse 2|33|syn-dark-pad:voice:1|112.00 → 128.00|48 → 60|12|
|B/1|syn-dark-pad|Verse 2|35|syn-dark-pad:voice:2|128.00 → 136.00|53 → 65|12|
|B/1|syn-dark-pad|Verse 2|36|syn-dark-pad:voice:2|136.00 → 140.00|65 → 50|15|
|B/1|syn-dark-pad|Bridge|52|syn-dark-pad:voice:2|199.75 → 204.00|62 → 72|10|
|B/2|syn-dark-pad|Intro|3|syn-dark-pad:voice:2|5.75 → 8.00|50 → 64|14|
|B/2|syn-dark-pad|Intro|4|syn-dark-pad:voice:2|8.00 → 12.00|64 → 53|11|
|B/2|syn-dark-pad|Verse|7|syn-dark-pad:voice:2|17.00 → 27.25|52 → 64|12|
|B/2|syn-dark-pad|Verse|8|syn-dark-pad:voice:2|27.25 → 28.00|64 → 52|12|
|B/2|syn-dark-pad|Verse|9|syn-dark-pad:voice:1|28.00 → 32.00|60 → 48|12|
|B/2|syn-dark-pad|Verse|9|syn-dark-pad:voice:2|28.00 → 32.00|52 → 65|13|
|B/2|syn-dark-pad|Verse|11|syn-dark-pad:voice:1|32.00 → 42.25|48 → 60|12|
|B/2|syn-dark-pad|Verse 2|32|syn-dark-pad:voice:2|112.00 → 124.00|64 → 52|12|
|B/2|syn-dark-pad|Verse 2|33|syn-dark-pad:voice:1|124.00 → 128.00|60 → 48|12|
|B/2|syn-dark-pad|Verse 2|33|syn-dark-pad:voice:2|124.00 → 128.00|52 → 65|13|
|B/2|syn-dark-pad|Verse 2|34|syn-dark-pad:voice:1|128.00 → 132.00|48 → 60|12|
|B/2|syn-dark-pad|Bridge|49|syn-dark-pad:voice:2|190.75 → 192.00|64 → 53|11|
|B/2|syn-dark-pad|Bridge|52|syn-dark-pad:voice:2|200.00 → 204.00|64 → 84|20|
|B/2|syn-dark-pad|Outro|63|syn-dark-pad:voice:0|244.00 → 248.00|73 → 83|10|
|B/3|syn-dark-pad|Verse|8|syn-dark-pad:voice:2|16.00 → 31.00|64 → 52|12|
|B/3|syn-dark-pad|Verse|8|syn-dark-pad:voice:1|16.00 → 31.00|48 → 60|12|
|B/3|syn-dark-pad|Verse 2|32|syn-dark-pad:voice:2|112.00 → 124.00|64 → 52|12|
|B/3|syn-dark-pad|Verse 2|32|syn-dark-pad:voice:1|112.00 → 124.00|48 → 60|12|
|B/3|syn-dark-pad|Verse 2|33|syn-dark-pad:voice:2|124.00 → 128.00|52 → 65|13|
|B/3|syn-dark-pad|Verse 2|34|syn-dark-pad:voice:2|128.00 → 132.00|65 → 52|13|
|B/3|syn-dark-pad|Bridge|49|syn-dark-pad:voice:2|190.75 → 192.00|64 → 53|11|
|B/3|syn-dark-pad|Bridge|52|syn-dark-pad:voice:1|200.00 → 204.00|60 → 50|10|
|B/3|syn-dark-pad|Final Chorus|54|syn-dark-pad:voice:2|208.50 → 212.00|50 → 64|14|

## 全体（6回）

|曲/seed|eligibleCount|品質 起点→最終|和声違反|Audition|主旋律衝突|登録GM/GM2番号からの逸脱|
|---|---:|---:|---:|---:|---:|---:|
|A/1|6|85.07 → 79.67|0|96.90|0|0|
|A/2|8|81.00 → 80.61|0|96.70|0|0|
|A/3|8|82.50 → 81.77|0|96.90|0|0|
|B/1|8|80.50 → 82.00|0|96.70|0|0|
|B/2|8|82.50 → 81.20|0|96.20|0|0|
|B/3|7|80.00 → 80.62|0|96.70|0|0|

品質ゲート通過6/6。品質平均80.98（起点81.93）、Audition平均96.68。和声違反・主旋律衝突・登録ドラム音高からの逸脱は全件0。

## 検証

- vitest: 1319 passed、7 skipped（既存。今回スキップ追加・変更なし）。159ファイル成功、既存6ファイルskip。
- tsc -b: 成功。buildでも再実行。
- lint（oxlint）: 成功。
- build: 成功。Vite native configと大きなchunkの警告あり。
- 旧保存データ: JSON保存→normalizeProject→品質再計算が完全一致。voiceIdなしの件数は旧strideの診断と一致。
- 音源設定だけを変えた3種類のMIDI不変性、取り込み旋律保護、無音、ドラム音高保護、主旋律衝突、区切り・アウトロ・転調・変奏の既存回帰テストも全件対象。

### 追加・変更したテスト

- melodyBreathing.test.ts: 休符の形成、音数・発音位置・音程・最終音保持、入力非破壊。
- repeatedSectionMelody.test.ts: 土台の休符境界の保持。
- lowRegisterSeparation.test.ts: 低音近接、ピッチクラス・音数、編集範囲、ベース・ドラム不変。
- supportVoiceLeaps.test.ts: 間引き後の別声部誤検知、10半音以上の検出と9半音除外、旧データ互換、時刻順比較。
- arrangementReviewMeasurement.test.ts: 休符・濁り・ベースの基準、全6回通過・平均品質80・平均Audition95、旧保存互換、登録ドラム番号、既存の変奏・転調・演出・終止維持。

## 留意点

実音源での試聴は未実施。背景の実際の跳躍は上記のとおり残ります。Dは正しく数える修正であり、全跳躍を消す修正ではありません。固定2曲の基準を満たしたことを、すべての曲・音源での聴感完成と同一視していません。
