"""Pinned, temporary observation copy for Issue #213. Never edits production source.

prepare: creates src/melody-engine/pr213-internals.ts and tools/pr213-trace.test.ts.
clean: removes those files only when their content still matches this generator.
compact: converts /private/tmp/pr213-trace.json into phase-trace.jsonl here.
"""
from pathlib import Path
import hashlib
import json
import sys

EVIDENCE = Path(__file__).resolve().parent
ROOT = EVIDENCE.parents[2]
EXPECTED_BLOB = "4675a70d650265be804c9493de89454612caac21"
INSERTIONS = [(3670, '        PR213_TRACE.push({stage:"budget",boundary,bar,existing,changing:changing.map(i=>work[i].id),room,target,removed:work[index].id})\n'), (3899, '  PR213_TRACE.push({stage:"built",spacing,sparse,monoOnly,repeat,counts:pr213Counts(project,riff.notes)})\n'), (3907, '    PR213_TRACE.push({stage:"fitted",pass,counts:pr213Counts(project,next?.notes??[])})\n'), (3917, '    PR213_TRACE.push({stage:"conflicts",pass,conflictBars:[...conflictBars],counts:pr213Counts(project,notes)})\n'), (3926, '    PR213_TRACE.push({stage:"density",pass,counts:pr213Counts(project,notes)})\n'), (3936, '    PR213_TRACE.push({stage:"quality",quality,before,audition:candidate.audition?.score,beforeAudition:legacy.audition?.score})\n'), (3949, '  PR213_LEGACY = legacy\n'), (4166, '\nexport const PR213_TRACE: unknown[] = []\nexport let PR213_LEGACY: FullSongArrangement | undefined\nexport const PR213_INTERNALS = { buildGuitarRiff, riffGuitarCandidate, fitGuitarToBoundaryBudget, barPresence, isBoundaryManagedRole }\nfunction pr213Counts(project: ComposerProject, notes: GeneratedArrangementNote[]) {\n const bpb = parseTimeSignature(project.song.timeSignature).beatsPerBar\n return project.sections.map(s=>({id:s.id,role:s.role,bars:[...new Set(notes.filter(n=>n.sectionId===s.id).map(n=>Math.floor(n.startBeat/bpb)-(s.startBar-1)))].sort((a,b)=>a-b)}))\n}\n')]


def generated_files():
    source = (ROOT / "src/melody-engine/arrangementGenerator.ts").read_bytes()
    blob = hashlib.sha1(b"blob " + str(len(source)).encode() + b"\0" + source).hexdigest()
    if blob != EXPECTED_BLOB:
        raise SystemExit("Generator changed from pinned b173868; review instrumentation first")
    lines = source.decode().splitlines(keepends=True)
    for index, addition in reversed(INSERTIONS):
        lines[index:index] = [addition]
    return {
        ROOT / "src/melody-engine/pr213-internals.ts": "".join(lines),
        ROOT / "tools/pr213-trace.test.ts": (EVIDENCE / "measurement.ts").read_text(),
    }


def compact():
    rows = json.loads(Path("/private/tmp/pr213-trace.json").read_text())
    for row in rows:
        for event in row["trace"]:
            if "counts" in event:
                event["counts"] = {s["id"]: s["bars"] for s in event["counts"]}
            if event["stage"] == "quality":
                for key in ["quality", "before"]:
                    q = event[key]
                    event[key] = {"passed": q["passed"], "score": q["score"],
                        "melodyCollisionCount": q["metrics"]["melodyCollisionCount"],
                        "harmonicViolationCount": q["metrics"]["harmonicViolationCount"]}
    (EVIDENCE / "phase-trace.jsonl").write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows))


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) == 2 else ""
    if command == "compact":
        compact()
    elif command in ["prepare", "clean"]:
        files = generated_files()
        for path, content in files.items():
            if path.exists() and path.read_text() != content:
                raise SystemExit(f"Refusing to overwrite/remove modified file: {path}")
        for path, content in files.items():
            if command == "prepare":
                path.write_text(content)
            elif path.exists():
                path.unlink()
    else:
        raise SystemExit("Usage: python3 instrument.py prepare|compact|clean")
