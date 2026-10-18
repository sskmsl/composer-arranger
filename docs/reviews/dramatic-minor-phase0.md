# ドラマティック・マイナー判断規則：Phase 0

基点: origin/main `bf73f28`。取得後に専用worktreeへ分離。既存チェックアウトの変更は保持。本報告時点では実装コードを変更していない。

参照A〜Cの観察は未検証の仮説。数値は方向性であり聴感を保証しない。実在の参照情報は登録しない。

## melodyCharacter の到達点

`src/melody-engine/melodyCharacter.ts` はseed・和声・テンポ・曲調から決定的に音域幅、長音率、裏拍率、密度を決める。Verseは狭く、Chorusは幅を広げる。長音型の候補は存在する。コード変化が激しい個々の小節の簡潔化、次セクションへの終止設計は未対応。

## 要件との対応

| 規則 | 状態 | 根拠・方針 |
| --- | --- | --- |
| 2-1 半音隣接ペダル | 実装済み | `incantatory.ts` のrepeated/chromatic cell、半音中心STEP_CHOICESと周期反復。`generatorProfile.ts`のChromaticは経過音。既存Incantatoryで候補を出せるため追加しない。実音出力で確認する。 |
| 2-2 Verse保持音 | 実装済み | `generatorProfile.ts` Minimalの長音・余白、`speechRhythmic.ts`の同音反復、`melodyCharacter.ts`の長音型。新しいProfileや保持音モードは作らない。 |
| 2-3 和声と旋律の相互補完 | 部分的 | `harmonicMap.ts`は和音間共通音、`generateFromChords.ts`は和声整合を扱うが、小節別の和声変化量による音数・跳躍の制御がない。伴奏側の動きも主旋律密度と連動させる。入力コードは書き換えない。 |
| 2-4 モチーフ変奏 | 実装済み | `motifCore.ts`、`motifDevelopment.ts`、`incantatory.ts`。リズムを保つ移高・反転、音程を保つリズム変奏。再実装しない。 |
| 2-5 前後文脈 | 部分的 | `sectionTransition.ts`と`useProjectStore.ts`は前SectionのActive Melodyを参照する。Section Content Modeには既にnextSectionRole/nextSectionFirstChordとpickupがある（`generateSectionContent.ts`、`sectionContentPlan.ts`）。通常Profile生成への次文脈の伝達、および前Sectionに旋律がない場合の次文脈が不足。既存Transitionへ追加し、Content側の既存pickupは再実装しない。 |
| 2-6 高く狭いChorus | 部分的・任意見送り | `melodyCharacter.ts`はChorusの上端と幅を拡大する。高い中心音・狭い幅を独立した軸にはしていない。参照Aのみの仮説につき今回は追加しない。 |
| 3-1 削減・休止・音域・交換 | 部分的 | `arrangementGenerator.ts`のbreakdown/withdraw、rolesFor、roleEntryBeats、register-expansion、boundaryDropで実現。明示的breakdownなしでも最終Chorus前に引く候補は不足。既存dynamic-contrast候補へ追加。 |
| 3-2 変更層1〜2個 | 部分的 | `roleEntryBeatsFor`は一部の役割のみ遅らせる。`generateTrack`の境界dropは3役割同時。境界での役割交代を段階化し、drop対象を2役割に制限する必要がある。 |
| 3-3 急／緩の入口 | 部分的 | Safe/Edge/SurpriseはTransition・Decorationの音程と意外性を制御。全曲の入口の急緩へは未接続。既存selectedTransitionCharacterを使い、Safeは段階的、Edgeは最大2役割を即時、Surpriseは削減と再登場を候補化。 |
| 3-4 1〜2小節Transition | 部分的 | `transitionCandidate`は無音候補も持つが、実フレーズは約1.25〜1.5拍のみ。既存Transitionを1〜2小節の窓に広げ、主旋律の余白内だけに置く。 |
| 3-5 主旋律への余白 | 実装済み | `decorationGenerator.ts:assessDecorationNeed`、`counterGenerator.ts`のstrategic-silence、`arrangementGenerator.ts`のrest/register衝突回避。重複追加しない。 |
| 3-6 reason | 実装済み | `transitionCandidate`、`decorationCandidate`、`candidateReason`、生成音符reason。追加判断も既存reason/intentionへ説明を残す。別の説明機構は作らない。 |

## 用語の対応

- Generator Profile: Minimal=長音・余白、Speech-Rhythmic=狭域の同音反復と発話、Incantatory=短い核の反復と限定変異、Chromatic=半音の接近と緊張、Cinematic=大きな弧。別Profileを追加しない。
- Section Role: verse / pre-chorus / chorus / breakdown-chorus / grand-chorus が語り・予告・開放・削減・再構築に対応。構成・長さそのものは変更しない。
- drama: restrained=跳躍と終端緊張を抑える、growing=既定、open=跳躍と終盤ピーク。Safe/Edge/Surpriseと同義ではない。
- Safe/Edge/Surprise: 既存ArrangementCandidateCharacter。接続の安全性・緊張・意外性を保ちつつ、入場タイミングにも反映する。
- AI Partnerは既存生成呼出しを経由するため、生成器とTransitionを改善して共有する。新しいオーケストレータは作らない。
- Section Content Modeは既存の主旋律・モチーフ・持続等の役割分担を維持。Decorationは旋律の余白に従う。

## 検証計画

固定seed群の生成音符および書き出しMIDIを再読込して、半音往復・モチーフ変奏・削減・境界の役割出入り・8小節の前後文脈を確認する。identityComparisonと既存の全テストを維持。境界の役割出入りと、全トラックの音数・音域等の大変化は別指標として扱い、検証範囲を明記する。
