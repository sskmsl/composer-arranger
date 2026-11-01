import { createServer } from "vite"
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises"
import { resolve } from "node:path"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"

const args = process.argv.slice(2)
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
if (!option("--out")) throw new Error("Usage: npm run qa:listening -- --out /path/to/output [--compare docs/testing/listening-baseline.json]")
const output = resolve(option("--out"))
await mkdir(output, { recursive: true })
const server = await createServer({ configFile: false, resolve: { alias: { "@": resolve("src") } },
  server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: "custom" })
const sha = value => createHash("sha256").update(value).digest("hex")
const normalizeTimes = (_key, value) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ? "2026-11-01T00:00:00.000Z" : value
try {
  const { listeningCases, createListeningCase } = await server.ssrLoadModule("/tools/qa/listeningCases.ts")
  const { exportArrangementMidi, exportArrangementLeadMidi } = await server.ssrLoadModule("/src/midi/exportArrangement.ts")
  const { parseMidi } = await server.ssrLoadModule("/src/midi/importMidi.ts")
  const cases = []
  for (const item of listeningCases) for (const seed of [19, 41]) {
    const key = `${item.id}-seed-${seed}`
    const { project, arrangement } = createListeningCase(item.id, seed)
    const midi = exportArrangementMidi(project, arrangement), lead = exportArrangementLeadMidi(project, arrangement)
    const parsed = parseMidi(midi), parsedLead = parseMidi(lead)
    const notes = parsed.tracks.flatMap(track => track.notes), leadNotes = parsedLead.tracks.flatMap(track => track.notes)
    if (Buffer.from(midi.subarray(0, 4)).toString() !== "MThd" || !notes.length || !leadNotes.length) throw new Error(`${key}: incomplete MIDI material`)
    await writeFile(resolve(output, `${key}-full.mid`), midi)
    await writeFile(resolve(output, `${key}-lead.mid`), lead)
    await writeFile(resolve(output, `${key}.json`), JSON.stringify(project, normalizeTimes, 2) + "\n")
    cases.push({ key, label: item.label, seed, meter: item.meter, tempo: item.tempo,
      bars: project.sections.reduce((sum, section) => sum + section.lengthBars, 0),
      fullMidiSha256: sha(midi), leadMidiSha256: sha(lead), midiBytes: midi.length,
      noteCount: notes.length, leadNoteCount: leadNotes.length, channels: [...new Set(notes.map(note => note.channel))].sort((a,b) => a-b),
      tracks: parsed.tracks.filter(track => track.notes.length).map(track => ({ name: track.name, noteCount: track.notes.length,
        pitchLow: Math.min(...track.notes.map(note => note.pitch)), pitchHigh: Math.max(...track.notes.map(note => note.pitch)) })),
      sections: project.sections.map(section => ({ name: section.name, startBar: section.startBar, lengthBars: section.lengthBars, role: section.role })),
      qualityWarning: arrangement.selection?.qualityWarning ?? null,
    })
    console.log(`${key}: ${notes.length} notes / ${leadNotes.length} lead notes / ${midi.length} bytes`)
  }
  const manifest = { format: "arranger-listening-review-v1", sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    engineBaseline: "c9a017fde0868358265c27eb0e8616db68863ac7", cases }
  await writeFile(resolve(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  await copyFile(resolve("docs/testing/listening-review.md"), resolve(output, "README.md"))
  if (option("--compare")) {
    const baseline = JSON.parse(await readFile(resolve(option("--compare")), "utf8"))
    const changed = cases.filter(item => {
      const before = baseline.cases.find(previous => previous.key === item.key)
      return !before || before.fullMidiSha256 !== item.fullMidiSha256 || before.leadMidiSha256 !== item.leadMidiSha256
    }).map(item => item.key)
    if (baseline.cases.length !== cases.length || changed.length) throw new Error(`Listening baseline differs. Review before accepting: ${changed.join(", ")}`)
    console.log("All full/lead MIDI hashes match the listening baseline.")
  }
} finally { await server.close() }
