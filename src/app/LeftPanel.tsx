import { useRef } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { SECTION_ROLE_LABELS, type SectionRole } from "@/core/section"
import { chordEventsToText } from "@/core/chordInput"
import { parseTimeSignature } from "@/core/section"
import { downloadProjectFile, readProjectFile } from "@/storage/projectFile"
import { Button, FieldGroup, Select, TextInput, SectionCard, IconButton } from "@/ui/primitives"
import { Plus, Copy, Trash2, Download, Upload, FilePlus2 } from "lucide-react"

const ROLE_OPTIONS = Object.keys(SECTION_ROLE_LABELS) as SectionRole[]

export function LeftPanel() {
  const project = useProjectStore((s) => s.project)
  const selectedSectionId = useProjectStore((s) => s.selectedSectionId)
  const selectSection = useProjectStore((s) => s.selectSection)
  const addSection = useProjectStore((s) => s.addSection)
  const updateSection = useProjectStore((s) => s.updateSection)
  const removeSection = useProjectStore((s) => s.removeSection)
  const duplicateSection = useProjectStore((s) => s.duplicateSection)
  const setChordText = useProjectStore((s) => s.setChordText)
  const newProject = useProjectStore((s) => s.newProject)
  const loadProject = useProjectStore((s) => s.loadProject)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const section = project.sections.find((s) => s.id === selectedSectionId)
  const ts = parseTimeSignature(project.song.timeSignature)
  const chordText = section ? chordEventsToText(project.chords.filter((c) => c.sectionId === section.id).sort((a, b) => a.startBeat - b.startBeat), ts.beatsPerBar) : ""

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-hairline bg-surface-tile-3 p-3">
      <SectionCard title="Composer Project">
        <div className="flex flex-wrap gap-1.5">
          <Button variant="dark" onClick={() => newProject()}>
            <FilePlus2 size={13} /> New
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
              const p = await readProjectFile(file)
              loadProject(p)
              e.target.value = ""
            }}
          />
        </div>
      </SectionCard>

      <SectionCard title="セクション">
        <div className="flex flex-col gap-1.5">
          {project.sections.map((s) => (
            <div
              key={s.id}
              onClick={() => selectSection(s.id)}
              className={`flex cursor-pointer items-center gap-2 rounded-sm border px-2 py-1.5 text-[13px] ${
                s.id === selectedSectionId ? "border-primary-focus bg-primary/15" : "border-transparent bg-white/5 hover:bg-white/10"
              }`}
            >
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
                key={`len-${section.id}`}
                onBlur={(e) => updateSection(section.id, { lengthBars: Math.max(1, Number(e.currentTarget.value) || 1) })}
              />
            </FieldGroup>
            <FieldGroup label='コード進行 ("|" "-" "–" いずれかの区切り。例: "F#m(add9) | E | D | Dsus2")'>
              <textarea
                defaultValue={chordText}
                key={`chords-${section.id}`}
                onBlur={(e) => setChordText(section.id, e.currentTarget.value)}
                rows={4}
                className="rounded-sm border border-hairline bg-surface-tile-2 px-2.5 py-1.5 text-[13px] text-body-on-dark outline-none focus:border-primary-focus"
              />
            </FieldGroup>
          </div>
        </SectionCard>
      )}
    </aside>
  )
}
