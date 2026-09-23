# Short-material identity audit (2026-09-24)

This change concerns instrumental intro, signature, response, transition, ostinato, and decoration material. It does not alter the vocal Melody Generator or the separate Chord Generator. No reference pitches, rhythms, or riffs were stored in the generator.

## Evidence and abstractions

- Bach, *Invention No. 1*, BWV 772: the freely accessible score was used to examine how a short identity moves between voices and remains recognizable through development. We retained the abstract ideas of a small cell, return, and a role change between voices, not its notes or rhythm. [Score and license](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=40).
- Satie, *Gymnopédie No. 1*: the freely available score informed the decision to permit space and a stable background while the foreground remains small. This is a structural inference from the score, not a pattern transcription. [Score and public-domain status](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=37).
- John Carpenter described presenting a theme at the opening and returning to it sparingly, and described silence as a deliberate tool. This supports checking whether an active motif should return before adding a new one. [Composer interview](https://www.classicalcalifornia.org/articles/john-carpenter-halloween).
- New Order members described designing an electronic pulse and a contrasting attack as distinct sonic roles; Vince Clarke and Martin Gore described creating emotion through sound and sparse-to-dense arrangement changes. These support treating timbre and rhythmic placement as part of identity rather than adding melodic notes. [New Order interview](https://www.rhino.com/article/watch-new-order-reveal-how-blue-monday-was-made), [Clarke/Gore interview](https://thequietus.com/interviews/vcmg-martin-l-gore-vince-clarke-depeche-mode-interview/).
- In a controlled listening study, rhythm, contour, tonality, and meter all influenced perceived melodic similarity, with their relative contributions changing with context. We therefore evaluate rhythmic return and a compact contour without treating either as a universal numerical threshold. [Original study](https://pubmed.ncbi.nlm.nih.gov/25264859/).

## Implemented decisions

- Signature Phrase plans now follow the actual section role. One- and two-note cores are eligible alongside longer ones. A seed/pool arithmetic collision previously fixed every candidate in a batch to one motif variant; the selection now explores variants and retains a compact option when it passes the existing quality gate.
- Phrase plans identify response, transition, or ostinato roles. If an active melody exists, the candidate uses fewer notes and more space; it is evaluated for rhythmic return, motif return, compact range, controlled color, and lead collisions. Its register is separated from a crowded lead when possible.
- Phrase and Signature assignments now count as existing support for Decoration planning. The whole-song action gate treats them as active color, and AI Partner advises reusing an assigned motif for vague requests to add material. Explicit requests for a new phrase bypass that advice; the dedicated generator remains available.

## Reproducible comparison

Fixed conditions: Am(add9)–Fmaj7–Dm9–E7; four-bar section; two-bar candidates; identical seeds, profile, density, range, and drama. Phrase comparison: 12 seeds × 3 selected candidates, with a deliberately dense synthetic lead. Intro comparison: 8 seeds × 12 selected candidates. Measurements are code-level proxies, not listening-test results.

| Measure | Before | After |
| --- | ---: | ---: |
| Phrase notes/candidate | 9.06 | 7.22 |
| Phrase notes overlapping the lead within 6 semitones | 81.5% | 0.0% |
| Phrase onset collisions with lead | 36.3% | 25.5% |
| Phrase uncovered time | 13.5% | 20.6% |
| Phrase repeated contour-cell occurrence | 94.4% | 86.1% |
| Intro notes/candidate | 9.20 | 9.05 |
| Intro 1–2-note core share | 0.0% | 30.2% |
| Intro motif variants per seed batch | 1 | 4 |
| Intro built-in memorability score | 0.817 | 0.807 |
| Intro built-in overall score | 87.44 | 86.97 |

The Phrase score scale changed, so its old and new quality scores should not be compared directly. The shorter Phrase candidates lost some contour-cell recurrence, and the intro's built-in scores dipped slightly as the candidate set diversified. Neither metric establishes actual memorability or emotional impact; a listener A/B is still needed for that claim. The clear measured gains are register separation, space, and compact motif availability.
