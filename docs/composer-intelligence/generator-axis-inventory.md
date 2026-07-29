# Generator Axis Inventory

Composer Intelligenceから各Generatorへ渡せるAuto軸と、現行フォールバックを整理する。実名・参照作品は含めない。

| Generator | Rule対象 | 現行フォールバック | 主な後処理・選抜 |
| --- | --- | --- | --- |
| Decoration | Gesture Role / Direction / Register / Density | Section構造、Silence Gate、Character/Type別候補、seed | planned tone解決、衝突評価、Quality 55% + Diversity 35% + Preference 10% |
| Phrase | Contour / Rhythm Character / Harmonic Approach / Cadence | Section Role、Song Profile、コードのCommon Tone/Tension、seed | 強拍和声、跳躍回収、密度・休符・終止評価、Quality 68% + Diversity 32% |
| Counter | Part Role / Register Relation | 5つのStyle Planを循環し、主旋律のGapと音域を解析 | Collision、Counterpoint Fit、Quality 65% + Diversity 35% |
| Melody | Motif / Rhythm / Phrase / Harmony / Register / Development / Climax / Ending | Profile別DNA Prototype、Opening Intent、Generation Params | planned tone保持、局所和声補正、全体Similarity、Quality 60% + Diversity 40% |

## 実行順序

```text
User explicit settings
  → Section / Song context
  → Resolved Composer Rules
  → weighted Auto choice
  → existing deterministic fallback
  → note generation
  → post-processing
  → quality and diversity selection
```

Technique Ruleは明示値を変更しない。適合するRuleがない場合や、公開Technique Libraryが空の場合は現行フォールバックへ戻る。

Lifecycleの扱いは全Generatorで共通とし、Draft / Deprecatedは実行対象外、
Canonicalを主成分、Validatedを補助成分としてRule Resolverが解決する。
GeneratorはTechnique名、Genre、Evidence、Review Historyを参照せず、
永続Technique IDを持つ匿名Ruleだけを受け取る。
