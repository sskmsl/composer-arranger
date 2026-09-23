# Genre と Sound Image の判断軸

Composer Arranger の既存 Song Profile は維持する。明示的に Genre を選んだ場合のみ、18 語を 12 個の連続した生成傾向へ変換する。複数選択は重みを正規化して特性値を合成し、完成済みのフレーズや伴奏を混ぜない。`Dorian` は mode、`Ritual` と `Finale` は dramaticRole として分類するが、UI の語彙は同じである。

Chord Generator の `.composer-song.json` に含まれる各 Section の `sourceIntent.style` は、Composer Arranger で小節長を重みにして Genre ブレンドへ引き継ぐ。従来の Song Profile 対応付けも残す。Chord Generator 自体は変更しない。

Sound Image は独立した 11 軸で、既存音の距離、余韻、アタック、広がり、透明度を扱う。今回の `atmospheric-depth` は 1984–85 年の制作者インタビューから、残響だけで空間を作るのではなく、処理した楽器の前後関係、乾いた声と効果音の配置、弾かない場所を組み合わせるという一般原理を採用した。特定レーベル・アーティストの音列や音色は保存していない。

- [1985 年の原インタビュー（Cocteau Twins 公式アーカイブ）](https://mail.cocteautwins.com/press-and-news/1985/02/01/digging-for-treasures-electronic-soundmaker-and-computer-music/)
- [1984 年の原インタビュー（Cocteau Twins 公式アーカイブ）](https://cocteautwins.com/press-and-news/1984/08/01/head-over-heels-with-the-cocteau-twins-electronics-and-music-maker/)

適用順は、主旋律保護と曲の密度判断 → Genre の演奏傾向 → Sound Image の配置と質感 → Section の役割 → 実音生成・候補評価。Genre は Phrase/Intro/Decoration の量、Groove、Bass movement、Harmony strategy、候補選択を変える。Sound Image は Director の追加予算を下げ、既存後景音の velocity・長さ・プレビュー上のアタック、減衰、左右の広がりを調整する。歌唱メロディの音列には適用しない。

同一コード・歌メロ・Tempo・Section・seed の自動比較では、`Sadcore / Slowcore` と `Hi-NRG` の Bass/closed-hat 音数、groove family、書き出し MIDI が異なることを確認する。Sound Image だけを変えた比較では、既存 Pad の velocity が下がり、長さと depth/decay が増え、トラック数が増えないことを確認する。Intro Motif、Phrase の計画、Director の追加予算、AI Partner Context も同条件で比較する。
