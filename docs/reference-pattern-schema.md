# 演出パターン参照データ: Step 2a resolver棚卸し

> この文書は実装前の棚卸し記録である。現在の正式な設計境界は
> `docs/composer-intelligence/architecture.md`、実装済みの軸一覧は
> `docs/composer-intelligence/generator-axis-inventory.md`を参照すること。
> 実行時のGeneratorは参照データやGenreを直接読まず、
> 匿名化された`ResolvedComposerRules`だけを受け取る。

4つのGenerator(Decoration / Counter / Phrase / Melody)が実際に扱っている軸を、既存コードの型定義から棚卸しした。参照データスキーマの「共通コア」と「Generator別拡張」を、この棚卸しに基づいて確定する。

外部の演出パターン参照データそのもの(実在アーティスト・楽曲名を含むファイル)はこのリポジトリには含めない。ここに書くのはComposer Arranger自身のコード構造の分析のみ。

## 各Generatorの現在の軸

### Decoration Generator (`src/melody-engine/decorationGenerator.ts`, 型は `src/core/reactiveLayer.ts`)

| 軸 | 型/値 |
| --- | --- |
| type | `decorative-fill` \| `transition-fill` \| `ending-fill` |
| gestureRole | `response` \| `transition` \| `ending` \| `swell` \| `pedal` \| `pickup` |
| character | `strings` \| `bell` \| `piano` \| `generic` |
| shape | `rising` \| `falling` \| `sequence` \| `repeated-sequence` \| `turn` \| `neighbor-motion` \| `arpeggiated-fill` \| `suspense` \| `sparse-accent` |
| rhythmStyle | `eighth` \| `sixteenth` \| `triplet` \| `syncopation` \| `dotted` \| `legato` \| `staccato` |
| direction | `rising` \| `falling` \| `mixed` |
| density | `sparse` \| `normal` \| `rich`(候補全体で1つの静的値。時間軸で変化する「densityCurve」は現状持たない) |
| register | `low` \| `middle` \| `high` |
| placementBeat / phraseBoundaryBeat | 連続値(Phrase Boundary起点からの配置) |
| needLevel | `recommended` \| `optional` \| `silence`(Silence Gate) |

### Counter Generator (`src/melody-engine/counterGenerator.ts`)

| 軸 | 型/値 |
| --- | --- |
| generatorStyle | `bell-response` \| `piano-echo` \| `string-answer` \| `guitar-fill` \| `synth-whisper` |
| role | `answer-phrase` \| `motif-echo` \| `counterline` \| `gap-fill` \| `suspension-layer` |
| preferredSide(register相当) | `analysis`(主旋律に追従) \| `below` \| `above` |
| direction | 明示的な列挙型は無し。`contourSteps`が`inverseDirection`(主旋律直前の動きの逆)を内部計算するのみで、候補のメタデータとしては公開されていない |
| density | 明示的な設定項目は無し(StylePlanごとのnoteCount/durationsで固定) |

### Phrase Generator (`src/phrase-engine/generatePhrases.ts`, 型は `src/core/phrase.ts`)

| 軸 | 型/値 |
| --- | --- |
| contour | `ascending` \| `descending` \| `arch` \| `inverted-arch` \| `wave` |
| rhythmCharacter | `flowing` \| `syncopated` \| `breathing` \| `sustained` |
| harmonicApproach | `chord-anchored` \| `common-tone` \| `tension-release` \| `anticipatory` |
| cadence | `resolved` \| `open` \| `suspended` \| `carry-forward` |
| density / restRatio / leapAmount | 連続値(0〜1) |
| climaxPosition | 連続値(0〜1、フレーズ内の相対位置) |
| pickupBeats | 連続値 |

### Melody Generator (`src/melody-engine/*`, 型は `src/core/melody.ts`)

かなり多層。候補のDNA (`CandidateMelodyDNA`) とOpening Intent/Planに分かれる。

| 軸 | 型/値 |
| --- | --- |
| motifIdentity | `stepwise-cell` \| `turn-cell` \| `leap-recovery` \| `repeated-cell` \| `chromatic-cell` |
| rhythmGrammar | `sustained` \| `balanced` \| `syncopated` \| `speech-like` \| `cyclic` |
| phraseArchitecture | `balanced` \| `call-response` \| `long-arc` \| `asymmetric` \| `cyclic` |
| harmonicResponse | `chord-following` \| `common-tone` \| `anticipatory` \| `delayed-resolution` \| `tension-hold` |
| registerTrajectory | `rising` \| `falling` \| `arch` \| `terraced` \| `contained` |
| developmentStrategy | `literal-return` \| `sequence` \| `fragmentation` \| `augmentation` \| `delayed-return`(概略) |
| climaxPlan.type | `pitch-peak` \| `rhythmic-peak` \| `tension-peak` |
| climaxPlan.position | `early` \| `middle` \| `late` |
| endingStrategy | `resolved` \| `open` \| `suspended` \| `carry-forward` |
| SectionTransitionStrategy | `resolved` \| `suspended` \| `open` \| `carry-over` \| `pickup-to-next` \| `motif-call-response` |
| OpeningEntryType | `direct` \| `pickup` \| `delayed` \| `suspension` \| `repeated-note` \| `leap-entry` |
| OpeningRegister | `low` \| `middle` \| `high` |
| OpeningInitialDirection | `ascending` \| `descending` \| `static` |
| leapWidthBias / densityNoteMultiplier / restRatioTarget / tensionUsageTarget | 連続値 |

## 共通コアの提案

4 Generatorを横断して意味を持ち、かつ既存コードに対応する軸が実在するもの。

| 共通コア項目 | Decoration | Counter | Phrase | Melody |
| --- | --- | --- | --- | --- |
| **direction** | direction (rising/falling/mixed) | (無し・追加要) | contour (ascending/descending/arch/inverted-arch/wave) | registerTrajectory / OpeningInitialDirection |
| **register** | register (low/middle/high) | preferredSide (below/above/analysis、相対値) | (無し・range連続値のみ) | OpeningRegister / registerTrajectory |
| **cadence/ending** | gestureRole=ending, type=ending-fill | (無し・追加要) | cadence (resolved/open/suspended/carry-forward) | endingStrategy (同じ4値!) / SectionTransitionStrategy |
| **entryOffset/pickup** | gestureRole=pickup, phraseBoundaryBeat | (内部のみ、非公開) | pickupBeats(連続値) | OpeningEntryType / startBeatOffset |
| **densityCurve** | density(静的1値のみ、時間変化なし) | (無し) | density(静的1値) | densityNoteMultiplier(静的1値) |

**わかったこと**: `cadence`/`endingStrategy`はPhraseとMelodyで**値の集合が完全一致**(resolved/open/suspended/carry-forward)しており、そのまま共通コアとして転用できる。一方`densityCurve`(時間軸で疎→密のように変化する概念)は、**4 Generatorのどれも現状は「候補全体で1つの静的な密度設定」しか持っておらず、時間変化するカーブとしては実装されていない**。参照データにdensityCurveを持たせても、それを実際に消費できるresolverが4 Generatorのどこにも無いため、Step 2の時点では「将来の拡張ポイント」として扱うか、まず対応するGenerator側にdensityCurveの概念を先に実装するかを決める必要がある。

`register`もCounterだけ「主旋律に対する相対位置(above/below)」であり、他3つの「絶対的な音域(low/middle/high)」とは意味が異なる。共通コアに含めるなら、参照データ側は絶対音域(high/middle/low)で持ち、Counter側で「主旋律の音域から見てabove/below/analysisのどれに当たるか」に変換するアダプタが必要。

## 拡張(Generator固有)の提案

| Generator | 拡張項目 |
| --- | --- |
| Decoration | character, shape, rhythmStyle, gestureRole, needLevel |
| Counter | generatorStyle, role |
| Phrase | harmonicApproach, rhythmCharacter, motifIntervals由来のintervalCharacter |
| Melody | motifIdentity, rhythmGrammar, phraseArchitecture, harmonicResponse, developmentStrategy, climaxPlan, generatorProfile |

## Step 2bへの示唆

代表曲1曲でスキーマ検証する際は、上記の「共通コアとして転用できる(cadence)」「要アダプタ(register)」「未実装(densityCurve)」の3パターンが実際に埋まるかを確認するとよい。特にdensityCurveは、検証時点で「疎→密」のような値を無理に決め打ちせず、各Generatorが現状持っている「静的1値」の粒度に合わせて仮スキーマを作るか、4 Generator側の実装拡張とセットで進めるかを先に決めた方が手戻りが少ない。
