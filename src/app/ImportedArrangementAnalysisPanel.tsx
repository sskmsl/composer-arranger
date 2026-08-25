import { AlertTriangle, AudioLines, CheckCircle2 } from "lucide-react"
import { analyzeImportedArrangementSection } from "@/ai-arranger/importedArrangementAnalysis"
import { useProjectStore } from "@/store/useProjectStore"
import { SectionCard } from "@/ui/primitives"

const ROLE_LABELS: Record<string, string> = {
  melody: "Melody",
  harmony: "Harmony",
  accompaniment: "Accompaniment",
  bass: "Bass",
  drums: "Drums",
  strings: "Strings",
  counter: "Counter",
  decoration: "Decoration",
  other: "Other",
}

export function ImportedArrangementAnalysisPanel() {
  const project = useProjectStore((state) => state.project)
  if (!project.importedArrangement) return null
  const analyses = project.sections.flatMap((section) => {
    const analysis = analyzeImportedArrangementSection(project, section.id)
    return analysis ? [analysis] : []
  })
  const totalTracks = project.importedArrangement.tracks.length
  const totalNotes = project.importedArrangement.tracks.reduce((sum, track) => sum + track.notes.length, 0)

  return (
    <SectionCard className="border-primary/20 bg-primary/[0.025]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-semibold text-body-on-dark">
            <AudioLines size={16} className="text-primary" /> Imported Arrangement Analysis
          </div>
          <p className="mt-1 max-w-3xl text-[10px] leading-5 text-body-muted">
            推定コードだけでなく、Logic／外部曲MIDIの原演奏を使って、役割・密度・余白・音域・主旋律衝突をSection単位で解析します。
          </p>
        </div>
        <span className="rounded-pill bg-primary/10 px-3 py-1 text-[9px] text-primary-on-dark">
          {project.importedArrangement.sourceKind === "logic-project" ? "Logic Pro" : "External Song"} · {totalTracks} tracks · {totalNotes} notes
        </span>
      </div>

      <div className="mt-4 grid min-w-0 gap-2 lg:grid-cols-2">
        {analyses.map((analysis) => (
          <article key={analysis.sectionId} className="min-w-0 rounded-lg border border-hairline bg-white/[0.025] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold text-body-on-dark">{analysis.sectionName}</p>
                <p className="mt-0.5 text-[9px] text-body-muted">
                  {analysis.totalBars}小節 · {analysis.totalNotes} notes · {analysis.textureDensity}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[8px] ${analysis.melodyCollisionCount > 0 ? "bg-amber-300/10 text-amber-100" : "bg-emerald-400/10 text-emerald-200"}`}>
                {analysis.melodyCollisionCount > 0 ? <AlertTriangle size={9} /> : <CheckCircle2 size={9} />}
                Melody衝突 {analysis.melodyCollisionCount}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {analysis.activeRoles.map((role) => (
                <span key={role} className="rounded-pill bg-white/5 px-2 py-0.5 text-[8px] text-body-muted">
                  {ROLE_LABELS[role] ?? role}
                </span>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-3 gap-1.5">
              <div className="rounded-sm bg-black/10 px-2 py-1.5">
                <p className="text-[8px] text-ink-muted-48">余白</p>
                <p className="text-[10px] text-body-on-dark">{Math.round(analysis.silenceRatio * 100)}%</p>
              </div>
              <div className="rounded-sm bg-black/10 px-2 py-1.5">
                <p className="text-[8px] text-ink-muted-48">同時Attack</p>
                <p className="text-[10px] text-body-on-dark">最大 {analysis.maximumSimultaneousAttacks}</p>
              </div>
              <div className="rounded-sm bg-black/10 px-2 py-1.5">
                <p className="text-[8px] text-ink-muted-48">Active Role</p>
                <p className="text-[10px] text-body-on-dark">{analysis.activeRoles.length}</p>
              </div>
            </div>

            <div className="mt-2 space-y-1">
              {analysis.roles.map((role) => (
                <div key={role.role} className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)_4rem] gap-2 text-[8px] leading-4 text-body-muted">
                  <span className="text-primary-on-dark">{ROLE_LABELS[role.role] ?? role.role}</span>
                  <span className="truncate">{role.trackNames.join(" / ")}</span>
                  <span className="text-right">{role.notesPerBar}/bar</span>
                </div>
              ))}
            </div>

            {analysis.observations.map((observation) => (
              <p key={observation} className="mt-2 text-[9px] leading-4 text-cyan-100">・{observation}</p>
            ))}
          </article>
        ))}
      </div>
    </SectionCard>
  )
}
