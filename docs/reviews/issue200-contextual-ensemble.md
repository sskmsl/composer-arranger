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

Synthetic existing review fixtures A/B. For this controlled comparison: A at 84 BPM with Genre neoclassical; B at 132 BPM with Genre electronica. Four conditions: each style with/without an assigned synthetic lead (three short notes per bar followed by a rest). Seeds 19, 41, 73. Section and chord IDs are assigned deterministically; each condition's input SHA-256 is identical across base and changed code. Both heads receive the same project JSON, and generation leaves it unchanged. `exportArrangementMidi` is reread by `parseMidi`; saved JSON is normalized and re-exported byte for byte. These are not measurements of the user's song or a listening assessment.

Raw measurements: `issue200-before.json` and `issue200-after.json`. Event totals are note events, not loudness, mix balance or perceived importance.

| Condition | Percussion events before | Percussion events after | New answer overlapping lead after |
| --- | ---: | ---: | ---: |
| Non-percussion context, no lead | 929–942 | 413–426 | 0 |
| Non-percussion context, lead | 929–942 | 413–426 | 0 |
| Rhythm context, no lead | 1410–1418 | 1370–1375 | not a new answer role |
| Rhythm context, lead | 1177–1182 | 1068–1073 | not a new answer role |

All 12 outputs pass the unchanged quality and audition gates. Quality after: 91.07–94.14; audition after: 94.2–96.4. Non-percussion lead cases contain six answer notes per selected output, with zero actual lead overlap after finalization. Without a lead no answer is invented. The rhythm context retains the existing rhythmic performance rather than converting every song to an acoustic accompaniment. In the electronic-context fixtures, non-percussion pitch and timing are mostly the legacy performance (some velocity and selected-candidate differences remain); this change does not claim that every instrument family received a new performance generator.

## Compatibility and validation

Clean base 0834a0c: 1431 passed / 7 skipped. Main 235abec adds three UI tests (CI reported 1434 passed / 7 skipped). New instrument routing tests cover saved reload, preview sample requests, MIDI notes, production guidance, legacy fallback, invalid values and drum protection. New role tests check distributed chord tones, entry/end limits, genuine melody rests, dense-lead register protection, useful rhythm support and explicit preservation.

Boundary classification, previous-two/next-four-bar window, one-bar rest allowance, maximum two layer changes, Safe/Edge/Surprise behavior and quality thresholds are unchanged. Composer Song Exchange import/export contracts are unchanged. The arrangement JSON field is optional; the arrangement version is unchanged. The code-generation app was not edited.

Existing warnings: importMidi.ts:174 no-control-regex; large build chunk; npm proxy environment warning.

## Independent review and GM channel compatibility

Claude Code review: Issue #200 comment 6327300863; independent test branch `claude/independent-review-200`, commit `6ec66d7`. That review ran against the instrument foundation e61ea35, before the performance changes. It reproduced loss of a saved instrument on whole-track regeneration (fixed, with a regression test), an ownership conflict in the first production-guide trial (fixed without changing main expectations), and a pre-existing GM channel collision. Latest-head independent revalidation is recorded in PR comments 6353114466 and 6358454578; its two same-tick ordering blockers were reproduced before the fix. The independent test files from branch `claude/independent-review-200-v2`, commit `30c45a1`, were incorporated after narrowing their copied ownership allowlist to the tested non-percussion tracks and omitting an unused person-derived product branch. Claude Code's separate fix `6ff30b4` (comment 6367087004) was compared rather than cherry-picked; its allocation changes are equivalent to the implemented fix. This branch additionally verifies that a later same-program note does not resend ProgramChange during a sustain.

GM has fifteen non-percussion channels. The legacy allocator wrapped channels after fifteen sounding tracks, so a later Program Change could overwrite a different sustained sound. The final full-song measurement now fixes all generated IDs and includes chords, lead and selected layers as well as the arrangement. The 12 outputs contain 14–17 distinct programs over the whole song, but need only 11–13 simultaneous channels (10–12 simultaneous programs; the extra channel protects overlapping notes with the same program and pitch). Every NoteOn is reread from the final SMF and checked against the saved/preview program. No Program Change occurs while a different program is active on that channel, and no shared channel contains overlapping equal-pitch notes.

GM export now keeps the existing assignment byte ordering for up to fifteen sounding melodic tracks. Only when the legacy assignment would share a sounding channel does it use the same channel for compatible notes of the same program and reuse a completely silent channel before a later Program Change. Notes ending at the current tick remain in the global active set; only the same track may rely on its local NoteOff → ProgramChange → NoteOn order. When several tracks first share a channel at one tick, each track receives the same necessary ProgramChange before its NoteOn, while later same-program notes do not resend it during a sustain. Ascending and descending same-tick track order both pass the 24 final-MIDI cases. If a saved song truly requires more than fifteen channels at once, export raises `GmChannelCapacityError`; it does not consolidate instruments, discard notes or introduce multiple MIDI ports. The current full-song download handler does not show that rare error to the user; notification is tracked separately in Issue #203. The saved arrangement, preview decision, Composer Song Exchange data and Logic export are unchanged. Raw full-song results, input/MIDI hashes and note counts are in `issue200-gm-capacity.json`.

The initial full run found one failing existing measurement (eligible candidates: 5/6). Reduced support exposed a delayed entrance restarting an old chord tone on a new chord. The repair keeps the same timing schedule and revoices only a delayed Safe entrance to its actual chord. A final-MIDI regression covers this. A subsequent average-audition regression was corrected by shaping quiet accompaniment and retaining musically justified peak kick/snare support; the existing measurement then passed, without changing its average >=95 requirement.

## Validation and remaining checks

The latest local full suite passes with 1491 passed / 7 skipped. The two independent expected failures are now normal tests; the independent GM file passes 36/36, including ascending and descending order for all 24 final-MIDI cases. The focused instrument, boundary and MIDI set passes 57/57. The fixed-UUID full-song capacity report was regenerated twice and matches the committed JSON byte for byte (SHA-256 `3ac26635637fdcf9746944b3281d42c9ba2f3334838385dac928bcf4e49a1c80`). TypeScript/build/lint pass. Existing warnings only: the import control-character rule, the large bundle chunk, and the npm proxy configuration warning. The UI diff against main235abec is empty.

An independent local browser check covered generation, proposal comparison/adoption/no-change, mobile width and stopping playback when switching to an older version; all nine checks passed. A separate condition also confirmed audible-note generation for the distributed guitar accompaniment. These checks do not replace listening assessment across all styles.

Pending: latest-head CI and Claude Code re-review of the published fixed SHA. No merge or deployment has been performed for this issue. Listening in a DAW and authenticated production-browser operation have not been verified. Same-value ProgramChange behavior was verified by SMF event simulation, not on a hardware GM device. No new audio search was performed, and no real artist/song/era names are added in the implementation branch or report.
