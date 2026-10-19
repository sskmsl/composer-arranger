# 参照D・Eの追加規則：Phase 0

Issue #194。2026-10-19、`git fetch origin main` 後の基点は `cbe75b101658776a0f5614cbe373d6572cf65dbf`。#193 はこのコミットでマージされ、公開後の確認も #193 の完了報告に記録済み。
元のチェックアウトは変更せず、独立cloneの `codex/reference-de-phase0` で調査した。未コミット変更はなかった。生成コード・既存テスト・測定原本は変更していない。

参照D・Eの観察は方向性として扱い、音源を探していない。帯域や音量の推定値を生成閾値にしていない。以下のMIDI測定は聴感を保証しない。

## 作業前の確認

- `git status --short --branch`: `main...origin/main`、変更なし。専用ブランチへ分離済み。
- `git log origin/main --oneline -10`: cbe75b1 / 30e8a93 / f05fbf1 / d2eb081 / ef99653 / 7a6be33 / b8f65d6 / 6b5e1e4 / a19b3eb / 8c9101f。
- `docs/reviews/dramatic-minor-phase0.md`、`dramatic-minor-implementation.md`、`dramatic-minor-output-distribution.json` と `src/melody-engine/dramaticMinorBoundary.test.ts` を確認した。
- `vitest run --maxWorkers=2`: **1369 passed / 7 skipped、174 passed files / 6 skipped files**、120.52秒。既存のスキップは失敗として数えていない。
- `tsc -b`、`vite build`、`oxlint`: 成功。作業前の失敗なし。
- 既存警告: `src/midi/importMidi.ts:174` の `eslint(no-control-regex)`、ビルドの500kB超チャンク警告。別環境での過去の警告と混同せず、今回の実行結果を基線とする。
- Node v24.19.0、lockfileに従い `npm ci`。テストのworker数は #193 と同じ2。timeoutや品質閾値は変更していない。

## 変更しない測定契約

管理対象は `str-*`、`syn-dark-pad/pad-air/pad-motion`、`syn-stabs/chord-wide`、`syn-pulse/arp-low/arp-high`、`syn-sub-bass/bass-mid`。
主ベース `syn-bass`、全打楽器、境界アクセント `syn-transition-phrase/final-lift/high-glass`、Outroへ入る境界は #193 の分類どおり別扱い。
8小節以上の隣接区間の境界前2小節〜後4小節、1小節以内の休符を埋める、1小節あたり管理対象の交代は最大2、という独立テストの契約を維持する。
`dramaticMinorBoundary.test.ts` と、休符を埋めず音価込みの反転を測る既存テストの両方を維持する。計画値だけで合否を判定せず、MIDIへ書き出して再読込する。

## 規則1〜6の重複と適用案

以下の適用案は実装前の提案。新しい設定・画面・モード・プリセットは増やさない。「候補」は既存の候補生成と選抜を通り、ユーザーが必ず採用するものではない。

| 規則 | 現状 | 既存の該当箇所・#193との重複 | 既定か候補か／既存の適用設定 | 追加する差分 |
| --- | --- | --- | --- | --- |
| 1 低域を控えるヴァース | 部分的 | `arrangementGenerator.ts:rolesFor / layerEnabledInSection / roleEntryBeatsFor / scheduleBoundaryRoles`。派生ベース層はエネルギーで有効になり、Verse・Pre全体で休む保証はない。#193の初回サビで補助層を保留する処理は別の判断 | **既存dynamic-contrast候補の判断として提案**。その候補のverse/preは補助ベースを保留し、後続chorus/finalへ入場を配分する。新しいオンオフは不要。明示Sound Instruction、add、preserve、部分再生成の範囲を優先 | `syn-sub-bass` / `syn-bass-mid` の全区間休止と後続への入場。主ベース・ハイハットを削らない。既存の入退場フィールドを使う |
| 2 ブレイクダウン→再構築 | 部分的 | `bassStrategyFor` はbreakdownでsustain、派生ベースも有効になりうる。`preBoundaryDropRoles` はdynamic-contrastの最終サビ前の末尾2小節だけ。#193の処理を再登録しない | **既存dynamic-contrast候補**。breakdown-chorus等→再構築区間→chorus/finalという並びで出す。再構築4小節をまず既存の4小節区間へ適用する案。すべての区間へ強制しない | 管理対象ベース層を全休止し、次の区間の末尾4小節で戻す。入退場時刻とMIDIで検証。長い次区間への適用は下記の確認事項 |
| 3 長い区間の内側 | 部分的 | `backHalfLiftFor` は区間後半の1地点、`sectionShape` はdrop/build等、`roleEntryBeats` は役割ごとの入口を表現できる。12小節以上の平坦／4小節ごと最大1層追加の選択規則はない | **対象候補内の既定を区間長・Section Roleから選ぶ案**。長いverseはflat、長いintro/pre/build相当はslow buildを優先し、既存の別候補では他方を選べる。短い区間は既存動作 | flatでは意図的な区間内の管理層増減を行わない。slow buildは入口を4小節単位に配分。既存backHalfLiftと重複させず、明示指示・音楽的な休符を保つ |
| 4 中域の半音往復 | 部分的 | `incantatory.ts:STEP_CHOICES / generateCoreMotif / harmonizeIncantatoryNotes`、`generatorProfile.ts` のChromatic/Minimal、`generationParams.ts`。半音往復と狭い音域は既存。#193の半音往復存在確認は「中域で往復に絞る」確認ではない | **既存Incantatory/Chromatic等の候補として提案**。breakdown-chorus、restrained、sparse、既存rangeの範囲を使う。全Profileの既定へ強制しない | 専用生成器は追加しない。既存のモチーフ核・音域配置・和声適応で、半音往復を主とする候補を残せるかを限定的に補う。Minimal全体を半音化しない |
| 5 8小節以上の同音保持と色彩音 | **実装済み（候補）** | `sectionContentPlan.ts:DRONE_FIGURES / dronePitchClasses / planOne`、`contentGenerators.ts:generateDroneNotes`、`generateSectionContent.ts`、`exportMelody.ts`。既存Droneはコード境界で分割せず、同じ音を区間単位で保持できる。6度・9度・長7度として響く保持音も実測で確認 | **Section Content Modeの既存droneを選択**。8小節以上、entryOffset=0、pickup=falseの例を確認。ただし候補の入口は選抜時に変わり、全seedで32拍保持が必須とはしていない。Autoや通常Melodyへ強制しない | **再実装しない**。長さ・選抜後の存続・MIDIへの同音保持を既存APIの追加検証で固定する。未測定の全調・全和声について成立すると主張しない |
| 6 サビの高さと幅の独立 | 未実装（広いサビは既存） | `melodyCharacter.ts:planMelodyCharacter / placeCharacterRegister`。サビのrequestedSpanは16〜17半音、highは指定上端で、高さと幅が結び付いている。#193の任意の高く狭いサビは見送り済み | **既存の3候補の配置案**。既存Generator Profileとrangeを上限に、高く狭い／中域で広いを別候補にできるようにする。両方の存在を全seedで強制せず、適合する場合に選ぶ | 新しいProfileは追加せず、音域中心と幅を候補計画で独立させる。既存identityComparison、音数・pitch hash固定値、品質下限との衝突を先に確認する |

## MIDIによる既存候補の診断

生成コードを変更せず、既存APIを独立cloneへ読み込む診断を作業用一時ディレクトリで実行した。原本は `reference-de-phase0-midi.json`。既存の測定JSONは上書きしていない。

固定seedは19/41/73/101/137/173。Am、4/4、和声は1小節1和音の Am–F–C–G の反復。`exportMelodyMidi` → `parseMidi` から音高・持続拍を算出した。
Droneは8小節と12小節、Section Role=verse、Song Profile=dark-romantic、range=60〜79、既存content.drone、entryOffset=0、pickup=false。

- 8小節: 18候補中5候補で1音32拍の保持を確認。6seed中5seedに該当候補がある。seed101は入口が変わり、最長28拍であり、毎seedで32拍以上を保証しているわけではない。
- 12小節: 各seedで2候補、合計12候補が1音32拍以上を保持した。最長48拍。主音保持がループの他の和音へ6度・9度となり、属音保持では6度・長7度になることも確認した。ここでの「色彩音」は各和音の根音からの音程2/9/11半音であり、音色の分析ではない。
- 規則4の診断: 8小節、breakdown-chorus、Incantatory、original-custom、sparse、restrained、range=60〜65。同じ6seedの18候補中、A–B–Aかつ隣接差1半音を含むのは1候補。全候補は指定中域に収まるが、各候補の最大跳躍は2〜4半音であり、「半音往復へ絞れた」とは言えない。#193の既存往復核は再利用し、限定条件の不足だけを扱う。

規則1〜3・6の変更前後の最終出力分布は、実装前の独立テストと実装後に測る。エネルギー閾値だけで無音と断定せず、採用候補のMIDIの実際の音価を測る。

## Claude Codeへのテスト依頼と入口

1. 担当宣言はIssue #194へ。基点は `cbe75b1`。新規テストファイルのみとし、既存 `dramaticMinorBoundary.test.ts` と測定原本は編集しない。
2. 規則1の入口: `buildFullSongArrangementPlan(project, analyzeFullSongArrangement(project), seed, brief, directive, "dynamic-contrast")` と、既存 `generateFullSongArrangement` の候補経路を使う。計画だけでなく対象候補の `exportArrangementMidi` / `parseMidi` を検証する。forcedApproachは既存の計画APIの引数であり、新APIを先に仮定しない。
3. Verse→Pre→Chorusで補助2ベースのVerse/Pre発音0、Chorus発音正、主ベースは両側で発音正。全休止で上限を満たすだけの空振りを防ぐ。明示add/preserve等と部分再生成の範囲外保護も別に確認する。
4. 規則2はBreakdown→4小節の再構築→Chorusという合成fixtureを第一案とし、区間全体の補助ベース休止と、再構築中の入場をMIDIから確認。managedの分類・休符許容・交代数の算出は既存独立テストと同じにする。8小節以上の既存fixtureもそのまま通す。
5. Safe/Edge/Surpriseの差、identityComparison、保存再読込、交換契約、MIDI出力も維持する。新規テストの最初の失敗は未実装規則に由来することを、対照と非空のMIDIで示す。

## 実装前に解くこと・停止条件

- 規則2の「次区間の末尾4小節」と「境界の後4小節以内での入場」は、次区間が長い場合に両立しない。**窓は変えない**。まず4小節の再構築区間に適用する限定案をClaude Codeと相談し、長い区間へ自動適用しない。既存規約を変える必要が出た場合は実装を止め、Issueで報告してユーザーの指示を待つ。
- 規則3の区間内の意図的な積み上げと、境界での入場待ちの繰越は別に検証する。入場を窓外へ逃がして境界上限を満たしたことにしない。平坦案の層数と、slow build案の4小節ごとの追加数もMIDIで測る。
- 規則1の適用を全既定へ広げる前に、候補としての実測と既存固定テストへの影響を確認する。既定への強制で既存仕様と衝突するなら勝手に基準を変えない。
- 規則4・6も、既存ProfileのidentityComparisonや固定データを変える必要があるなら停止して報告する。今回のPhase 0はそれらの変更を承認したものではない。
- `refineBoundaryRoleSchedule` の処理コスト増は #195 と切り分け、境界の再計算を余計に追加しない。#195の最適化を無断で混ぜない。

## 境界と現在の成果物

このブランチは本報告と独立診断JSONの2ファイルのみ。コード生成アプリ、Composer Song Exchangeの形式、保存スキーマ、新しい設定・画面・モード・プリセットは変更していない。実在のアーティスト名・曲名・年代名を差分に追加していない。
実装開始・公開完了とは区別し、Claude Codeの担当宣言・Phase 0への返答をIssue #194で受けてから、未実装の差分を規則ごとに進める。
