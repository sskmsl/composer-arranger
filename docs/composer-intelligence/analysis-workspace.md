# Composer Intelligence Analysis Workspace

Analysis Workspace is a standalone Knowledge Authoring Tool for building the
Composer Intelligence knowledge base. It does not import or call Composer
Arranger and does not add generation behavior to the application.

## Responsibilities

The workspace manages this normalized chain:

```text
Analysis Project
  → Song
    → Section
      → Observation + Intent
        → Technique candidate
          → Evidence
            → Draft → Validated → Canonical
```

- Analysis Project groups references by Genre.
- Song stores reference metadata.
- Section stores an exact start and end time.
- Observation stores a factual observation, its musical intent, confidence and
  validation state.
- Technique candidates reference stable `TECH-####` IDs.
- Evidence links a Technique back to the exact Observation and Section.
- Review History records every Technique status change.

Duplicate detection presents similar Technique candidates. It never merges
records automatically; the author makes that decision.

## Privacy boundary

Real artist, song and album data is private analysis material. The default
workspace lives at:

```text
reference-data/analysis-workspace/workspace.json
```

The whole `reference-data/` directory is gitignored. Do not override `--data`
with a tracked path when entering real reference data. Public files contain
only the schema and an anonymous example.

## CLI

Run commands from the repository root:

```sh
npm run analysis -- help
```

Create an analysis hierarchy:

```sh
npm run analysis -- project create \
  --genre "Example Genre" \
  --name "Example Genre Analysis"

npm run analysis -- song add \
  --project PROJECT-0001 \
  --title "Private reference title" \
  --artist "Private reference artist" \
  --album "Private reference album" \
  --year 2026

npm run analysis -- section add \
  --song SONG-0001 \
  --type intro \
  --start 0 \
  --end 18.5
```

Add or validate an Observation:

```sh
npm run analysis -- observation add \
  --section SECTION-0001 \
  --text "A restrained texture precedes the entrance." \
  --intent "Make the next entrance feel inevitable." \
  --confidence 0.88

npm run analysis -- observation validate \
  --id OBSERVATION-0001 \
  --validation validated
```

Search before adding a Technique:

```sh
npm run analysis -- technique search --query "Reverse"

npm run analysis -- technique add \
  --name "Reverse Atmosphere" \
  --category transition \
  --observation "A reversed texture approaches a boundary." \
  --intent "Connect scenes without a hard cut." \
  --genre "Example Genre" \
  --confidence 0.85
```

Confirm the Genre Principle, link Evidence and promote the Technique:

```sh
npm run analysis -- technique principle \
  --id TECH-0001 \
  --statement "A transition can act as musical time." \
  --confirmed true

npm run analysis -- evidence add \
  --observation OBSERVATION-0001 \
  --technique TECH-0001 \
  --comment "Section audition confirmed."

npm run analysis -- validate \
  --technique TECH-0001 \
  --status validated \
  --reason "Observation, intent and Section confirmed." \
  --reviewer "Internal reviewer"
```

Validated requires at least one verified Evidence item and a confirmed Genre
Principle. Canonical additionally requires reproducibility confirmation and
either multiple Genres or six verified Evidence items.

## Dashboard and unverified queue

```sh
npm run analysis -- dashboard --genre "Example Genre"
npm run analysis -- dashboard --html reference-data/analysis-dashboard.html
npm run analysis -- drafts --sort confidence
npm run analysis -- drafts --sort updated
npm run analysis -- drafts --sort genre
```

The HTML dashboard is intentionally minimal and is generated from the same
workspace data as the CLI.

## Markdown round-trip

An Analysis Project can be exported for human editing and imported without
losing stable IDs:

```sh
npm run analysis -- markdown export \
  --project PROJECT-0001 \
  --output reference-data/example-analysis.md

npm run analysis -- markdown import \
  --input reference-data/example-analysis.md
```

The readable Markdown is accompanied by a canonical
`analysis-workspace-json` fenced block. The JSON block is the import source of
truth, which prevents ambiguous prose parsing.

## Integrity

```sh
npm run analysis -- workspace validate
```

Runtime validation checks schema version, duplicate IDs and references between
Project, Song, Section, Observation and Technique. Section overlaps are
rejected when entered. Writes use a temporary file followed by an atomic
rename, so interrupted saves do not partially overwrite the workspace.

The public JSON Schema is
`schemas/analysis-workspace.schema.json`. JSON Schema validates record shape;
the CLI performs cross-record reference and lifecycle validation.

## Intentional limits

- No automatic Technique merge.
- No automatic Rule generation.
- No audio analysis or playback.
- No Composer Arranger runtime dependency.
- No production GUI. The HTML dashboard is a read-only operational view.

These boundaries keep Learning separate from Execution and preserve human
review at every knowledge promotion step.
