# 参照D・E：実装とMIDI検証（マージ前報告）

Issue #194 / 既存PR #196 / `codex/reference-de-phase0`。基点mainは `cbe75b1`。
コード検証対象は `52b181b7498783fa104ff7c741a46ef9488762d6`。
この文書の追加は生成コードを変更しない。独立レビュー・最新CI・マージ・公開後確認の最終状態はIssue/PRへ記録する。

## 規則別の状態と入口

| 規則 | 状態 | 既存の入口・実装 |
| --- | --- | --- |
| 1 低域保留 | 新規実装 | `directive.intention` の「低域を控えたヴァースから、サビで広げる」。既存character/approachに依存せず、Verse/Preの補助2ベースを区間長まで入場保留。サビで戻す。主ベースを維持。再構築・add/preserve・明示Sound/Timelineを優先 |
| 2 休止と再構築 | 新規実装 | breakdownの補助ベース全休止。直後が4小節の再構築、その次がサビ/大サビという構成へ既存scheduler/refinerを適用。通常サビの先頭3層同時入場も修正 |
| 3 長い区間 | 新規実装 | 12小節以上（Outroは既存の終止処理を維持）。既存候補内で、intro/pre/buildは積み上げ、それ以外は平坦を基本解釈とする。space-ledは平坦、dynamic-contrastは積み上げの別解釈。既存backHalfLiftと重複させず、補助層の入場を4小節ごと最大1つにする。境界窓の分散と内部展開を区別。明示されたサビ低域入場を優先 |
| 4 半音往復 | 新規実装 | restrained / breakdown-chorus / 既存Incantatoryの候補核の一部を、中域で半音の往復とする。全Profileの既定を変えない |
| 5 長音保持 | 既存で足りた | 既存Section ContentのDrone。再実装なし |
| 6 高さと幅 | 新規実装（任意） | 既存drama=open / chorusまたはgrand-chorus / melodyCharacterありの候補プールで、高さと幅を独立に計画。選抜・仕上げ・MIDIまで各案の音域を渡す。通常growingの固定出力を維持。両方を全seedで必須にしない |

新しいモード・画面・プリセット・保存フィールドは追加していない。
管理対象の分類、境界前2小節〜後4小節、休符許容1小節、交代最大2層は維持。
既存のassert・閾値・スナップショット・測定原本は変更していない。
今回新規の独立テストの入口前提のみ、作者の `058a71a` を取り込んだ。実音assertを維持し、character別と通常経路対照を追加したもので、mainの期待値変更ではない。

## 前後の実測と条件

固定seedは19/41/73/101/137/173。発音開始数だけでなく、書き出したMIDIを `parseMidi` で再読込して測る。聴感や参照音源との一致の保証ではない。

### 規則1・2と保存互換性

Cm、4/4、Verse8 / Pre8 / Chorus8 / Breakdown8 / Pre4 / Grand Chorus8 / Outro4。
和音は区間相対のCm–Ab–Bb–G7。低域保留のintentionあり。変更前はmain `cbe75b1`、変更後は検証対象head。
補助ベースの欄は `[syn-sub-bass, syn-bass-mid]` の発音した小節数。

| 測定 | 前 | 後（6seedすべて） |
| --- | --- | --- |
| Verseの補助ベース | [8, 0] | [0, 0] |
| 最初のPreの補助ベース | [8, 8] | [0, 0] |
| Breakdownの補助ベース | [8, 0] | [0, 0] |
| 境界窓の最大交代 | 8 | 2 |
| Chorusの補助ベース | 発音あり | [7, 2]、入場は後4小節以内 |
| 再構築の補助ベース | 発音あり | [3, 4] |
| Grand Chorusの補助ベース | 発音あり | [8, 1] または [8, 2] |
| 主ベース | 発音あり | Verse/Pre/Chorus/Breakdown/Grand Chorusすべて8小節発音 |
| 保存再読込後のMIDI | — | 6/6で同一 |

`reference-de-main-before-midi.json` と `reference-de-compatibility-midi.json` に全seedの原データを残した。
通常サビを再構築後に置く追加fixtureでは、seed1〜8と指定6seedすべてで交代上限2、Breakdown補助層0、主ベース維持を検証。

### 規則3

Cm、4/4、Verse16 / Pre16 / Chorus8 / Outro4。同じ生成済み曲へ既存の部分再生成APIで各候補のPre入場計画を実現し、管理層の実音をMIDIから数える。通常選抜後の全曲の境界上限も別に確認した。
seed19のPreの内部代表値（4/8/12/14小節目の管理層数。入口窓と末尾2小節の退出を内部展開と混同しない）：

- 平坦案：4 → 4 → 4 → 4。内部の4〜13小節は一定。
- 積み上げ案：2 → 3 → 3 → 4。変更前の同じ解釈は内部が4層で一定で、4小節単位の追加はなかった。

6seedすべてで平坦の内部層数一定、積み上げの各4小節窓で新規層最大1、両案の層数推移が異なることを検証。音楽的な短い休符は1小節まで埋めて数える。存在しない補助層を追加して数合わせはしない。
16小節のサビ/大サビでも、明示された低域保留とサビ入場が内部展開より優先されることを指定6seedで追加確認。
原データは `reference-de-long-midi.json`。

### 規則4・5・6

| 規則 | 条件 | 前 → 後 |
| --- | --- | --- |
| 4 | Am–F–C–G、8小節、Incantatory、breakdown-chorus、sparse/restrained、range60〜65。半音A–B–Aが複数回あり、非同音移動の過半が半音となる選抜後候補 | 0/18 → 2/18。`reference-de-neighbor-midi.json` |
| 5 | Am–F–C–G、8/12小節、既存Drone、verse、dark-romantic、range60〜79、entryOffset=0、pickup=false | 生成コード変更なし。8小節で5案、12小節で12案が32拍以上保持、計17案。根音差2/9/11半音（9度/6度/長7度）を再確認。全seed必須の保証ではない |
| 6 | Am–F–C–G、8小節、Standard、chorus、balanced/open、tempo100、要求range60〜79。高く狭い＝実幅8以下・中点73以上、中域広い＝実幅10以上・中点72以下 | 高く狭い2/18 → 12/18、中域広い13/18 → 4/18、同じ3案内に両方が残るseed2/6 → 3/6。`reference-de-register-open-midi.json` |

初期のgrowingへ広く適用した実験は既存固定出力を壊したため、実装側を修正した。
その実験記録 `reference-de-register-midi.json` は保存し、公開版の適用範囲や保証の根拠にはしない。

## 検証と互換性

- 作業前main：1369 passed / 7 skipped、tsc/build/lint成功。失敗なし。
- 引き継ぎhead 5be5c0fのCI：1374 passed / 7 skipped / 1 failed。規則1未実装によりVerseで補助ベースが鳴る既知失敗。
- 最終コード：**1382 passed / 7 skipped、180 passed files / 6 skipped files、失敗0**。worker数2。型チェックを含むbuildとlint成功。
- 既存の固定pitch hash・音数、旋律品質/分布、identityComparison、Safe/Edge/Surprise、境界テストを維持。初案で失敗した既存3ファイルも期待値を変更せず成功へ戻した。
- `readProjectFile` → `resolveProjectTiming` で保存JSONを復元し、計画一致と再書き出しMIDIのバイト一致を指定6seedで確認。
- Composer Song Exchange、contracts、schemas、保存スキーマは変更なし。既存の交換契約・MIDI関連テスト成功。
- 既存警告：`importMidi.ts:174` no-control-regex、ビルドの大きいチャンク警告。新しいlint警告なし。環境のnpm proxy設定警告は生成ロジックの失敗ではない。
- 別のコード生成アプリは変更していない。mainへの直接pushなし。

## 変更ファイルとコミット

生成コード4ファイル：`arrangementGenerator.ts`、`generateFromChords.ts`、`incantatory.ts`、`melodyCharacter.ts`（すべて `src/melody-engine/`）。
新規/今回追加のテスト：`dramaticMinorBassLayers.test.ts`、`referenceDEMelody.test.ts`、`referenceDERebuild.test.ts`、`referenceDERegister.test.ts`、`referenceDELongSections.test.ts`、`referenceDECompatibility.test.ts`。
報告/新規測定：本ディレクトリの `reference-de-*`。変更前の既存測定ファイルは維持。

PR上のコミット：Phase 0 `5da956a`、独立テスト `93a1190` / 入力修正 `693b995` / 入口修正 `a49b17d`、規則2 `33b490d` / 追加修正 `b6cd95d`、規則4 `5be5c0f`、規則6 `d2d342a` / 任意の入口への限定 `c444876`、規則1 `c0d640b`、規則3 `5bf27a7` / 明示指示優先 `52b181b`、互換性検証 `5d7180f`。
クラウド内の同一treeコミットとGitHub APIによるコミットのSHAは異なる。内容のtree一致を検証済み。

## 未確認事項・公開条件

参照音源は探していない。聴感、楽器単位での参照音源の構造、帯域推定の誤差、全調・全和声・全seedでの成立は未保証。
既存名称がソースの変更していない箇所にあるが、mainと同一であり、今回の追加行には実在のアーティスト名・曲名・年代名を追加していない。自動レビューの一度の拒否は、その同一性と差分を検証してから再審査し、反映された。
独立レビューの実際の返信と最新headのCI成功が揃うまでDraftを維持し、SHA指定でマージする。公開URLは https://sskmsl.github.io/composer-arranger/ 。既存Pagesのデプロイ後、主要機能を確認してIssueへ最終報告する。
