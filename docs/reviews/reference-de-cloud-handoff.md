# 参照D・E：クラウド作業への引き継ぎ

Issue #194 は未完了。#193 とコード生成アプリの #39 は公開済みなので混同しない。
ユーザーからクラウドで続行する指示を受け、ローカル実装を停止して引き継ぐ。

## GitHub上の成果物

- リポジトリ: `sskmsl/composer-arranger`
- Draft PR #196: `codex/reference-de-phase0`、head `5be5c0f`
- main 基点: `cbe75b1`。mainへ直接pushしていない。
- Phase 0: `5da956a`、報告と新しい診断JSONのみ。
- Claude Code独立テスト: `93a1190`（元2f94fa9）、入力修正 `693b995`（元14fa0d2）。
- 規則2: `33b490d`。breakdown補助ベース全休止と4小節再構築を既存scheduler/refinerへ接続。
- 規則4: `5be5c0f`。restrained breakdownのIncantatoryに中域半音往復核を候補として追加。
- 別ブランチ `codex/reference-de-cloud-checkpoint` は規則6の未完成差分を保存するためのもの。
  PR #196へはこの差分をまだ入れていない。完成と扱わず、独立検証してから取り込む。

## 残作業

1. 規則1は未実装。初案のdynamic-contrast全体への適用で、既存ValidationのSafe>Edgeと上声入場後4小節上限が失敗したので戻した。
   明示の低域保留意図だけへ適用する案も試したが、新規独立テストの勝者がdynamic-contrastからmotif-ledへ変わる。
   いずれもPRのソースには含めていない。勝者assertや既存基準を勝手に変えない。
   Claude CodeへIssueコメント6255417285で相談中。GitHubから最新返信を取得する。
2. 規則3（12小節以上のflat/slow build）は未着手。既存backHalfLiftとentry/exitを使い、新設定を作らない。
   flatの区間内の意図的な交代と境界前2〜後4の制約を両立させる。
3. 規則4は実装済みだが、Claude Codeの独立レビュー待ち。固定6seedの選抜後18案のうち2案で
   複数の半音往復と非同音移動の過半が半音となることをMIDI再読込で確認。聴感保証ではない。
4. 規則5は既存Droneで足りる。再実装せず、Phase 0の条件でMIDI保持・色彩音の回帰確認を追加する。
5. 規則6はこのチェックポイントの2ソースファイルだけが作業途中。
   candidateMelodyRegisterで中心と幅を独立に計画し、既存melodyCharacterが渡されるサビ候補へ適用する案。
   型チェック成功のみでは完成でない。最終仕上げがinput.rangeを使う箇所があり、意図した幅を再び広げる可能性を検証する。
   固定seedで、選抜後・最終MIDIの高く狭い／中域で広い案の生存と品質を測る。
6. 全体テスト・型チェック・build・lint、identityComparison、Safe/Edge/Surprise、保存再読込、
   Composer Song Exchange形式、MIDI互換性、差分の禁止名検査を完了する。
7. 最新headのClaude CodeレビューとCI成功後にready、SHA指定マージ、既存Pages公開と公開後確認を行う。
   問題や期待値変更が必要なら指示どおり停止・報告。未実装を残して完成扱いしない。

## 検証の基線と現状

作業前は1369 passed / 7 skipped。型チェック・build・lint成功。
既存警告: importMidi.ts:174 no-control-regex、ビルドのチャンクサイズ。
PR #196では規則1未実装により独立テスト1件が失敗することを明記済み。
規則2独立3件（seed1〜3）、既存境界/低音7件、新規旋律1件、既存旋律/Validation7件は成功を確認。
このチェックポイントの規則6は、全体テスト・独立MIDI測定・レビューが未完了。

## 協働と制約

Claude CodeとはIssue #194とPR #196で直接連絡する権限をユーザーから得ている。ユーザーに伝言を中継させない。
コメント6255425917でhead 5be5c0fの規則2・4の独立レビューを依頼済み。
規則2の適用条件はコメント6255344384に記載。Claude Codeの誤った絶対座標fixtureの推測は
6255391650で撤回・訂正済みであり、古い「dynamic-contrastはほぼ選ばれない」を根拠にしない。

管理対象分類、境界窓前2〜後4小節、休符許容1小節、交代最大2は変更禁止。
既存テスト・閾値・スナップショット・測定原本、交換形式・保存形式を緩めない。
別のコード生成アプリは変更禁止。参照音源は探さず、参照D・Eと呼ぶ。
実在のアーティスト名・曲名・年代名を追加しない。1項目1コミットで進める。
最終報告はIssue #194の項目をすべて満たす。
