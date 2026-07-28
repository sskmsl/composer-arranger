# Decoration Generator（Issue #71）

Decoration GeneratorはActive Melodyではなく、現在・前・次のSection、コード、終端を主要ContextとするStructure Driven Generatorである。

## MVP

- Type: Decorative Fill / Transition Fill / Ending Fill
- Character: Strings / Bell / Piano / Generic
- Length: 2 Beats / 4 Beats / 1 Bar
- Density: Sparse / Normal / Rich
- Direction: Rising / Falling / Mixed / Auto
- 固定Random Seed
- 24候補の内部プールから品質と多様性を考慮した10候補を提示
- 個別Preview、再生成、Favorite、Reject、Set Active、MIDI出力

Transition Fillは次Sectionの最初のコードを参照し、Root / Third / Fifth / Seventh / Tensionの候補へ着地する。Ending Fillは現在Sectionの最終コードへ着地する。候補間ではType、Shape、Rhythm Style、Register、Direction、Onsetを比較する。

## Counterとの責務分離

- Counter: Active Melodyの休符・Protected Moment・音域を主要Contextにする。
- Decoration: Section境界・次コード・終端を主要Contextにし、Active Melodyは任意の衝突評価にだけ使う。

候補は共通の`reactiveLayerCandidates`へ保存するが、採用枠はCounterとDecorationで分離する。このため両方を同じSectionの曲全体Preview / MIDIへ含められる。

生成後にSection構造またはコードが変わった候補は、`structureFingerprint`の不一致によりSet Activeを拒否し、再生成を促す。
