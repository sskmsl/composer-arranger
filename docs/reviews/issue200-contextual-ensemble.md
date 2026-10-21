# Issue 200: contextual ensemble review

Base: main `0834a0c`; integrated main `235abec` (the separate UI change is preserved). Implementation: PR #201, branch `codex/contextual-ensemble-200`.

## Scope

Use existing roles for chord-specific distributed accompaniment and a single-line answer in real melody rests. Select a whole-track instrument once; do not insert changing programs at section boundaries. Decide whether percussion support has a distinct job, without a target instrument ratio. Existing bass, sustained harmony and strings generators remain available; no extra string layer is mandatory.

Like existing context generators, the new performance decisions use explicit Genre or reference-derived style context. Projects without that context retain the legacy generation path. Explicit sound instructions and requested/preserved tracks take priority. Opening an old saved arrangement does not regenerate it.

The first trial changed the context-free path and removed too many layers in the existing final-section fixture. That trial was corrected without changing its expected minimum. A first production-guide trial proposed generic GM instruments; it was corrected to use the existing owned production-source mapping and existing verified preset resolver. No existing expectations, thresholds, fixtures or snapshots were edited.

## Changes

- `contextualEnsemble.ts`: musical role decisions, independently generated accompaniment/answers, optional support suppression before existing performance and finalization checks.
- `arrangementGenerator.ts`: full generation and target regeneration enter the same ensemble stage.
- `arrangementGeneration.ts`: optional track instrument, preserving existing version and IDs.
- `gmInstruments.ts`, `previewPlayer.ts`, `exportArrangement.ts`: shared validated instrument resolution, legacy fallback, percussion protection.
- `logicProductionPackage.ts`: actual selected instrument family and production guidance; explicit existing production-source requests remain prioritized.
- New instrument, ensemble and final-MIDI tests. No UI edits.

## Measurement conditions

Synthetic existing review fixtures A/B. For this controlled comparison: A at 84 BPM with Genre neoclassical; B at 132 BPM with Genre electronica. Four conditions: each style with/without an assigned synthetic lead (three short notes per bar followed by a rest). Seeds 19, 41, 73. Both base and changed code generate the same input; exportArrangementMidi is reread by parseMidi. Saved JSON is normalized and re-exported byte for byte. Inputs remain unchanged. These are not measurements of the user's song or a listening assessment.

Raw measurements: `issue200-before.json` and `issue200-after.json`. Event totals are note events, not loudness, mix balance or perceived importance.

| Condition | Percussion events before | Percussion events after | New answer overlapping lead after |
| --- | ---: | ---: | ---: |
| Non-percussion context, no lead | 929–942 | 413–426 | 0 |
| Non-percussion context, lead | 929–942 | 413–426 | 0 |
| Rhythm context, no lead | 1479–1484 | 1370–1375 | not a new answer role |
| Rhythm context, lead | 1177–1182 | 1068–1073 | not a new answer role |

All 12 outputs pass the unchanged quality and audition gates. Quality after: 90.97–94.15; audition after: 94.2–96.4. Non-percussion lead cases contain six answer notes per selected output, with zero actual lead overlap after finalization. Without a lead no answer is invented. The rhythm context retains the existing rhythmic performance rather than converting every song to an acoustic accompaniment.

## Compatibility and validation

Clean base 0834a0c: 1431 passed / 7 skipped. Main 235abec adds three UI tests (CI reported 1434 passed / 7 skipped). New instrument routing tests cover saved reload, preview sample requests, MIDI notes, production guidance, legacy fallback, invalid values and drum protection. New role tests check distributed chord tones, entry/end limits, genuine melody rests, dense-lead register protection, useful rhythm support and explicit preservation.

Boundary classification, previous-two/next-four-bar window, one-bar rest allowance, maximum two layer changes, Safe/Edge/Surprise behavior and quality thresholds are unchanged. Composer Song Exchange import/export contracts are unchanged. The arrangement JSON field is optional; the arrangement version is unchanged. The code-generation app was not edited.

Existing warnings: importMidi.ts:174 no-control-regex; large build chunk; npm proxy environment warning.

## Independent review and unresolved GM policy

Claude Code review: Issue #200 comment 6327300863; independent test branch `claude/independent-review-200`, commit `6ec66d7`. That review ran against the instrument foundation e61ea35, before the performance changes. It reproduced loss of a saved instrument on whole-track regeneration (fixed, with a regression test), an ownership conflict in the first production-guide trial (fixed without changing main expectations), and a pre-existing GM channel collision. Latest-head independent revalidation has been requested; it has not yet been received.

GM has fifteen non-percussion channels. The legacy allocator wraps channels after fifteen tracks, allowing different programs to overwrite one another. Sharing channels for identical programs reduces the problem, but outputs and arbitrary saved assignments can still contain more than fifteen distinct instruments. A single-port GM file cannot preserve more than fifteen simultaneous non-percussion programs. Changing to multiple MIDI ports affects player compatibility; consolidating instruments changes the saved/preview instrument decision. Neither policy has been silently implemented. This compatibility decision requires the user's judgment under Issue #200's instruction to report before changing existing specifications. Logic export's existing separate-track behavior is unchanged.

The initial full run found one failing existing measurement (eligible candidates: 5/6). Reduced support exposed a delayed entrance restarting an old chord tone on a new chord. The repair keeps the same timing schedule and revoices only a delayed Safe entrance to its actual chord. A final-MIDI regression covers this. A subsequent average-audition regression was corrected by shaping quiet accompaniment and retaining musically justified peak kick/snare support; the existing measurement then passed, without changing its average >=95 requirement.

## Pending

Integrated code head e8f7e412: 1446 passed / 7 skipped, TypeScript/build/lint passed. Existing warnings only. The UI diff against main235abec is empty. Added diff reviewed for prohibited real artist/song/era names: none added.

Pending: latest-head CI confirmation, latest-head independent Claude Code revalidation, and the GM overflow policy. No merge or deployment has been performed for this issue. Listening and authenticated browser operation have not been verified. No new audio search was performed, and no real artist/song/era names are added in the change or report.
