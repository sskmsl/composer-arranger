# Composer Intelligence Observation Dictionary

Observation Dictionary standardizes objective musical facts used by Analysis
Workspace. It is part of the Learning layer and has no dependency on Composer
Arranger's generation runtime.

## Definition and Instance

The two concepts are stored separately:

```text
Observation Definition (OBS-####)
  canonical vocabulary, Alias, Category, Value Type, relationships, Status

Observation Instance (OBSERVATION-####)
  observed value in one Song or Section, Confidence, validation, Note
```

An Observation is a fact that can be checked by listening or supporting MIDI
data. Interpretation belongs elsewhere:

| Layer | Example |
| --- | --- |
| Observation | A reverse sound occurs before the Section boundary |
| Intent | Connect the transition without a hard cut |
| Principle | Transitions can behave as musical time |
| Rule | Propose the Technique at a qualifying boundary |

This separation prevents subjective effects, reasons and style judgments from
becoming Dictionary terms.

## Backward compatibility

Analysis Workspace previously stored free-text records in `observations`.
Those records remain valid and unchanged. New structured records use
`kind: "dictionary-instance"` in the same normalized collection and reference
an `observationDefinitions` entry.

Existing project Markdown continues to import and export. Dictionary
Definitions required by exported Instances are included with their referenced
parents, related terms, opposites and merge targets.

## Initial Dictionary

New workspaces contain 60 Active seed terms covering:

- Density and Arrangement
- Register
- Rhythm
- Texture
- Space
- Transition
- Dynamics

The Seed is a starting vocabulary, not a Rule set. New terms start as Draft.
Seed IDs are stable and generated from
`tools/analysis-workspace/observation-seed.mjs`.

## CLI workflow

Search by ID, Canonical Name, Alias, Category, Status or Description:

```sh
npm run analysis -- observation-definition search \
  --query "Minimal Layering"

npm run analysis -- observation-definition search \
  --query "" \
  --category transition \
  --status active
```

Create a Draft Definition:

```sh
npm run analysis -- observation-definition add \
  --name "Simultaneous Major Part Count" \
  --description "Number of principal parts sounding simultaneously." \
  --category density \
  --aliases "Active Major Part Count" \
  --value-type number \
  --unit part_count
```

Exact Canonical Name and Alias duplication is rejected. Similar candidates are
shown but never merged automatically.

Add a structured Instance to a Section:

```sh
npm run analysis -- observation-instance add \
  --section SECTION-0001 \
  --observation OBS-0061 \
  --value 4 \
  --unit part_count \
  --confidence 0.94 \
  --validation validated \
  --note "Four principal layers are audible."
```

Values are parsed as JSON when possible. Examples:

- boolean: `--value true`
- number: `--value 4`
- range: `--value '[2,5]'`
- enum or text: `--value "long"`

## Status and merge resolution

Definition Status values follow the existing lowercase serialization style:

- `draft`
- `active`
- `deprecated`
- `merged`

```sh
npm run analysis -- observation-definition status \
  --id OBS-0061 \
  --status active

npm run analysis -- observation-definition status \
  --id OBS-0062 \
  --status merged \
  --merged-into OBS-0061
```

New use of a Deprecated term emits a warning. A Merged ID resolves to its
canonical target, and newly stored Instances use the resolved ID. Merge chains
are checked for invalid targets and cycles.

## Markdown

Definitions use readable YAML front matter plus a canonical JSON block:

```yaml
---
id: OBS-0001
canonicalName: "Sparse Arrangement"
description: "A small number of principal parts sound simultaneously."
category: density
aliases:
  - "Low Density Arrangement"
valueType: boolean
status: active
---
```

The `observation-definition-json` fenced block is the round-trip source of
truth. This preserves IDs, relationships and typed fields without ambiguous
prose parsing.

```sh
npm run analysis -- observation-definition export \
  --id OBS-0001 \
  --output reference-data/observations/OBS-0001.md

npm run analysis -- observation-definition import \
  --input reference-data/observations/OBS-0001.md
```

Real reference metadata remains under the gitignored `reference-data/`
directory.

## Validation

```sh
npm run analysis -- observation-definition validate
npm run analysis -- workspace validate
```

Errors include:

- duplicate ID, Canonical Name or Alias
- unsupported Category, Value Type, Status or validation state
- invalid Definition, Song or Section reference
- value and unit mismatch
- Confidence outside `0.0..1.0`
- parent cycles
- invalid or cyclic merge targets

Warnings include:

- a new Instance using a Draft term
- a new or existing Instance using a Deprecated term
- an existing Instance still referencing a Merged term

Warnings do not silently rewrite historical data.

## Technique connection

An Observation Instance may be linked to Technique Evidence. Observation
validation confirms only the objective fact and Section. Technique Intent must
be confirmed separately:

```sh
npm run analysis -- evidence add \
  --observation OBSERVATION-0001 \
  --technique TECH-0001 \
  --intent-confirmed true
```

This is the future Technique extraction connection point. The Dictionary does
not generate Techniques, infer Intent or create Rules automatically.
