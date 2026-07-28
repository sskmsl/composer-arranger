# Decoration Generator（Issue #71）

Decoration GeneratorはActive Melodyではなく、現在・前・次のSection、コード、終端を主要ContextとするStructure Driven Generatorである。

## MVP

- Type: Decorative Fill / Transition Fill / Ending Fill
- Character: Strings / Bell / Piano / Generic
- Length: 2 Beats / 4 Beats / 1 Bar
- Density: Sparse / Normal / Rich
- Direction: Rising / Falling / Mixed / Auto
- 固定Random Seed
- 80候補以上の内部プールから品質と多様性を考慮した10候補を提示
- 個別Preview、再生成、Favorite、Reject、Set Active、MIDI出力

Transition Fillは次Sectionの最初のコードを参照し、Root / Third / Fifth / Seventh / Tensionの候補へ着地する。Ending Fillは現在Sectionの最終コードへ着地する。候補間ではType、Shape、Rhythm Style、Register、Direction、Onsetを比較する。

## Arranger Judgment

生成前にSilence Gateで、主旋律の密度、現在・前・次Sectionの採用済みReactive LayerとAccompaniment、Section推移、利用可能な休符を評価する。`silence`判定時は「装飾なし」を第一候補として案内し、比較用には控えめなGestureだけを生成する。

実音はTypeだけでなく、次の6つの音楽的役割から計画する。

- Response: 主旋律の呼吸後へ短く応答
- Transition: 次Sectionへ向かう推進と着地
- Ending: 終止後の余韻
- Swell: Phrase Boundaryを持続音と強弱で持ち上げる
- Pedal: 共通音を保持しHarmony変化を聴かせる
- Pickup: 次PhraseまたはSectionを弱起で先取り

配置基準は固定小節末ではなく、主旋律の休符、ロングトーンの解放点、Section終端から抽出する。Favorite / Reject履歴はCharacter、Shape、Rhythmの適合度へ反映するが、品質下限と多様性制約は維持する。

候補選抜ではRoleとShapeの種類数、階段状の順次進行、Onset差を優先しつつ、Quality 55% + Diversity 35% + Preference 10%で比較する。同一ノート列はVelocity差だけでは別案と見なさない。

短いMelody Gapへ通常の4拍用リズムセルを圧縮せず、Gap長とDensityに応じて最大発音数を制限する。Normalは全候補を同じ密度へ固定する指定ではなく、Pedal / Swell / 一部のResponseをSparse、推進目的の一部をRichに展開するバランス設定として扱う。余白を持つ候補を10案中最低3案確保し、密なFillだけへ選抜が偏らないようにする。

## Counterとの責務分離

- Counter: Active Melodyの休符・Protected Moment・音域を主要Contextにする。
- Decoration: Section境界・次コード・終端を主要Contextにし、Active Melodyは任意の衝突評価にだけ使う。

候補は共通の`reactiveLayerCandidates`へ保存するが、採用枠はCounterとDecorationで分離する。このため両方を同じSectionの曲全体Preview / MIDIへ含められる。

生成後にSection構造またはコードが変わった候補は、`structureFingerprint`の不一致によりSet Activeを拒否し、再生成を促す。
