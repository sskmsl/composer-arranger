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

1. コード進行とActive Melodyを解析し、Signature OpportunityとTarget Tone Pathを決める。
2. Opportunityに合うArchetypeと1〜2小節のRhythm Identityを決める。
3. Focused / Bold / RadicalのCreative Risk Planを決める。
4. Active MelodyのIdentity Cellを複製せず、反転・圧縮・局所変形したMotif PathとContourを決める。
5. 1 / 2 / 4 / 8小節のPhrase Architectureを選ぶ。
6. 各小節へDevelopment Stageを割り当てる。
7. Decoration Intentを構造上の必要箇所へ配置する。
8. Rhythm Skeletonへ反復・応答・断片化・余白と計画的な破調を反映する。
9. Pitch Pathを長期Target Toneへ接続し、意図的な非和声音・跳躍と解決関係を保持する。
10. 必要な構造点だけをBlock ChordまたはBroken Chordへ展開する。
11. 構成上の目的、品質、Creative Risk、候補間差を含むDiversity Selectionで12候補を選ぶ。

## Composition-aware Signature

Active Melodyが設定済みなら、冒頭数音をコピーするのではなく、3〜5音のIdentity Cell、Onset Gap、音域中心、密度を抽出する。コードからは共通音、3rd / 7th、明示テンション、最終到達音を小節をまたぐTarget Tone Pathとして計画する。

候補は次のSignature Opportunityを分担する。

- `motif-foreshadowing`: MelodyのIdentity Cellを反転・圧縮し、後の主旋律を予告する。
- `rhythmic-counter-identity`: Melodyと異なるAccent Mapで第二の識別リズムを作る。
- `harmonic-identity`: 共通音とGuide Toneを曲固有の音として定着させる。
- `tension-premonition`: 後続コードの緊張を早めに提示する。
- `register-contrast`: Melodyが入る音域を空けた入口を作る。
- `section-threshold`: セクション開始そのものを識別可能な演出にする。

Active Melodyが未設定でも停止せず、`harmonic-identity`、`tension-premonition`、`section-threshold`を使うChord Driven生成へ戻る。候補カードではOpportunityと `Melody Linked / Chord Driven` を表示する。

## Creative Risk

12候補を「安全な良案」だけへ収束させず、次の3段階を同じ候補セットへ残す。

- `focused`: 核の識別性を優先する比較基準。意図的な破調は加えない。
- `bold`: 一つの明確な違和感を作り、直後に音程またはMotifで回収する。
- `radical`: リズム、音程、構成の複数軸で予想を外しながら、後続の回帰でPhraseとして成立させる。

Rhythm DeviceはMetric Displacement、Asymmetric Cycle、Silence Fracture、Cross-bar Attackを使う。Pitch DeviceはInterval Signature、Chromatic Side-step、Register Rupture、Pedal Tensionを使う。Structural SurpriseはFalse Start、Interruption、False Return、Abrupt Open Tailを使う。

大胆さはアウトスケール音やランダムなタイミングの量では判定しない。`audacity`で逸脱の実現度、`controlledRisk`で跳躍後の反行回収・非和声音の解決・音域とグリッドの安全性、`surpriseCoherence`で驚きの後のMotif回帰を評価する。最終12案ではFocused / Bold / Radicalの配分と各Deviceの重複も選抜条件に含める。

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

### Pitch / Timing Alignment

- 核MotifのLead Noteは、Voicing適用後もPitch、Onset、Durationを変更しない。
- Broken ChordはLeadをアルペジオ終端へ移動せず、Lead発音後に支援声部だけを展開する。
- Rhythm Skeletonは16分音符単位へ揃え、次のLead Onsetを越えるDurationを短縮する。
- 統合Decorationは既存Leadの発音区間へ重ねず、実際のGapへ入る場合だけ採用する。
- 暗黙のDominant ColorはNatural 9th / 13thへ限定する。Altered Tensionはコード記号へ明示された場合だけ使用する。
- Pedal Toneは全対象コードでChord Toneとして成立する場合だけ計画し、成立しない場合はInner Motionへ切り替える。

## 評価

既存のIdentity、Opening Impact、Rhythmic Identity、Contour Identity、Development Potential、Standalone Strengthに加え、4〜8小節では次を評価する。

- `longRangeCoherence`: 冒頭の核が後半へ意味を持って回帰するか。
- `variationBalance`: 完全反復と無関係な変化の中間にあるか。
- `voicingQuality`: 和音化で主旋律の明瞭さを失っていないか。
- `voiceLeadingQuality`: 急な低声移動、全声部の同方向移動、共通音保持、Motion方針との一致を評価する。
- `audacity`: 計画した跳躍、破調、余白、構成上の断絶が実音へ現れたか。
- `controlledRisk`: 大胆な音程や非和声音が局所的に回収され、単なるズレになっていないか。
- `surpriseCoherence`: 予想を外した後に核Motifとの因果関係が戻るか。
- `harmonicNarrative`: 構造音が長期Target Tone Pathへ接続しているか。
- `thematicForeshadowing`: Active Melodyをコピーせず、関連するIdentityを予告しているか。
- `rhythmicComplement`: Melodyと認識可能な関係を保ちつつ別のAccent Mapを持つか。
- `compositionPurpose`: 選択されたSignature Opportunityが実音へ現れたか。

候補プールから最低品質とComposition Purposeを満たすものを選び、Opportunity、Archetype、Rhythm、Contour、Voicing、候補間類似度を同時に評価して12案へ絞る。固定Seedでは同じ候補を再現する。

## 互換性

既存Decoration候補と採用状態のデータ構造は、保存済みプロジェクトの互換性のため維持する。独立したDecorationタブは新規生成経路から外し、今後の装飾生成はSignature Phrase内の計画として行う。
