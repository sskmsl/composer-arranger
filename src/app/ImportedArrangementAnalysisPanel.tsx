import { AlertTriangle, AudioLines, CheckCircle2 } from "lucide-react"
import { analyzeImportedArrangementSection } from "@/ai-arranger/importedArrangementAnalysis"
import { useProjectStore } from "@/store/useProjectStore"
import { SectionCard } from "@/ui/primitives"

const ROLE_LABELS: Record<string, string> = {
  melody: "主旋律",
  harmony: "コード",
  accompaniment: "伴奏",
  bass: "ベース",
  drums: "ドラム",
  strings: "弦",
  counter: "対旋律",
  decoration: "装飾",
  other: "その他",
}

export function ImportedArrangementAnalysisPanel() {
  const project = useProjectStore((state) => state.project)
  if (!project.importedArrangement) return null
  const analyses = project.sections.flatMap((section) => {
    const analysis = analyzeImportedArrangementSection(project, section.id)
    return analysis ? [analysis] : []
  })
  const totalTracks = project.importedArrangement.tracks.length

  return (
    <SectionCard className="border-primary/20 bg-primary/[0.025]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-semibold text-body-on-dark">
            <AudioLines size={16} className="text-primary-on-dark" /> 読み込んだ曲のパート
          </div>
          <p className="mt-1 max-w-3xl text-[12px] leading-5 text-body-muted">
            読み込んだMIDIの演奏から、セクションごとにどのパートが鳴っているかをまとめました。
          </p>
        </div>
        <span className="rounded-pill bg-primary/10 px-3 py-1 text-[12px] text-primary-on-dark">
          {project.importedArrangement.sourceKind === "logic-project" ? "Logic Pro" : "ほかで作った曲"} · {totalTracks}トラック
        </span>
      </div>

      <div className="mt-4 grid min-w-0 gap-2 lg:grid-cols-2">
        {analyses.map((analysis) => (
          <article key={analysis.sectionId} className="min-w-0 rounded-lg border border-hairline bg-white/[0.025] p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[12px] font-semibold text-body-on-dark">{analysis.sectionName}</p>
                <p className="mt-0.5 text-[12px] text-body-muted">
                  {analysis.totalBars}小節 · {analysis.totalNotes}音 · 音の量：{{ sparse: "少なめ", balanced: "ふつう", dense: "多め" }[analysis.textureDensity]}
                </p>
              </div>
              <span className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[12px] ${analysis.melodyCollisionCount > 0 ? "bg-amber-300/10 text-amber-100" : "bg-emerald-400/10 text-emerald-200"}`}>
                {analysis.melodyCollisionCount > 0 ? <AlertTriangle size={9} /> : <CheckCircle2 size={9} />}
                {analysis.melodyCollisionCount > 0 ? `主旋律とぶつかる所 ${analysis.melodyCollisionCount}` : "主旋律とぶつからない"}
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {analysis.activeRoles.map((role) => (
                <span key={role} className="rounded-pill bg-white/5 px-2 py-0.5 text-[12px] text-body-muted">
                  {ROLE_LABELS[role] ?? role}
                </span>
              ))}
            </div>

            <div className="mt-2 space-y-1">
              {analysis.roles.map((role) => (
                <div key={role.role} className="grid min-w-0 grid-cols-[5rem_minmax(0,1fr)_4rem] gap-2 text-[12px] leading-4 text-body-muted">
                  <span className="text-primary-on-dark">{ROLE_LABELS[role.role] ?? role.role}</span>
                  <span className="truncate">{role.trackNames.join(" / ")}</span>
                  <span className="text-right">{role.notesPerBar}音/小節</span>
                </div>
              ))}
            </div>

            {analysis.observations.map((observation) => (
              <p key={observation} className="mt-2 text-[12px] leading-4 text-cyan-100">・{observation}</p>
            ))}
          </article>
        ))}
      </div>
    </SectionCard>
  )
}
