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

## Persistent Technique ID

Techniqueは`TECH-0001`形式の永続IDで管理する。名称、Observation、Intent、
Categoryを変更してもIDは変更しない。Genre Observation、Genre Principle、
Evidence、Review History、RuleはTechnique名ではなく永続IDを参照する。
この破壊的変更に伴い、Execution用Technique Libraryの`schemaVersion`は
`2`とする。旧semantic IDは永続IDへ移行してから読み込む。

## Knowledge BaseとExecution Engine

Learning層の`TechniqueKnowledgeRecord`は、名称、Evidence、Genre Sources、
Confidence、Review History、再現性確認を保持する。曲名や時間位置を含むため、
実データはGit管理外に置く。

Execution層の`TechniqueDefinition`は、検証済みKnowledgeから生成された
匿名のRule定義と集計値だけを持つ。Composer Arrangerは
`ResolvedComposerRules`だけを参照し、Knowledge BaseやEvidenceを読まない。
`compileKnowledgeForExecution()`をLearningとExecutionの唯一の変換点とし、
Evidence、曲名、Genre名、Review Historyを除去する。

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

## Technique Lifecycle

| Status | 昇格条件 | Composer Arrangerでの扱い |
| --- | --- | --- |
| Draft | 初回分析 | Learning層だけに保持し、Ruleへ変換しない |
| Validated | 最低1件のEvidenceでSection・時間・Intent・Observationを試聴確認し、Genre Principleが成立 | Canonicalがない軸では利用可能。Canonicalがある軸では補助成分 |
| Canonical | 再現性を確認し、2 Genre以上または確認済みEvidence 6件以上 | Technique Libraryの主成分として優先利用 |
| Deprecated | 誤分析・副作用・重複・利用終了 | Ruleへ変換しない |

CanonicalとValidatedが同じ軸へ該当する場合、Canonicalを重み`1.0`、
Validatedを補助重み`0.35`として集計する。Canonicalが存在しない軸では、
Validatedを通常重み`1.0`として扱う。

LifecycleはKnowledge Priorityとは別の概念である。Artist Intelligenceの
Priority 100、Technique LibraryのPriority 50、ExperimentalのPriority 20は
維持され、Canonical TechniqueであってもArtist Intelligenceを上書きしない。

Evidence 6件の閾値は`CANONICAL_EVIDENCE_THRESHOLD`として外部化し、
運用実績に応じて変更できる。

## Evidence

EvidenceはTechniqueごとに複数保持し、曲、Genre、Section、開始秒、終了秒、
コメント、Section確認、Intent確認、Observation確認、確認日時を記録する。
時間範囲と3つの確認項目が揃わないEvidenceはValidated昇格件数に含めない。

## Review History

Status変更とConfidence更新は、日時、変更前Status、変更後Status、理由、
Reviewerを履歴へ追記する。過去の履歴を上書きしない。

## Genre Principle

Principleへ昇格できるのは、人間確認済みで、同一Genre Source内に異なるReference IDを3件以上持つObservationだけである。同一Referenceの重複や未確認Observationは件数へ含めない。TechniqueをCanonicalへ昇格するには、異なるGenre SourceのValidated Principleが2件以上必要である。

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
