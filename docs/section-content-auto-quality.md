# Section Content Auto Quality（Issue #63）

`Auto`はSection Role辞書を順番に3件返すのではなく、候補プールから品質と多様性を評価して選ぶ。

## 評価

各候補は、歌唱Melody用スコアとは分離した次の部分スコアを持つ。

- Section Fit
- Song Profile Fit
- Harmonic Interest
- Structural Clarity
- Next Section Expectation
- Song Motif DNA Relationship
- Space Quality

Content別の品質下限を満たさない候補やStructural Validation違反は、多様性だけを理由に採用しない。

## 選抜

Autoでは9候補を生成し、品質65% + 既選択候補との差35%のMMR型選抜で3案へ絞る。Section Role上複数Contentが妥当な場合は、最低2種類のContentを含める。同一Contentしか成立しないRoleでは、音程セル、リズム、Entry Offset、Register、反復・展開、休符・保持の差を使う。

選抜されたVariantには`contentQuality`と`contentSelection`を保存し、Melody画面へ簡潔なQualityと選抜理由を表示する。未選抜候補の診断は`generateSectionContent()`の`candidatePool`で確認できる。

Section Content、Accompaniment Pattern、Counter / Decorationの保存責務は変更しない。
