# Counter Generator MVP（Issue #70）

Counter Generatorは、Active Melodyを置き換えず、その休符へ短い応答を置く独立Generatorである。

## 生成パイプライン

1. セクションのActive Melodyから休符、Protected Moment、音域、密度予算を抽出する。
2. Bell Response / Piano Echo / String Answer / Guitar Fill / Synth Whisperの各Styleを使い、9候補を独立生成する。
3. コードトーンと明示テンションを使って1〜4拍の応答を作り、主旋律の直前の動きに対する反対方向も候補へ含める。
4. Melody Respect、Harmonic Fit、Gap Usage、Register Separation、Motif Relationship、Section Fitを評価する。
5. Blocking Collisionと品質下限を確認し、Quality 65% + Diversity 35%のMMR型選抜で3候補を返す。

## 保存と再生

- Melody Variantとは混ぜず、`reactiveLayerCandidates`へ保存する。
- 候補は生成時の`targetMelodyVariantId`を保持する。Active Melodyが変わった候補は採用・再生しない。
- Set Activeした候補だけを曲全体再生とSong MIDIの独立Reactive Layerへ含める。
- Candidate MIDIはActive MelodyとCounter Melodyを別トラックで出力する。

## MVPの範囲

- Density、Register、Humanize等の手動パラメータは未実装。
- 楽器名は音楽的な生成Styleであり、Web Audioの音色選択やMIDI Program Changeは行わない。
- 同一セクションで採用できるReactive Layerは1件。複数Counterの同時採用は将来拡張とする。
