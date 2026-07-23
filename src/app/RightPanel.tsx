import { useProjectStore } from "@/store/useProjectStore"
import { SONG_PROFILE_LABELS, type SongProfileId } from "@/core/project"
import { Select, FieldGroup, SectionCard } from "@/ui/primitives"
import type { Density, Drama } from "@/melody-engine/generationParams"
import type { RangePreset } from "@/store/useProjectStore"
import { useActiveVariant } from "./useActiveVariant"

const PROFILE_OPTIONS = Object.keys(SONG_PROFILE_LABELS) as SongProfileId[]

const FEATURE_LABELS: [key: string, label: string, fmt: (v: number) => string][] = [
  ["rangeLow", "音域(下)", (v) => String(Math.round(v))],
  ["rangeHigh", "音域(上)", (v) => String(Math.round(v))],
  ["maxLeap", "最大跳躍", (v) => `${Math.round(v)}半音`],
  ["avgLeap", "平均跳躍", (v) => v.toFixed(1)],
  ["restRatio", "休符率", (v) => `${Math.round(v * 100)}%`],
  ["repeatedNoteRatio", "同音反復率", (v) => `${Math.round(v * 100)}%`],
  ["tensionUsageRatio", "テンション使用率", (v) => `${Math.round(v * 100)}%`],
  ["chordToneUsageRatio", "コードトーン使用率", (v) => `${Math.round(v * 100)}%`],
  ["syncopationRatio", "シンコペーション率", (v) => `${Math.round(v * 100)}%`],
  ["motifRepeatRatio", "モチーフ反復率", (v) => `${Math.round(v * 100)}%`],
  ["peakPosition", "最高音の位置", (v) => `${Math.round(v * 100)}%`],
]

export function RightPanel() {
  const project = useProjectStore((s) => s.project)
  const selectedSectionId = useProjectStore((s) => s.selectedSectionId)
  const updateSongField = useProjectStore((s) => s.updateSongField)
  const setSectionProfileOverride = useProjectStore((s) => s.setSectionProfileOverride)
  const generationSettings = useProjectStore((s) => s.generationSettings)
  const setGenerationSettings = useProjectStore((s) => s.setGenerationSettings)
  const variant = useActiveVariant()

  const override = project.song.sectionProfileOverrides.find((o) => o.sectionId === selectedSectionId)

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-hairline bg-surface-tile-3 p-3">
      <SectionCard title="Song Profile">
        <div className="flex flex-col gap-2.5">
          <FieldGroup label="曲全体のProfile">
            <Select value={project.song.songProfile} onChange={(e) => updateSongField("songProfile", e.target.value as SongProfileId)}>
              {PROFILE_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {SONG_PROFILE_LABELS[p]}
                </option>
              ))}
            </Select>
          </FieldGroup>
          {selectedSectionId && (
            <FieldGroup label="このセクションだけ上書き">
              <Select
                value={override?.songProfile ?? ""}
                onChange={(e) => setSectionProfileOverride(selectedSectionId, (e.target.value || null) as SongProfileId | null)}
              >
                <option value="">(上書きなし)</option>
                {PROFILE_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {SONG_PROFILE_LABELS[p]}
                  </option>
                ))}
              </Select>
            </FieldGroup>
          )}
        </div>
      </SectionCard>

      <SectionCard title="生成パラメータ">
        <div className="flex flex-col gap-2.5">
          <FieldGroup label="Density">
            <Select value={generationSettings.density} onChange={(e) => setGenerationSettings({ density: e.target.value as Density })}>
              <option value="sparse">Sparse</option>
              <option value="balanced">Balanced</option>
              <option value="active">Active</option>
            </Select>
          </FieldGroup>
          <FieldGroup label="Range">
            <Select
              value={generationSettings.rangePreset}
              onChange={(e) => setGenerationSettings({ rangePreset: e.target.value as RangePreset })}
            >
              <option value="low">Low</option>
              <option value="middle">Middle</option>
              <option value="high">High</option>
              <option value="custom">Custom</option>
            </Select>
          </FieldGroup>
          <FieldGroup label="Drama">
            <Select value={generationSettings.drama} onChange={(e) => setGenerationSettings({ drama: e.target.value as Drama })}>
              <option value="restrained">Restrained</option>
              <option value="growing">Growing</option>
              <option value="open">Open</option>
            </Select>
          </FieldGroup>
        </div>
      </SectionCard>

      <SectionCard title="特徴量">
        {variant?.features ? (
          <dl className="grid grid-cols-2 gap-x-2 gap-y-2 text-[12px]">
            {FEATURE_LABELS.map(([key, label, fmt]) => (
              <div key={key} className="flex flex-col">
                <dt className="text-ink-muted-48">{label}</dt>
                <dd className="text-body-on-dark">{fmt((variant.features as never)[key])}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-[12px] text-ink-muted-48">候補を生成すると表示されます</p>
        )}
      </SectionCard>
    </aside>
  )
}
