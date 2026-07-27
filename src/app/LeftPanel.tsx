import { useRef, useState } from "react"
import { clsx } from "clsx"
import { useProjectStore } from "@/store/useProjectStore"
import { SECTION_ROLE_LABELS, type SectionRole } from "@/core/section"
import { chordEventsToText } from "@/core/chordInput"
import { parseTimeSignature } from "@/core/section"
import { diagnoseChordInput, type ChordDiagnosis } from "@/core/chordDiagnostics"
import { CONTENT_PRESETS, DEFAULT_SECTION_CONTENT, presetById, presetIdFor } from "@/core/sectionContent"
import { prepareImportedProject } from "@/core/composerSongExchange"
import { downloadProjectFile, readProjectFile } from "@/storage/projectFile"
import { ProjectBrowser } from "./ProjectBrowser"
import { Button, FieldGroup, Select, TextInput, SectionCard, IconButton } from "@/ui/primitives"
import {
  Plus,
  Copy,
  Trash2,
  Download,
  Upload,
  FilePlus2,
  Repeat,
  X,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MoveRight,
  FolderOpen,
  GripVertical,
} from "lucide-react"

const ROLE_OPTIONS = Object.keys(SECTION_ROLE_LABELS) as SectionRole[]

/** Issue #41: 各プリセットが音楽的に何を意味するかの短い説明 */
const CONTENT_PRESET_HINTS: Record<string, string> = {
  auto: "Role・Song Profile・コード進行から、妥当な入口を候補ごとに選びます",
  melody: "通常の歌唱メロディを生成します",
  motif: "2〜5音の短い象徴的モチーフを、余白を挟んで提示します",
  ostinato: "短い音型を周期的に反復します(伴奏パートとして書き出し)",
  drone: "1〜2音を長く保持します(コード境界をまたいで保持・伴奏パート)",
  "chords-only": "リードを鳴らさず、コード伴奏だけで始めます",
  silence: "リードも伴奏も鳴らしません(弱起のみ作ることもできます)",
  "": "リードと伴奏の組み合わせがプリセットに一致しません",
}

/** Issue #12: 1コードの診断行 */
function ChordDiagnosisRow({ d }: { d: ChordDiagnosis }) {
  const icon =
    d.status === "error" ? (
      <XCircle size={12} className="mt-0.5 shrink-0 text-red-400" />
    ) : d.status === "warning" ? (
      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" />
    ) : (
      <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-400" />
    )
  const preview =
    d.status !== "error" && d.rootName
      ? [
          d.bassName ? `${d.rootName}/${d.bassName}` : d.rootName,
          d.toneNames?.length ? `構成音 ${d.toneNames.join(" ")}` : null,
          d.tensionNames?.length ? `テンション ${d.tensionNames.join(" ")}` : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : null
  return (
    <li className="flex items-start gap-1.5 py-0.5">
      {icon}
      <span className="flex flex-col">
        <span className="text-[11px] text-body-on-dark">
          <span className="font-medium">{d.symbol || "(空)"}</span>
          {d.status !== "ok" && d.reason && <span className={clsx("ml-1", d.status === "error" ? "text-red-400" : "text-amber-400")}>— {d.reason}</span>}
        </span>
        {preview && <span className="text-[10px] text-ink-muted-48">{preview}</span>}
      </span>
    </li>
  )
}

export function LeftPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useProjectStore((s) => s.project)
  const selectedSectionId = useProjectStore((s) => s.selectedSectionId)
  const selectSection = useProjectStore((s) => s.selectSection)
  const addSection = useProjectStore((s) => s.addSection)
  const updateSection = useProjectStore((s) => s.updateSection)
  const removeSection = useProjectStore((s) => s.removeSection)
  const duplicateSection = useProjectStore((s) => s.duplicateSection)
  const moveSection = useProjectStore((s) => s.moveSection)
  const [draggedSectionId, setDraggedSectionId] = useState<string | null>(null)
  const setChordText = useProjectStore((s) => s.setChordText)
  const repeatSectionChords = useProjectStore((s) => s.repeatSectionChords)
  const extendLastChordToFill = useProjectStore((s) => s.extendLastChordToFill)
  const setSectionContent = useProjectStore((s) => s.setSectionContent)
  const setSectionAccompanimentPattern = useProjectStore((s) => s.setSectionAccompanimentPattern)
  const newProject = useProjectStore((s) => s.newProject)
  const loadProject = useProjectStore((s) => s.loadProject)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [browserOpen, setBrowserOpen] = useState(false)
  const section = project.sections.find((s) => s.id === selectedSectionId)
  const ts = parseTimeSignature(project.song.timeSignature)
  const sectionContent = section?.content ?? DEFAULT_SECTION_CONTENT
  const entryOffsetBars = Math.round((sectionContent.entryOffsetBeats / ts.beatsPerBar) * 100) / 100
  const sectionChords = section ? project.chords.filter((c) => c.sectionId === section.id) : []
  const chordText = section ? chordEventsToText([...sectionChords].sort((a, b) => a.startBeat - b.startBeat), ts.beatsPerBar) : ""
  const coveredBars = sectionChords.length
    ? Math.max(...sectionChords.map((c) => c.startBeat + c.durationBeats)) / ts.beatsPerBar
    : 0
  const sectionBeats = section ? section.lengthBars * ts.beatsPerBar : 0
  const diagnostics = section && sectionChords.length > 0 ? diagnoseChordInput(sectionChords, sectionBeats) : null

  return (
    <aside
      className={clsx(
        "z-40 flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-hairline bg-surface-tile-3 p-3 transition-transform duration-200",
        "absolute inset-y-0 left-0 lg:static lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <IconButton onClick={onClose} className="self-end lg:hidden" title="閉じる">
        <X size={16} />
      </IconButton>

      <SectionCard title="Composer Project">
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="dark"
            onClick={() => {
              // 現在のプロジェクトは自動保存済み(プロジェクトブラウザーから再度開ける)。念のため確認する
              if (window.confirm("新規プロジェクトを作成します。現在のプロジェクトは自動保存済みで、「開く」から再度開けます。よろしいですか?")) {
                newProject()
              }
            }}
          >
            <FilePlus2 size={13} /> New
          </Button>
          <Button variant="dark" onClick={() => setBrowserOpen(true)}>
            <FolderOpen size={13} /> 開く
          </Button>
          <Button variant="dark" onClick={() => downloadProjectFile(project)}>
            <Download size={13} /> Export
          </Button>
          <Button variant="dark" onClick={() => fileInputRef.current?.click()}>
            <Upload size={13} /> Import
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              try {
                const raw = await readProjectFile(file)
                loadProject(prepareImportedProject(raw))
              } catch (error) {
                window.alert(error instanceof Error ? error.message : "JSONの読み込みに失敗しました")
              } finally {
                e.target.value = ""
              }
            }}
          />
        </div>
      </SectionCard>

      <SectionCard title="セクション">
        <div className="flex flex-col gap-1.5">
          {project.sections.map((s, index) => (
            <div
              key={s.id}
              draggable
              onDragStart={() => setDraggedSectionId(s.id)}
              onDragEnd={() => setDraggedSectionId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (draggedSectionId && draggedSectionId !== s.id) moveSection(draggedSectionId, index)
                setDraggedSectionId(null)
              }}
              onClick={() => selectSection(s.id)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-sm border px-2 py-1.5 text-[13px] ${
                s.id === selectedSectionId ? "border-primary-focus bg-primary/15" : "border-transparent bg-white/5 hover:bg-white/10"
              } ${draggedSectionId === s.id ? "opacity-40" : ""}`}
            >
              <GripVertical size={13} className="shrink-0 cursor-grab text-ink-muted-48" />
              <span className="flex-1 truncate">{s.name}</span>
              <span className="text-[11px] text-ink-muted-48">{SECTION_ROLE_LABELS[s.role]}</span>
              <IconButton
                onClick={(e) => {
                  e.stopPropagation()
                  duplicateSection(s.id)
                }}
                title="複製"
              >
                <Copy size={13} />
              </IconButton>
              <IconButton
                onClick={(e) => {
                  e.stopPropagation()
                  removeSection(s.id)
                }}
                title="削除"
              >
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))}
        </div>
        <Button
          variant="dark"
          className="mt-2 w-full justify-center"
          onClick={() => addSection(`Section ${project.sections.length + 1}`, "verse", 8)}
        >
          <Plus size={13} /> セクション追加
        </Button>
      </SectionCard>

      {section && (
        <SectionCard title="セクション設定">
          <div className="flex flex-col gap-2.5">
            <FieldGroup label="名前">
              <TextInput
                defaultValue={section.name}
                key={`name-${section.id}`}
                onBlur={(e) => updateSection(section.id, { name: e.currentTarget.value })}
              />
            </FieldGroup>
            <FieldGroup label="Role">
              <Select value={section.role} onChange={(e) => updateSection(section.id, { role: e.target.value as SectionRole })}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {SECTION_ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
            </FieldGroup>
            <FieldGroup label="小節数">
              <TextInput
                type="number"
                min={1}
                defaultValue={section.lengthBars}
                key={`len-${section.id}-${section.lengthBars}`}
                onBlur={(e) => updateSection(section.id, { lengthBars: Math.max(1, Number(e.currentTarget.value) || 1) })}
              />
            </FieldGroup>

            {/* Issue #41: 何を鳴らすかはRoleとは独立した軸。UIは7プリセットで提示し、内部は2軸で保持する */}
            <FieldGroup label="Content(このセクションで鳴らす内容)">
              <Select
                value={presetIdFor(sectionContent) ?? ""}
                onChange={(e) => {
                  const preset = presetById(e.target.value)
                  if (preset) setSectionContent(section.id, { lead: preset.lead, accompaniment: preset.accompaniment })
                }}
              >
                {presetIdFor(sectionContent) === null && <option value="">(カスタム)</option>}
                {CONTENT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[10px] text-ink-muted-48">{CONTENT_PRESET_HINTS[presetIdFor(sectionContent) ?? ""]}</p>
            </FieldGroup>

            <FieldGroup label="Accompaniment Pattern">
              <Select
                value={project.sectionAccompanimentPatternAssignments[section.id] ?? ""}
                onChange={(e) => setSectionAccompanimentPattern(section.id, e.target.value || null)}
              >
                <option value="">None</option>
                {project.accompanimentPatterns.map((pattern) => (
                  <option key={pattern.id} value={pattern.id}>
                    {pattern.name}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-[10px] text-ink-muted-48">
                度数＋リズムのテンプレートを現在のコードへ自動変換し、専用MIDIトラックへ出力します
              </p>
            </FieldGroup>

            <FieldGroup label={`リード開始位置(先頭から${entryOffsetBars}小節を無音にする)`}>
              <TextInput
                type="number"
                min={0}
                max={section.lengthBars}
                step={0.25}
                defaultValue={entryOffsetBars}
                key={`entry-${section.id}-${sectionContent.entryOffsetBeats}`}
                onBlur={(e) => {
                  const bars = Math.max(0, Number(e.currentTarget.value) || 0)
                  setSectionContent(section.id, { entryOffsetBeats: bars * ts.beatsPerBar })
                }}
              />
              <label className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-muted-48">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={sectionContent.pickup}
                  onChange={(e) => setSectionContent(section.id, { pickup: e.target.checked })}
                />
                次セクション直前に弱起(Pickup)を作る
              </label>
            </FieldGroup>
            <FieldGroup label='コード進行 ("|" "-" "–" いずれかの区切り。例: "F#m(add9) | E | D | Dsus2")'>
              <textarea
                defaultValue={chordText}
                // 件数(sectionChords.length)だけをkeyにすると、延長のように件数を変えず
                // durationBeatsだけを書き換える更新でremountされず、非制御textareaが古い表示の
                // ままになってしまう(その後blurすると古い値でstoreを上書きしてしまう=延長が
                // 元に戻る)。実際に表示すべきテキスト(chordText)自体をkeyにして確実に同期する。
                key={`chords-${section.id}-${chordText}`}
                onBlur={(e) => setChordText(section.id, e.currentTarget.value)}
                rows={4}
                className="rounded-sm border border-hairline bg-surface-tile-2 px-2.5 py-1.5 text-[13px] text-body-on-dark outline-none focus:border-primary-focus"
              />
              <Button
                variant="dark"
                className="mt-1.5 w-full justify-center"
                disabled={coveredBars === 0}
                onClick={() => repeatSectionChords(section.id)}
              >
                <Repeat size={13} />
                {coveredBars > 0 ? `繰り返して2倍(${coveredBars}→${coveredBars * 2}小節)` : "繰り返して2倍"}
              </Button>

              {diagnostics && (
                <div className="mt-2 rounded-sm border border-hairline bg-surface-tile-2 p-2">
                  {/* セクション充足状況 */}
                  {diagnostics.coverage.status === "under" && (
                    <div className="mb-1.5 flex flex-col gap-1 text-[11px] text-amber-400">
                      <span className="flex items-center gap-1">
                        <AlertTriangle size={12} /> セクション({section.lengthBars}小節)に対しコードが{Math.round((diagnostics.coverage.gapBeats / ts.beatsPerBar) * 100) / 100}小節分不足しています
                      </span>
                      <Button variant="dark" className="w-full justify-center" onClick={() => extendLastChordToFill(section.id)}>
                        <MoveRight size={12} /> 最後のコードを延長して埋める
                      </Button>
                    </div>
                  )}
                  {diagnostics.coverage.status === "over" && (
                    <p className="mb-1.5 flex items-center gap-1 text-[11px] text-amber-400">
                      <AlertTriangle size={12} /> セクション終端を{Math.round((diagnostics.coverage.overflowBeats / ts.beatsPerBar) * 100) / 100}小節分超過しています(超過部分は生成で切り詰められます)
                    </p>
                  )}
                  {diagnostics.coverage.overlaps.length > 0 && (
                    <p className="mb-1.5 flex items-center gap-1 text-[11px] text-amber-400">
                      <AlertTriangle size={12} /> コード区間が重複しています
                    </p>
                  )}
                  {diagnostics.hasError && (
                    <p className="mb-1.5 flex items-center gap-1 text-[11px] text-red-400">
                      <XCircle size={12} /> 無効なコードがあります。修正しないと C major として生成されます
                    </p>
                  )}
                  {/* コード単位の解析結果 */}
                  <ul className="flex flex-col">
                    {diagnostics.chords.map((d) => (
                      <ChordDiagnosisRow key={d.index} d={d} />
                    ))}
                  </ul>
                </div>
              )}
            </FieldGroup>
          </div>
        </SectionCard>
      )}

      {browserOpen && <ProjectBrowser onClose={() => setBrowserOpen(false)} />}
    </aside>
  )
}
