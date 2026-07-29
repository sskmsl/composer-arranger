# Composer Intelligence First Analysis Validation Pipeline

This pipeline is the first operational connection test across Genre
Intelligence, Analysis Workspace, Observation Dictionary, Technique Library and
Technique Lifecycle.

It is a Learning-layer tool. It does not apply Rules to Composer Arranger.

## Flow

```text
Genre Analysis Markdown
  → existing Technique lookup
  → Observation Dictionary matching
  → draft Observation Instances
  → Evidence Candidates
  → listening Validation Queue
  → Validate / Reject / Revise
  → anonymous Draft Rule Candidates
```

No Section or time range is inferred. Unknown values remain `unresolved` and
`unknown` until a human review explicitly confirms them.

## Private data boundary

Analysis Markdown, source registries, pipeline state and listening queues
contain reference metadata. Keep them under `reference-data/`, which is
gitignored.

Public code, schemas and examples contain anonymous placeholder metadata only.
Generated Rule Candidates are checked to ensure that reference artist and song
names are absent.

## Import

```sh
npm run analysis -- pipeline import \
  --analysis reference-data/example/analysis.md \
  --knowledge-base reference-data/example/knowledge-base.json \
  --sources reference-data/example/source-registry.json \
  --output reference-data/example/validation-pipeline.json
```

The importer:

- parses the existing Genre Analysis Markdown format;
- uses the private Source Registry rather than inventing Source metadata;
- reuses an exact existing Technique;
- presents strong existing matches without merging automatically;
- issues a new persistent Draft Technique ID only when no reliable match exists;
- records separate analysis and validation confidence values.

All imported Evidence starts as `needs-listening`.

## Observation matching

Every analysis statement is classified as:

- `exact-match`
- `alias-match`
- `related-match`
- `new-observation-candidate`
- `unresolved`

Exact and Alias matches use Dictionary vocabulary. Related matches may use the
Technique's established Dictionary anchor or lexical candidates, but always
require human confirmation. No semantic meaning is silently finalized.

## Validation Queue

```sh
npm run analysis -- pipeline queue \
  --pipeline reference-data/example/validation-pipeline.json \
  --output reference-data/example/validation-queue.md \
  --sort technique
```

Sort options:

- `technique`
- `song`
- `genre`
- `confidence`
- `missing-time`
- `unconfirmed-section`

The Markdown includes the Technique, private Source metadata, Section
candidates, time state, Observation checklist, Intent hypothesis and explicit
Review fields.

## Review

Review one Evidence directly:

```sh
npm run analysis -- pipeline review \
  --pipeline reference-data/example/validation-pipeline.json \
  --evidence EVD-0001 \
  --action validate \
  --reviewer "Internal reviewer" \
  --reason "Confirmed by listening." \
  --section intro \
  --start "00:00" \
  --end "00:18" \
  --time-status confirmed \
  --observation-confirmed true \
  --technique-confirmed true \
  --section-confirmed true \
  --validation-confidence 0.9
```

Validation requires:

- audible Observation confirmation;
- a valid Technique relationship;
- a confirmed standard Section;
- confirmed start and end time, or an explicit `time-not-required` decision;
- reviewer and reason.

Reject keeps the Evidence and requires a reason. Revise preserves before/after
snapshots and returns the Evidence to `needs-listening`.

The edited Queue can also be reimported:

```sh
npm run analysis -- pipeline queue-import \
  --pipeline reference-data/example/validation-pipeline.json \
  --input reference-data/example/validation-queue.md
```

Only Review blocks with a non-empty `Result` are applied.

## Promotion display

```sh
npm run analysis -- pipeline promotions \
  --pipeline reference-data/example/validation-pipeline.json
```

This reports whether a Technique has enough validated Evidence to be considered
for Validated status and whether it resembles a Canonical candidate. It never
changes Technique status automatically.

## Anonymous Rule Candidate

```sh
npm run analysis -- pipeline rules \
  --pipeline reference-data/example/validation-pipeline.json \
  --output reference-data/example/rule-candidates.json
```

Unvalidated Techniques are reported as blocked. A validated Technique produces
only a Draft skeleton:

```json
{
  "techniqueId": "TECH-0001",
  "category": "arrangement",
  "applicableSections": ["intro"],
  "action": {
    "type": "manual-authoring-required"
  },
  "sourceEvidenceIds": ["EVD-0001"],
  "status": "draft-rule-candidate"
}
```

The pipeline deliberately does not invent executable Actions. Preconditions,
Action mapping and final Constraints require human authoring in a later stage.

## Validation

```sh
npm run analysis -- pipeline validate \
  --pipeline reference-data/example/validation-pipeline.json
```

Validation distinguishes errors from expected listening warnings. It verifies:

- unique and valid references;
- supported Observation match, Evidence and time statuses;
- Confidence ranges;
- no time values when time is Unknown;
- required Review History and confirmation evidence for Validated records;
- Reject reasons;
- standard Section usage.

The public schema is
`schemas/first-analysis-validation.schema.json`. Its companion example is fully
anonymous.

## Non-goals

- audio analysis;
- automatic Section or time estimation;
- automatic Technique approval;
- automatic Canonical promotion;
- executable Rule generation;
- Rule application to Composer Arranger;
- full GUI.
