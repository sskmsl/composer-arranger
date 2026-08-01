# Signature Phrase Quality Architecture

Signature Phrase Generatorは、短い識別可能な核を作るだけでなく、その核を最大8小節まで音楽的に展開する。既存のDecoration Generatorが持っていた装飾語彙は独立候補として後付けせず、フレーズ計画の一部として統合する。

## 設計根拠

実装は特定の楽曲やアーティストを模倣せず、音楽認知・長期構造・反復に関する公開研究から次の原則を抽象化している。

- 記憶性は、短く認識しやすい初期モチーフと限定された音程語彙から作る。
- 快さは単純さと複雑さの中間にあるため、完全反復と無秩序な変化の双方を避ける。
- 長いフレーズでは、音符単位の変化だけでなく小節・フレーズ単位の自己参照を持たせる。
- 反復は同一コピーではなく、応答、断片化、音域移動、余白、装飾を伴う回帰として扱う。
- リズム骨格を音高より先に設計し、和音化しても核となるリズムと輪郭を保持する。

参考資料:

- [Predictability and Uncertainty in the Pleasure of Music](https://pmc.ncbi.nlm.nih.gov/articles/PMC6867811/)
- [What is missing in deep music generation?](https://arxiv.org/abs/2209.00182)
- [Hierarchical Structure in Popular Music](https://arxiv.org/abs/2010.07518)
- [MusicFrameworks: Hierarchical Melody Generation](https://arxiv.org/abs/2109.00663)
- [Melodic Features and Memorability](https://pmc.ncbi.nlm.nih.gov/articles/PMC10585939/)

## 生成パイプライン

1. Archetypeと1〜2小節のRhythm Identityを決める。
2. Motif PathとContourを決める。
3. 1 / 2 / 4 / 8小節のPhrase Architectureを選ぶ。
4. 各小節へDevelopment Stageを割り当てる。
5. Decoration Intentを構造上の必要箇所へ配置する。
6. Rhythm Skeletonへ反復・応答・断片化・余白を反映する。
7. Pitch Pathを配置し、意図的な非和声音と解決関係を保持する。
8. 必要な構造点だけをBlock ChordまたはBroken Chordへ展開する。
9. Quality GateとDiversity Selectionで12候補を選ぶ。

## Phrase Architecture

- `identity-return`: 核を提示し、変形後に識別可能な形で回帰する。
- `question-answer-return`: 問いと応答を作り、断片化を経て回帰する。
- `slow-burn-return`: 余白を保ちながら音域と緊張を遅く拡張する。

8小節では `establish`、`repeat`、`answer`、`fragment`、`register-lift`、`sparse-recall`、`decorated-return`、`open-tail` をArchitectureに応じて配列する。4小節以下は同じ考え方を圧縮して使う。

## Decoration統合

Decorationの `pickup`、`response`、`transition`、`swell`、`pedal`、`ending` とShape / Rhythm Styleを `SignatureDecorationIntent` として再利用する。装飾音は生成後の別レイヤーではなく、Rhythm SkeletonとPitch Pathの段階で組み込み、主モチーフのイベント位置を進めない。

Atmospheric系では音数追加より長音、共通音、余韻を優先する。駆動系ではPickup、Transition、反復アクセントを使い、身体的な運動を補強する。

## 和音化

Block ChordとBroken Chordは全音符へ機械的に適用しない。1小節につき最大1つの構造点だけを対象にし、Approach ToneとNeighbor Toneは和音化しない。これにより、音数の過密化、コード列への退行、主モチーフの輪郭消失を防ぐ。

和音候補は次のVoicing語彙を持つ。

- `close-position`: 狭い音域でまとまりを作る。
- `open-spread`: 低声と内声を開き、空間と透明感を作る。
- `drop-2`: 4声の第2上声を下へ開いた配置を優先する。
- `pedal-tone`: 複数コードで意味を持つ共通音を低声または内声へ保持する。
- `inner-motion`: 低声を安定させ、内声の小さな動きで和声変化を聴かせる。

各構造点では和音を新しく積み直さず、直前の`SignatureVoicingFrame`を参照する。低声・内声・上声を対応づけ、最大跳躍、共通音保持、平行移動を評価して次の転回形を選ぶ。Voice Motionは次の3方式を使う。

- `smooth`: 各声部の総移動量を抑える。
- `contrary`: Leadと反対方向へ動く内声または低声を作る。
- `oblique`: 1声を保持し、他声だけを動かす。

テンションは全和音へ常時追加せず、`register-lift`または`decorated-return`などの構造点だけで候補化する。Block ChordとBroken Chordは同じVoicing Frameを共有するため、同じ候補を同時和音とアルペジオのどちらで鳴らしても和声設計は一致する。

## 評価

既存のIdentity、Opening Impact、Rhythmic Identity、Contour Identity、Development Potential、Standalone Strengthに加え、4〜8小節では次を評価する。

- `longRangeCoherence`: 冒頭の核が後半へ意味を持って回帰するか。
- `variationBalance`: 完全反復と無関係な変化の中間にあるか。
- `voicingQuality`: 和音化で主旋律の明瞭さを失っていないか。
- `voiceLeadingQuality`: 急な低声移動、全声部の同方向移動、共通音保持、Motion方針との一致を評価する。

候補プールから最低品質を満たすものを選び、Archetype、Rhythm、Contour、Voicing、候補間類似度を同時に評価して12案へ絞る。固定Seedでは同じ候補を再現する。

## 互換性

既存Decoration候補と採用状態のデータ構造は、保存済みプロジェクトの互換性のため維持する。独立したDecorationタブは新規生成経路から外し、今後の装飾生成はSignature Phrase内の計画として行う。
