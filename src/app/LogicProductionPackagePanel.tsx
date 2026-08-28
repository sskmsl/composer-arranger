import { useMemo } from "react"
import { Check, Download, FileText, Music2, PackageOpen } from "lucide-react"
import { buildWholeSongDirectionProgram } from "@/ai-arranger/wholeSongDirectionPlan"
import {
  buildLogicProductionPackage,
  downloadProductionGuide,
  type LogicProductionTrackPlan,
} from "@/midi/logicProductionPackage"
import { downloadMidi } from "@/midi/exportMelody"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, SectionCard } from "@/ui/primitives"

const STATUS_LABELS: Record<LogicProductionTrackPlan["status"], string> = {
  ready: "実音あり",
  guide: "置換ガイド",
  empty: "未生成",
}

const STATUS_CLASSES: Record<LogicProductionTrackPlan["status"], string> = {
  ready: "bg-emerald-400/10 text-emerald-200",
  guide: "bg-amber-300/10 text-amber-100",
  empty: "bg-white/5 text-ink-muted-48",
}

function filename(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "composer-arranger"
}

function TrackCard({ track }: { track: LogicProductionTrackPlan }) {
  return (
    <article className="min-w-0 rounded-lg border border-hairline bg-white/[0.025] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="break-words text-[11px] font-semibold text-body-on-dark">{track.trackName}</h4>
          <p className="mt-0.5 text-[11px] text-cyan-200">{track.role}</p>
        </div>
        <span className={`shrink-0 rounded-pill px-2 py-0.5 text-[11px] ${STATUS_CLASSES[track.status]}`}>
          {STATUS_LABELS[track.status]} · {track.noteCount} notes
        </span>
      </div>

      <p className="mt-2 text-[11px] leading-4 text-body-muted">{track.purpose}</p>
      <div className="mt-2 grid gap-1 text-[11px] leading-4 text-body-muted">
        <p><span className="text-ink-muted-48">Range</span> {track.pitchRange}</p>
        <p><span className="text-ink-muted-48">演奏</span> {track.performance}</p>
        <p><span className="text-ink-muted-48">定位</span> {track.panorama}</p>
        <p><span className="text-ink-muted-48">残響</span> {track.reverb}</p>
      </div>

      <div className="mt-3 space-y-1.5">
        {track.recommendations.map((recommendation) => (
          <div key={`${track.id}:${recommendation.product}`} className="rounded-sm border border-cyan-300/10 bg-cyan-300/[0.035] px-2.5 py-2">
            <p className="break-words text-[11px] font-medium text-cyan-100">{recommendation.product}</p>
            <p className="mt-0.5 break-words text-[11px] leading-4 text-body-muted">{recommendation.reason}</p>
            <p className="mt-1 break-words text-[11px] text-ink-muted-48">検索: {recommendation.searchTerms.join(" / ")}</p>
          </div>
        ))}
      </div>
    </article>
  )
}

export function LogicProductionPackagePanel() {
  const project = useProjectStore((state) => state.project)
  const brief = project.arrangementDirectorWorkspace?.brief ?? ""
  const directionProgram = useMemo(
    () => buildWholeSongDirectionProgram(project, brief),
    [project, brief],
  )
  const directionId = project.arrangementDirectorWorkspace?.selectedDirectionId
    ?? directionProgram.recommendedDirectionId
  const productionPackage = useMemo(
    () => buildLogicProductionPackage(project, directionId),
    [project, directionId],
  )
  const baseName = `${filename(project.title)}-logic-production-package`
  const populatedTracks = productionPackage.tracks.filter((track) => track.noteCount > 0)
  const noteCount = productionPackage.tracks.reduce((sum, track) => sum + track.noteCount, 0)

  const downloadAll = () => {
    downloadMidi(productionPackage.midi, baseName)
    downloadProductionGuide(productionPackage.guideMarkdown, `${baseName}-guide`)
  }

  return (
    <SectionCard className="border-cyan-400/20 bg-cyan-400/[0.025]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-body-on-dark">
            <PackageOpen size={16} className="shrink-0 text-cyan-300" />
            <span className="break-words">Logic Pro Production Package</span>
          </div>
          <p className="mt-1 max-w-3xl text-[11px] leading-5 text-body-muted">
            曲の小節位置を保った役割別MIDIと、Komplete 15 Ultimate／Repro-1・5だけで実行できる制作指示書をまとめます。
          </p>
          <p className="mt-1 break-words text-[11px] text-cyan-200">{productionPackage.directionTitle}</p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-pill bg-emerald-400/10 px-3 py-1 text-[11px] text-emerald-200">
          <Check size={11} /> SMF Type 1 · Logic Software Instrument互換
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["曲長", `${productionPackage.totalBars}小節`],
          ["実音Track", `${populatedTracks.length} / ${productionPackage.tracks.length}`],
          ["総Note", `${noteCount}`],
          ["MIDI Channel", "全Track Ch.1"],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-sm border border-white/5 bg-black/10 px-3 py-2">
            <p className="text-[11px] text-ink-muted-48">{label}</p>
            <p className="mt-0.5 break-words text-[11px] font-semibold text-body-on-dark">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.035] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={downloadAll} disabled={populatedTracks.length === 0}>
            <Download size={14} /> Logic Packageを書き出し
          </Button>
          <Button variant="ghost" onClick={() => downloadMidi(productionPackage.midi, baseName)} disabled={populatedTracks.length === 0}>
            <Music2 size={14} /> MIDIのみ
          </Button>
          <Button variant="ghost" onClick={() => downloadProductionGuide(productionPackage.guideMarkdown, `${baseName}-guide`)}>
            <FileText size={14} /> 制作指示書のみ
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-body-muted">
          一括書き出しは <strong className="text-body-on-dark">.mid と .md の2ファイル</strong>です。LogicではMIDIを新規プロジェクトへ読み込み、テンポ情報を使用してください。Section Markerと曲中位置を維持します。
        </p>
        <p className="mt-1 text-[11px] leading-4 text-amber-100">
          Bass Guide／Chord Guideは完成演奏ではありません。構成確認後、各Roleの推奨音源と演奏指示に沿って置換してください。
        </p>
      </div>

      <div className="mt-4 grid min-w-0 gap-2 lg:grid-cols-2">
        {productionPackage.tracks.map((track) => <TrackCard key={track.id} track={track} />)}
      </div>
    </SectionCard>
  )
}
