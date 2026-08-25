import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, Check, Music2, Play, Plus, Square, Trash2, X } from "lucide-react"
import { previewPlayer } from "@/audio/previewPlayer"
import { parseChordSymbol } from "@/core/chord"
import type { ComposerProject } from "@/core/project"
import { SECTION_ROLE_LABELS, type SectionRole } from "@/core/section"
import {
  createMidiProjectFromAnalysis,
  midiChordOverrideKey,
  type MidiImportAnalysis,
  type MidiImportSectionDraft,
  type MidiImportTrackRole,
} from "@/midi/importMidi"
import { Button, Select, TextInput } from "@/ui/primitives"

const SECTION_ROLES = Object.keys(SECTION_ROLE_LABELS) as SectionRole[]
const SUPPORT_ROLES: Array<Exclude<MidiImportTrackRole, "melody">> = [
  "harmony",
  "accompaniment",
  "bass",
  "drums",
  "strings",
  "counter",
  "decoration",
  "other",
  "ignore",
]
const ROLE_LABELS: Record<MidiImportTrackRole, string> = {
  melody: "Melody",
  harmony: "Harmony / Chords",
  accompaniment: "Accompaniment / Pattern",
  bass: "Bass",
  drums: "Drums",
  strings: "Strings",
  counter: "Counter",
  decoration: "Decoration / FX",
  other: "Other",
  ignore: "読み込まない",
}

function supportingRoles(analysis: MidiImportAnalysis): Record<number, Exclude<MidiImportTrackRole, "melody">> {
  return Object.fromEntries(analysis.tracks.map((track) => [
    track.index,
    track.recommendedRole === "melody" ? "other" : track.recommendedRole,
  ])) as Record<number, Exclude<MidiImportTrackRole, "melody">>
}

function sectionLengthAt(sections: MidiImportSectionDraft[], index: number, totalBars: number): number {
  const sorted = [...sections].sort((left, right) => left.startBar - right.startBar)
  const section = sorted[index]
  return Math.max(1, (sorted[index + 1]?.startBar ?? totalBars + 1) - section.startBar)
}

export function MidiImportReviewDialog({
  analysis,
  onCancel,
  onConfirm,
}: {
  analysis: MidiImportAnalysis
  onCancel: () => void
  onConfirm: (project: ComposerProject) => void
}) {
  const [title, setTitle] = useState(analysis.title)
  const [tempo, setTempo] = useState(analysis.tempo)
  const [key, setKey] = useState(analysis.key)
  const [sourceKind, setSourceKind] = useState(analysis.suggestedSourceKind)
  const [melodyTrackIndex, setMelodyTrackIndex] = useState(analysis.melodyTrackIndex)
  const [trackRoles, setTrackRoles] = useState(() => supportingRoles(analysis))
  const [sections, setSections] = useState(() => analysis.sections.map((section) => ({ ...section })))
  const [chordOverrides, setChordOverrides] = useState<Record<string, string>>({})
  const [selectedSectionIndex, setSelectedSectionIndex] = useState(0)
  const [playing, setPlaying] = useState(false)

  const duplicateSectionStarts = sections.some((section, index) =>
    sections.findIndex((candidate) => candidate.startBar === section.startBar) !== index,
  )
  const invalidChordCount = Object.values(chordOverrides).filter(
    (symbol) => symbol.trim() && !parseChordSymbol(symbol.trim()),
  ).length
  const basicInfoValid = title.trim().length > 0 && /^[A-G](?:#|b)?m?$/.test(key.trim()) && tempo >= 20 && tempo <= 300
  const canConfirm = basicInfoValid && !duplicateSectionStarts && invalidChordCount === 0

  const sortedSections = useMemo(
    () => [...sections].sort((left, right) => left.startBar - right.startBar),
    [sections],
  )
  const result = useMemo(
    () => createMidiProjectFromAnalysis(analysis, {
      melodyTrackIndex,
      trackRoles,
      sections: sortedSections,
      chordSymbolOverrides: chordOverrides,
      title,
      tempo,
      key,
      reviewConfirmed: true,
      sourceKind,
    }),
    [analysis, chordOverrides, key, melodyTrackIndex, sortedSections, sourceKind, tempo, title, trackRoles],
  )
  const previewSection = result.project.sections[selectedSectionIndex] ?? result.project.sections[0]
  const previewVariantId = previewSection
    ? result.project.sectionMelodyAssignments[previewSection.id]
    : undefined
  const previewVariant = result.project.melodyVariants.find((variant) => variant.id === previewVariantId)
  const previewChords = previewSection
    ? result.project.chords.filter((chord) => chord.sectionId === previewSection.id)
    : []

  useEffect(() => () => previewPlayer.stop(), [])
  useEffect(() => {
    if (selectedSectionIndex >= sortedSections.length) setSelectedSectionIndex(Math.max(0, sortedSections.length - 1))
  }, [selectedSectionIndex, sortedSections.length])

  const stop = () => {
    previewPlayer.stop()
    setPlaying(false)
  }
  const play = () => {
    if (!previewVariant && previewChords.length === 0) return
    setPlaying(true)
    previewPlayer.play({
      bpm: result.project.song.tempo,
      chords: previewChords,
      melody: previewVariant?.notes ?? [],
      mode: "chords-melody",
      onEnded: () => setPlaying(false),
    })
  }
  const updateSection = (id: string, patch: Partial<MidiImportSectionDraft>) => {
    setSections((current) => current.map((section) => section.id === id ? { ...section, ...patch } : section))
  }
  const addSection = () => {
    const occupied = new Set(sections.map((section) => section.startBar))
    let startBar = 2
    while (startBar <= analysis.totalBars && occupied.has(startBar)) startBar += 1
    if (startBar > analysis.totalBars) return
    setSections((current) => [...current, {
      id: crypto.randomUUID(),
      name: `Section ${current.length + 1}`,
      role: "instrumental",
      startBar,
    }])
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-2 sm:p-5" onClick={onCancel}>
      <div
        className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-hairline bg-surface-tile-1 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-4 py-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-body-on-dark">
              <Music2 size={17} className="text-primary" /> Logic／外部曲 MIDIインポート確認
            </h2>
            <p className="mt-1 truncate text-[11px] text-ink-muted-48">{analysis.fileName}</p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-full p-1 text-body-muted hover:bg-white/10" aria-label="閉じる">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-lg border border-hairline bg-surface-tile-2 p-3">
              <h3 className="text-[13px] font-semibold text-body-on-dark">1. 基本情報</h3>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <label className="col-span-2 flex flex-col gap-1 sm:col-span-3">
                  <span className="text-[10px] text-ink-muted-48">タイトル</span>
                  <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-ink-muted-48">Key</span>
                  <TextInput value={key} onChange={(event) => setKey(event.target.value)} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] text-ink-muted-48">Tempo</span>
                  <TextInput type="number" min={20} max={300} value={tempo} onChange={(event) => setTempo(Number(event.target.value))} />
                </label>
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] text-ink-muted-48">拍子 / 長さ</span>
                  <p className="rounded-sm border border-hairline px-2.5 py-1.5 text-[13px] text-body-on-dark">
                    {analysis.timeSignature} · {analysis.totalBars}小節
                  </p>
                </div>
                <label className="col-span-2 flex flex-col gap-1 sm:col-span-3">
                  <span className="text-[10px] text-ink-muted-48">読み込み目的</span>
                  <Select value={sourceKind} onChange={(event) => setSourceKind(event.target.value as typeof sourceKind)}>
                    <option value="logic-project">Logic Proから戻した制作中データ</option>
                    <option value="external-song">Composer Arranger外で作られた曲を解析</option>
                  </Select>
                </label>
              </div>
              {analysis.warnings.map((warning) => (
                <p key={warning} className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {warning}
                </p>
              ))}
            </section>

            <section className="rounded-lg border border-hairline bg-surface-tile-2 p-3">
              <h3 className="text-[13px] font-semibold text-body-on-dark">2. トラック役割</h3>
              <label className="mt-3 flex flex-col gap-1">
                <span className="text-[10px] text-ink-muted-48">主旋律トラック</span>
                <Select value={melodyTrackIndex} onChange={(event) => setMelodyTrackIndex(Number(event.target.value))}>
                  <option value={-1}>主旋律なし（伴奏・構成だけ解析）</option>
                  {analysis.tracks.filter((track) => track.averagePitch !== null).map((track) => (
                    <option key={track.index} value={track.index}>{track.name} ({track.noteCount} notes)</option>
                  ))}
                </Select>
              </label>
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1">
                {analysis.tracks.map((track) => (
                  <div key={track.index} className="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-2 rounded-sm bg-white/4 px-2 py-1.5">
                    <div className="min-w-0">
                      <p className="truncate text-[11px] text-body-on-dark">{track.name}</p>
                      <p className="text-[9px] text-ink-muted-48">{track.noteCount} notes · Ch {track.channelNumbers.join(", ") || "—"}</p>
                    </div>
                    {track.index === melodyTrackIndex ? (
                      <span className="rounded-sm bg-primary/20 px-2 py-1 text-center text-[10px] text-primary-on-dark">Melody</span>
                    ) : (
                      <Select
                        className="w-full !py-1 text-[11px]"
                        value={trackRoles[track.index]}
                        onChange={(event) => setTrackRoles((current) => ({
                          ...current,
                          [track.index]: event.target.value as Exclude<MidiImportTrackRole, "melody">,
                        }))}
                      >
                        {SUPPORT_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                      </Select>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-ink-muted-48">
                自動選択信頼度 {Math.round(analysis.melodyTrackConfidence * 100)}%。MelodyはActive Melodyへ変換し、読み込む全Roleの原ノートは解析素材として独立保存します。
              </p>
              <p className="mt-1 text-[10px] text-cyan-200">
                保存対象 {result.project.importedArrangement?.tracks.length ?? 0}トラック · {result.project.importedArrangement?.tracks.reduce((sum, track) => sum + track.notes.length, 0) ?? 0}ノート
              </p>
            </section>

            <section className="rounded-lg border border-hairline bg-surface-tile-2 p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-body-on-dark">3. Section境界とRole</h3>
                <Button variant="dark" className="!px-2 !py-1 text-[11px]" onClick={addSection} disabled={sections.length >= analysis.totalBars}>
                  <Plus size={11} /> 追加
                </Button>
              </div>
              <div className="mt-2 space-y-1.5">
                {sortedSections.map((section, index) => (
                  <div key={section.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)_7rem_2rem] items-end gap-1.5">
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] text-ink-muted-48">開始小節</span>
                      <TextInput
                        type="number"
                        min={1}
                        max={analysis.totalBars}
                        value={section.startBar}
                        disabled={section.startBar === 1}
                        onChange={(event) => updateSection(section.id, { startBar: Number(event.target.value) })}
                      />
                    </label>
                    <label className="flex min-w-0 flex-col gap-1">
                      <span className="text-[9px] text-ink-muted-48">名前 ({sectionLengthAt(sortedSections, index, analysis.totalBars)}小節)</span>
                      <TextInput value={section.name} onChange={(event) => updateSection(section.id, { name: event.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[9px] text-ink-muted-48">Role</span>
                      <Select className="w-full" value={section.role} onChange={(event) => updateSection(section.id, { role: event.target.value as SectionRole })}>
                        {SECTION_ROLES.map((role) => <option key={role} value={role}>{SECTION_ROLE_LABELS[role]}</option>)}
                      </Select>
                    </label>
                    <button
                      type="button"
                      className="mb-0.5 rounded-full p-1 text-ink-muted-48 hover:bg-white/10 hover:text-red-300 disabled:opacity-30"
                      disabled={sections.length <= 1 || section.startBar === 1}
                      onClick={() => setSections((current) => current.filter((candidate) => candidate.id !== section.id))}
                      aria-label={`${section.name}を削除`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10px] text-ink-muted-48">
                {analysis.sectionsFromMarkers ? "MIDIマーカーを初期値に使用しています。" : "マーカーがないため、必要に応じて開始小節を追加してください。"}
              </p>
              {duplicateSectionStarts && <p className="mt-1 text-[10px] text-red-300">同じ開始小節を複数のSectionへ設定できません。</p>}
            </section>

            <section className="rounded-lg border border-hairline bg-surface-tile-2 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold text-body-on-dark">4. コード確認・試聴</h3>
                <div className="flex items-center gap-1.5">
                  <Select className="max-w-40 !py-1" value={selectedSectionIndex} onChange={(event) => { stop(); setSelectedSectionIndex(Number(event.target.value)) }}>
                    {result.project.sections.map((section, index) => <option key={section.id} value={index}>{section.name}</option>)}
                  </Select>
                  <button
                    type="button"
                    onClick={playing ? stop : play}
                    disabled={!previewVariant && previewChords.length === 0}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary text-on-primary disabled:opacity-30"
                    aria-label={playing ? "停止" : "試聴"}
                  >
                    {playing ? <Square size={13} /> : <Play size={13} />}
                  </button>
                </div>
              </div>
              <div className="mt-2 grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3">
                {previewChords.map((chord) => {
                  const overrideKey = midiChordOverrideKey(previewSection.startBar, chord.startBeat)
                  return (
                    <label key={`${chord.startBeat}:${chord.durationBeats}`} className="flex items-center gap-1 rounded-sm bg-white/4 px-2 py-1">
                      <span className="shrink-0 text-[9px] text-ink-muted-48">{Number((chord.startBeat + 1).toFixed(2))}拍</span>
                      <TextInput
                        className="min-w-0 flex-1 !py-1"
                        value={chordOverrides[overrideKey] ?? chord.symbol}
                        onChange={(event) => setChordOverrides((current) => ({ ...current, [overrideKey]: event.target.value }))}
                      />
                    </label>
                  )
                })}
              </div>
              <p className="mt-2 text-[10px] text-ink-muted-48">
                コード推定 {Math.round(result.report.chordInferenceConfidence * 100)}%。修正値は確定プロジェクトとAI Partnerへ渡されます。
              </p>
              {invalidChordCount > 0 && <p className="mt-1 text-[10px] text-red-300">解釈できないコードが{invalidChordCount}件あります。</p>}
            </section>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-3">
          <p className="flex items-center gap-1.5 text-[10px] text-body-muted">
            <Check size={12} className="text-emerald-400" /> 外部曲でも全パートを保持し、確定後にAI Partner／Arrangementで解析できます
          </p>
          <div className="ml-auto flex gap-2">
            <Button variant="dark" onClick={onCancel}>キャンセル</Button>
            <Button variant="primary" disabled={!canConfirm} onClick={() => { stop(); onConfirm(result.project) }}>この内容でプロジェクト作成</Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
