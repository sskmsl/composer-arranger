# Melody Generator Hook-first A/B

同じ8小節のコード列、Tempo 92、French Pop 65% + Romantic Dark 35%、歌唱音域 C4–F5、`balanced`、`growing`、Verse/Chorus、seed 7/19/53 で変更前コミット `48eaf54` と Hook-first版を比較した。各条件で Standard Profile の選抜3候補を測り、MIDIは seed 7 の1案目を保存した。変更前後でコード・Tempo・Genre・Section・seedは同一である。

| 指標（9候補平均） | Verse 変更前 → 後 | Chorus 変更前 → 後 |
| --- | ---: | ---: |
| ノート数 | 25.000 → 22.667 | 23.556 → 24.222 |
| 既存 Hook Strength | 0.599 → 0.967 | 0.686 → 0.998 |
| 冒頭核が8–24拍で再登場する候補率 | 0.556 → 0.778 | 0.778 → 0.889 |
| 冒頭5音のリズム識別性 | 0.648 → 0.722 | 0.741 → 0.778 |
| 大跳躍比率 | 0.060 → 0.065 | 0.076 → 0.078 |
| 休符比率 | 0.174 → 0.287 | 0.171 → 0.227 |
| 強拍で未解決の和声衝突 | 0 → 0 | 0 → 0 |

初回のHook-first案は Chorus のリズム識別性が 0.741 → 0.556 に下がったため採用せず、Core候補の選抜を調整した。表は再調整後の値である。ノート数は Chorus で約2.8%増えたが、核の再登場・リズム識別性・余白は改善した。これらは記憶性・歌唱性の代理指標であり、聴感を保証する点数ではない。

比較したMIDIと生の指標は `/Users/masaru/Documents/Codex/hook-first-audit/` に保管した。既存のHarmony Fit、Voice Leading、非和声音処理、Candidate DNA、Profile評価は最終候補に引き続き適用する。

既存Profile比較では、Hook-firstによるStandardの余白増加でMinimalとの差が縮まった。Minimalの長い音の語尾に短い間を設け、20 seed平均でMinimalの休符率がStandardを上回ることを回帰テストで確認した。全テスト、型チェック、Lint、Production Buildは通過した。
