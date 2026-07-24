import { clsx } from "clsx"
import { useProjectStore } from "@/store/useProjectStore"
import { SONG_PROFILE_LABELS, type SongProfileId } from "@/core/project"
import type { MelodyGeneratorProfile } from "@/core/melody"
import { noteName, parseNoteName } from "@/core/note"
import { Select, FieldGroup, SectionCard, IconButton, Button, TextInput, Label } from "@/ui/primitives"
import type { Density, Drama } from "@/melody-engine/generationParams"
import { GENERATOR_PROFILES, GENERATOR_PROFILE_LABELS, GENERATOR_PROFILE_DESCRIPTIONS } from "@/melody-engine/generatorProfile"
import { GENERATION_SETTING_LABELS, profilesIgnoring, type GenerationSettingKey } from "@/melody-engine/settingsApplicability"
import type { RangePreset } from "@/store/useProjectStore"
import { useActiveVariant } from "./useActiveVariant"
import { X, Dna, AlertCircle } from "lucide-react"

const PROFILE_OPTIONS = Object.keys(SONG_PROFILE_LABELS) as SongProfileId[]

const ADVANCED_FEATURE_LABELS: [key: string, label: string][] = [
  ["stepwiseMotionRatio", "順次進行率"],
  ["appoggiaturaRatio", "倚音率"],
  ["delayedResolutionRatio", "遅延解決率"],
  ["climaxUniqueness", "クライマックスの希少性"],
  ["phraseArcLength", "旋律弧の長さ"],
  ["pickupRatio", "弱起率"],
  ["phraseAsymmetry", "フレーズ非対称性"],
  ["speechContourAmount", "発話的輪郭度"],
  ["finalMelodicLift", "終端の旋律的上昇"],
  ["motifMutationRatio", "モチーフ変異率"],
  ["cyclicPhraseAmount", "循環度"],
  ["mutationPeriodicity", "変異周期性"],
  ["contourRetention", "輪郭保持度"],
]

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

/** ある設定が、選択中のProfileのうち一部で効かない場合に注意書きを出す */
function IgnoredNote({ setting, selected }: { setting: GenerationSettingKey; selected: MelodyGeneratorProfile[] }) {
  const ignoring = profilesIgnoring(setting, selected)
  if (ignoring.length === 0) return null
  return (
    <p className="flex items-start gap-1 text-[10px] text-amber-400/90">
      <AlertCircle size={11} className="mt-0.5 shrink-0" />
      <span>{ignoring.map((p) => GENERATOR_PROFILE_LABELS[p]).join("・")} では{GENERATION_SETTING_LABELS[setting]}は生成へ反映されません</span>
    </p>
  )
}

export function RightPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useProjectStore((s) => s.project)
  const selectedSectionId = useProjectStore((s) => s.selectedSectionId)
  const updateSongField = useProjectStore((s) => s.updateSongField)
  const setSectionProfileOverride = useProjectStore((s) => s.setSectionProfileOverride)
  const generationSettings = useProjectStore((s) => s.generationSettings)
  const setGenerationSettings = useProjectStore((s) => s.setGenerationSettings)
  const toggleGeneratorProfile = useProjectStore((s) => s.toggleGeneratorProfile)
  const extractMotifDNAFromVariant = useProjectStore((s) => s.extractMotifDNAFromVariant)
  const variant = useActiveVariant()

  const override = project.song.sectionProfileOverrides.find((o) => o.sectionId === selectedSectionId)
  const selected = generationSettings.selectedGeneratorProfiles
  const custom = generationSettings.customRange

  const setCustomBound = (which: "low" | "high", raw: string) => {
    const midi = parseNoteName(raw)
    if (midi === null || midi < 0 || midi > 127) return
    const next = { ...custom, [which]: midi }
    // High<Lowの逆転を防ぐ。逆転する入力は無視して現状維持する
    if (next.low >= next.high) return
    setGenerationSettings({ customRange: next })
  }

  return (
    <aside
      className={clsx(
        "z-40 flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-l border-hairline bg-surface-tile-3 p-3 transition-transform duration-200",
        "absolute inset-y-0 right-0 lg:static lg:translate-x-0",
        open ? "translate-x-0" : "translate-x-full",
      )}
    >
      <IconButton onClick={onClose} className="self-start lg:hidden" title="閉じる">
        <X size={16} />
      </IconButton>

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

      <SectionCard title="Generator Profile">
        <p className="mb-2 text-[11px] text-ink-muted-48">
          選択したProfile × 3 Pattern = {generationSettings.selectedGeneratorProfiles.length * 3}候補を生成します
        </p>
        <div className="flex flex-col gap-1.5">
          {GENERATOR_PROFILES.map((p) => {
            const checked = generationSettings.selectedGeneratorProfiles.includes(p)
            return (
              <label
                key={p}
                className={clsx(
                  "flex cursor-pointer items-start gap-2 rounded-sm border px-2 py-1.5 text-[12px]",
                  checked ? "border-primary-focus bg-primary/10" : "border-transparent bg-white/5 hover:bg-white/10",
                )}
              >
                <input type="checkbox" className="mt-0.5 accent-primary" checked={checked} onChange={() => toggleGeneratorProfile(p)} />
                <span className="flex flex-col">
                  <span className="font-medium text-body-on-dark">{GENERATOR_PROFILE_LABELS[p]}</span>
                  <span className="text-ink-muted-48">{GENERATOR_PROFILE_DESCRIPTIONS[p]}</span>
                </span>
              </label>
            )
          })}
        </div>
        <div className="mt-2">
          <IgnoredNote setting="key" selected={selected} />
        </div>
      </SectionCard>

      <SectionCard title="生成パラメータ">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <FieldGroup label="Density">
              <Select value={generationSettings.density} onChange={(e) => setGenerationSettings({ density: e.target.value as Density })}>
                <option value="sparse">Sparse</option>
                <option value="balanced">Balanced</option>
                <option value="active">Active</option>
              </Select>
            </FieldGroup>
            <IgnoredNote setting="density" selected={selected} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldGroup label="Range">
              <Select
                value={generationSettings.rangePreset}
                onChange={(e) => setGenerationSettings({ rangePreset: e.target.value as RangePreset })}
              >
                <option value="low">Low (G3–C5)</option>
                <option value="middle">Middle (C4–F5)</option>
                <option value="high">High (E4–A5)</option>
                <option value="custom">Custom</option>
              </Select>
            </FieldGroup>
            {generationSettings.rangePreset === "custom" && (
              <div className="mt-1 flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <Label>最低音</Label>
                  <TextInput
                    key={`low-${custom.low}`}
                    defaultValue={noteName(custom.low)}
                    onBlur={(e) => setCustomBound("low", e.target.value)}
                    placeholder="C4"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <Label>最高音</Label>
                  <TextInput
                    key={`high-${custom.high}`}
                    defaultValue={noteName(custom.high)}
                    onBlur={(e) => setCustomBound("high", e.target.value)}
                    placeholder="F5"
                  />
                </div>
              </div>
            )}
            {generationSettings.rangePreset === "custom" && (
              <p className="text-[10px] text-ink-muted-48">
                音名(例: C4, F#5, Bb3)で入力。最高音が最低音以下になる入力・音域外は無視されます。
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <FieldGroup label="Drama">
              <Select value={generationSettings.drama} onChange={(e) => setGenerationSettings({ drama: e.target.value as Drama })}>
                <option value="restrained">Restrained</option>
                <option value="growing">Growing</option>
                <option value="open">Open</option>
              </Select>
            </FieldGroup>
            <IgnoredNote setting="drama" selected={selected} />
          </div>
          <p className="mt-1 border-t border-hairline pt-2 text-[10px] text-ink-muted-48">
            生成設定(Density / Range / Drama / Generator Profile)はこのセッション限りで、プロジェクトには保存されません。Key・拍子・Song Profileはプロジェクトに保存されます。
          </p>
        </div>
      </SectionCard>

      <SectionCard title="特徴量">
        {variant?.generatorProfile && (
          <p className="mb-2 text-[12px] text-primary-on-dark">
            {GENERATOR_PROFILE_LABELS[variant.generatorProfile as MelodyGeneratorProfile]}
            {variant.patternIndex && ` · Pattern ${variant.patternIndex}`}
          </p>
        )}
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
        {variant?.advancedMetrics && Object.keys(variant.advancedMetrics).length > 0 && (
          <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 border-t border-hairline pt-3 text-[12px]">
            {ADVANCED_FEATURE_LABELS.filter(([key]) => (variant.advancedMetrics as Record<string, number>)[key] !== undefined).map(
              ([key, label]) => (
                <div key={key} className="flex flex-col">
                  <dt className="text-ink-muted-48">{label}</dt>
                  <dd className="text-body-on-dark">{`${Math.round((variant.advancedMetrics as Record<string, number>)[key] * 100)}%`}</dd>
                </div>
              ),
            )}
          </dl>
        )}
        {variant && (
          <Button variant="dark" className="mt-3 w-full justify-center" onClick={() => extractMotifDNAFromVariant(variant.id)}>
            <Dna size={13} /> このメロディからMotif DNAを抽出
          </Button>
        )}
        {project.songMotifDNA && <p className="mt-2 text-[11px] text-ink-muted-48">Song Motif DNA保存済み(他セクション生成へ軽く反映されます)</p>}
      </SectionCard>
    </aside>
  )
}
