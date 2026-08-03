# Counter Generator MVP（Issue #70）

Counter Generatorは、Active Melodyを置き換えず、その意味を強める第二声部を提案する独立Generatorである。空白を埋めることを目的にせず、主旋律が語った後に何を返すか、どこで黙るか、どの緊張を残すかを音符より先に計画する。

標準生成では120件の独立候補プールから、品質下限、音楽的役割、Style、音程・リズム類似度を評価して10案を提示する。Technique A/B実験時はNormal 5案とTreatment 5案の合計10案とする。

## 生成パイプライン

1. セクションのActive Melodyから実休符、Protected Moment、ロングトーン後半、音域、密度予算を抽出する。
2. `CounterCompositionPlan`でCreative Risk、Dialogue Intent、Rhythm Grammar、Contour、Development、Ending、Register Relation、Phrase Count、Silence Ratioを決める。
3. 実休符を水増しせず、複数の離れたOpportunityへ呼びかけと応答を配置する。Bold / Radicalは音数を詰めず、複数箇所の因果関係で発展させる。
4. 16分音符グリッド上のRhythm Grammarを先に作り、その後でPitch Pathを配置する。
5. 階段上行・階段下降・Arch・Inverted Arch・Wave・Leap & Recovery・Pedal Breakを候補化し、Inversion、Fragmentation、Augmentation、Delayed Return、Register Exchange、Local Mutationで発展させる。
6. EndingはResolved、Open Fifth、Suspended、Motif Return、Silence Cutから選ぶ。各Gapで同じ終止を繰り返さず、最後のPhraseだけにEnding Strategyを適用する。
7. Melody Respect、Harmonic Fit、実Opportunityの利用、Register Separation、Counterpoint Fitに加えて、Dialogue、Independence、Rhythm、Contour、Breath、Development、Emotional Necessity、Audacity、Controlled Riskを評価する。
8. Blocking Collision、未解決の非和声音、品質下限を確認し、Risk配分と計画差を含むMMR型選抜で10候補を返す。

## Counter Composition Plan

- `Dialogue Intent`: Answer / Echo Transform / Counter-current / Shadow / Suspended Halo / Strategic Silence
- `Creative Risk`: Focused / Bold / Radical。Radicalも主旋律保護と解決条件を免除しない。
- `Rhythm Grammar`: Breath Answer / Long–Short / Syncopated Reply / Displaced Cell / Broken Pulse / Sparse Signal
- `Contour`: Ascending / Descending Staircase、Arch、Inverted Arch、Wave、Leap & Recovery、Pedal Break
- `Development`: Inversion、Fragmentation、Augmentation、Delayed Return、Register Exchange、Local Mutation
- `Ending`: Resolved / Open Fifth / Suspended / Motif Return / Silence Cut

音楽的な大胆さは、衝突やタイミングのズレではなく、予想外の輪郭、配置、終止、音域交換として実装する。大跳躍は反対方向へ回収し、解決が必要な非和声音には実音のTargetを持たせる。

## 採用安全性

- 実休符を越えてGap Usageを高く見せない。
- 最高音、長音、跳躍着地、非和声音解決などのProtected Momentを避ける。
- 同音、短2度、Voice Crossing、同方向の大跳躍をBlocking Collisionとして評価する。
- `Emotional Necessity`で、音がない方が良い箇所へ無理に置く候補を落とす。
- `Controlled Risk`で、和声適合、主旋律尊重、跳躍回収、非和声音解決を確認する。
- Focused / Bold / Radicalは品質下限を共有し、多様性のために低品質案を採用しない。

## 保存と再生

- Melody Variantとは混ぜず、`reactiveLayerCandidates`へ保存する。
- 候補は生成時の`targetMelodyVariantId`を保持する。Active Melodyが変わった候補は採用・再生しない。
- Set Activeした候補だけを曲全体再生とSong MIDIの独立Reactive Layerへ含める。
- Candidate MIDIはActive MelodyとCounter Melodyを別トラックで出力する。

## MVPの範囲

- Density、Register、Humanize等の手動パラメータは未実装。生成器が主旋律とSectionから自動計画する。
- 楽器名は音楽的な生成Styleであり、Web Audioの音色選択やMIDI Program Changeは行わない。
- 同一セクションで採用できるReactive Layerは1件。複数Counterの同時採用は将来拡張とする。
