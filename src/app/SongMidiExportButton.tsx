import { useState } from "react"
import { Download } from "lucide-react"
import type { ComposerProject } from "@/core/project"
import { gmExportPrograms } from "@/audio/soundSettings"
import { downloadMidi } from "@/midi/exportMelody"
import { prepareSongMidiExport } from "./songMidiExport"
import { Button } from "@/ui/primitives"

export function SongMidiExportButton({ project }: { project: ComposerProject }) {
  const [failure, setFailure] = useState<{ projectId: string; message: string } | null>(null)
  const message = failure?.projectId === project.projectId ? failure.message : null
  return <>
    <Button variant="dark" disabled={project.sections.length === 0}
      aria-describedby={message ? "song-midi-export-error" : undefined}
      onClick={() => {
        setFailure(null)
        const result = prepareSongMidiExport(project, gmExportPrograms())
        if (!result.ok) {
          setFailure({ projectId: project.projectId, message: result.message })
          return
        }
        downloadMidi(result.bytes, `${project.title}-full-song`)
      }}>
      <Download size={14} /> 曲全体MIDI
    </Button>
    {message && <p id="song-midi-export-error" role="alert"
      className="basis-full rounded-sm border border-red-400/30 bg-red-400/10 px-3 py-2 text-[13px] text-red-200">
      {message}
    </p>}
  </>
}
