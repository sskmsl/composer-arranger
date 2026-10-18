# ドラマティック・マイナー判断規則：実装・検証

Phase 0は `dramatic-minor-phase0.md`。既存の半音反復、保持音候補、モチーフ変奏、Decoration/Counterの抑制、reasonを再実装せず、不足する判断だけを追加した。画面・生成モード・プリセットは増やしていない。

参照A〜Cは未検証の観察である。観察の数値を生成閾値に転用していない。以下は生成音符・MIDIの確認であり、聴感の保証ではない。

## 実装

- 和声と旋律の相互補完：`harmonicSimplicity.ts`。コードの実際の交代、非共通音、明示された変化テンションから小節の活動量を測る。同じコードの編集上の分割は変化と数えない。Standard/Minimal/Cinematicの忙しい小節だけで、弱い位置の短音と跳躍を抑える。疎な旋律やロックされた音は保つ。既存のsyn-stabsは動きの多い旋律の小節で再発音を一度に抑える。入力コードは変更しない。
- 前後の文脈：`sectionTransition.ts`。既存の前Section接続に加え、次の開始コード・採用済み旋律を参照して終端を共通音でつなぎ、短い呼吸を確保する。通常生成とSection ContentのMelody経路へ接続した。途中開始窓は前の境界を適用せず、終端に届かない窓・既存pickupがある窓へ次の終止を重ねない。拍子の小節長を受け取る。
- 既存出力の保護：Standardのrestrained/growingでも次の開始コードを参照する。解決済みの長い保持音は維持し、短い終止の呼吸だけを調整する。音高の接続はStandard/openと他Profileで行う。既存の固定seed音数・pitch hash・終止数の下限を変えていない。
- 削減による展開：`arrangementGenerator.ts`。8小節以上の既存dynamic-contrast候補で最終サビ前の末尾2小節から最大2役割を引く。対象は現在鳴っている低音・Pulseまたは上声・Stabs。drop形状ではベースを持続させる。明示された意図・演奏指定・preserveを優先する。
- 境界の分散：既存roleEntryBeatsと任意のroleExitBeatsを使い、編成から入退場案を作る。実フレーズの休符・音価も参照して、補助層を遅らせる／早めに休ませる候補を選ぶ。密度に合わせて個々の発音を間引く旧処理は撤去した。背景和声を優先し、最初のサビで補助層を使い切らず反復へ色彩を残す。部分再生成では選択範囲だけに入口・出口を適用する。
- 急緩：既存roleEntryBeatsとSafe/Edge/Surpriseを使用。Safeは色彩層を順番に、Edgeは最大2役割を即時に、Surpriseは一度待ってから再登場させる。明示された追加・保護役割の入口を遅らせない。8小節以上のサビで色彩層の持続音が入口をまたぐ場合、次の再発音まで待たず入口から受け継ぐ。
- Transition：既存候補の窓をSafe/Edgeは1小節、Surpriseは2小節に広げる。主旋律と重なる音は省き、十分な余白がなければ既存silence候補を返す。既存reason/intentionに採用理由を記す。
- 任意の高く狭いサビは追加していない。

## 測定の定義と範囲

`dramaticMinorValidation.test.ts` はseed 19/41/73/101/137/173でモチーフを生成し、MIDIを再読込する。短いA–B–Aの音高往復で隣接差が1半音の候補は18案中3案。既存核の変奏は、輪郭またはリズムの一方を保ち他方を変える実音セルを複数seedで確認した。変奏は全seed・全候補に必須ではない。

アレンジはseed 19/41/73で生成・書き出し・MIDI再読込し、セクション別・トラック別の音数を測る。dynamic-contrast計画から選択した役割を実生成し、同じseed・同じ役割で休止なしの場合よりMIDI音数が減ることも確認する。追加の解析結果は `dramatic-minor-output-distribution.json`。

要件3-2は発音数差から音価込みの発音状態へ検証を変更した。旧密度式は診断値として残し、成功条件には使わない。管理対象はstr-*、syn-dark-pad/pad-air/pad-motion、syn-stabs/chord-wide、syn-pulse/arp-low/arp-high、syn-sub-bass/bass-mid。主ベースsyn-bass、全dr-*（clap/field-drum/percussion-highを含む）、syn-transition-phrase/final-lift/high-glassは重心・土台・境界アクセントとして別扱い。Outroへの終止も対象外。明示Sound Instruction、Timeline Constraints、preserveを優先する。

8小節以上の隣接区間について、境界の前2小節〜後4小節で直前小節とMIDIの音価込み発音状態が入れ替わる管理対象トラック数を測る。短音層の周期的な休符も数え、2以下という基準で確認する。全トラックの診断値も残す。音色・音域・音量まで含む聴感上の上限ではない。Claude Codeの追加独立テスト・共同レビューは継続中で、現時点では公開判断を行っていない。

`sectionExit.test.ts` は3seedで8小節のMinimalとStandard/open・Standard/growingを生成し、前の採用済み旋律による開始の変化、次の開始による終端の変化、MIDIへの音高反映を分布として確認する。和声の簡潔化、変化テンション、ロックと冪等性にも個別テストがある。

## 検証

最終実行結果はPRへ記録する。既存のidentityComparison、Safe/Edge/Surprise、音数・pitch hashの固定データ、終止・ベース・打楽器の基準は変更しない。

## 共同レビュー後の確認

Claude Codeの隔離環境でのMIDIレビューに基づき、Transition・打楽器の保護と入口の実音化を修正した。3seedで入口を0/4/8拍にした弦の実際の発音開始を比較する。2拍ずつの和声交代もMinimal/Cinematicで簡潔化できるようにし、Standardの既存固定出力は維持した。要件3-2の計画段階での層の交代と、Transitionの最終MIDIでの存続は共同レビューを継続し、解決前には公開しない。

計画置換前の確認記録：`vitest run --maxWorkers=2` は1364 passed / 7 skipped、`tsc -b`・`npm run build`・`npm run lint`は通過。この時点の密度だけの成功は公開承認の根拠にしなかった。

計画置換後は、役割一覧だけでなく音価込みの実フレーズから入口・出口を選ぶ。ノート単位の密度合わせや補填音の追加は行わない。旧データでroleExitBeatsがない場合は末尾まで使用する。背景衝突の修復より前に計画範囲を適用し、修復記録と実音の一致を保つ。既存の最終サビの補助層上限も交代の計算へ反映する。

Claude Code作成のdramaticMinorBoundary.test.ts（5f200ec）を取り込み、選択されたTransition候補がトラックMIDIと全曲MIDIの両方に残ることを確認した。既存の測定テストは編集せず、サビの層数の発展・Pad音数・修復記録・強弱差の基準を維持した。最新の全体検証結果はPRへ記録する。

計画置換後のローカル確認：`vitest run --maxWorkers=2`は1366 passed / 7 skipped、`tsc -b`・`npm run build`・`npm run lint`は通過。seed 19/41/73のMIDIで、管理対象の各小節の反転数は2以下。新しい判定方式は共同レビュー中であり、この結果だけで公開承認としない。
