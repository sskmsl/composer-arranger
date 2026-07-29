# Composer Intelligence

Composer Intelligenceは、知識取得（Learning）と知識利用（Execution）を分離する。

## 境界

```text
Private Reference Data
  → Genre Observation
  → Genre Principle（独立Reference 3件以上）
  → Technique Definition
  → Anonymous Technique Rule
  → Rule Resolver
  → Resolved Composer Rules
  → Decoration / Phrase / Counter / Melody
```

Composer ArrangerのGeneratorはArtist名、Genre名、曲名、アルバム名、Reference IDを参照しない。Generatorへ渡るのは`ResolvedComposerRules`だけである。

実名を含む分析データは`reference-data/`へ保存し、Git管理対象外とする。公開可能なのは、匿名Source ID、抽象化済みTechnique、Genre Principle、集計済みConfidence、実行Ruleである。

## Priority

| Knowledge | Priority | 役割 |
| --- | ---: | --- |
| Artist Intelligence | 100 | 表現する世界観・美学・感情・構成思想 |
| Technique Library | 50 | 世界観を実現する再利用可能な表現手段 |
| Experimental Technique | 20 | 検証前の探索的な提案 |

同じ軸へ複数層のRuleが該当する場合、Rule Resolverは最高Priority層だけを採用する。したがってTechnique LibraryがArtist Intelligenceを上書き・希釈しない。Ruleは既存Generator判断と混合し、Technique Priority 50を単一値の強制指定として扱わない。

## Confidence

同じPriority内では、次の実効重みを集計して正規化する。

```text
effectiveWeight
=
preferenceWeight
× confidence
× contextRelevance
```

## Genre Principle

Principleへ昇格できるのは、人間確認済みで、異なるReference IDを3件以上持つObservationだけである。同一Referenceの重複や未確認Observationは件数へ含めない。

## Technique Library

TechniqueはGenreそのものではなく、Generatorを横断して再利用可能な技法である。各TechniqueはCategory、Observation、Intent、Generator Target、Priority、Confidence、Ruleを持つ。

`genreSourceIds`はLearning層の監査用メタデータであり、`ruleFromTechnique()`で実行Ruleへ変換する際に除去する。

## Generator統合

- Decoration: Gesture Role、旋律方向、音域、密度
- Phrase: Contour、Rhythm Character、Harmonic Approach、Cadence
- Counter: Part Role、Register RelationによるStyle Plan配分
- Melody: Motif、Rhythm Grammar、Phrase Architecture、Harmony Response、Register Trajectory、Development、Climax、Ending

明示的なユーザー指定は従来どおり最優先とし、Technique RuleはAuto解決だけを補助する。公開Technique Libraryが空の場合、生成結果は従来の決定論的フォールバックを使用する。

## 公開データ

公開用JSON Schemaは`schemas/composer-intelligence.schema.json`に置く。実名を使わない構造例は`schemas/examples/composer-intelligence.anonymous.json`に置く。
