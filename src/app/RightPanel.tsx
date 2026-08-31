import { clsx } from "clsx"
import { useProjectStore } from "@/store/useProjectStore"
import { SONG_PROFILE_LABELS, type SongProfileId } from "@/core/project"
import type { MelodyGeneratorProfile } from "@/core/melody"
import { parseTimeSignature, SECTION_ROLE_LABELS } from "@/core/section"
import { noteName, parseNoteName } from "@/core/note"
import { Select, FieldGroup, SectionCard, IconButton, Button, TextInput, Label } from "@/ui/primitives"
import type { Density, Drama } from "@/melody-engine/generationParams"
import { GENERATOR_PROFILES, GENERATOR_PROFILE_LABELS, GENERATOR_PROFILE_DESCRIPTIONS } from "@/melody-engine/generatorProfile"
import {
  OPENING_ENTRY_LABELS,
  OPENING_EMOTION_LABELS,
  OPENING_REGISTER_LABELS,
  OPENING_DIRECTION_LABELS,
} from "@/melody-engine/openingIntent"
import { GENERATION_SETTING_LABELS, profilesIgnoring, type GenerationSettingKey } from "@/melody-engine/settingsApplicability"
import type { RangePreset } from "@/store/useProjectStore"
import { useActiveVariant } from "./useActiveVariant"
import { X, Dna, AlertCircle, Play } from "lucide-react"
import {
  TECHNIQUE_EXPERIMENT_PRESETS,
  type TechniqueExperimentPresetId,
} from "@/composer-intelligence"
import { explainMelodyCandidate } from "@/melody-engine/melodyEvidence"
import { previewPlayer } from "@/audio/previewPlayer"

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
    <p className="flex items-start gap-1 text-[11px] text-amber-400/90">
      <AlertCircle size={11} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{ignoring.map((p) => GENERATOR_PROFILE_LABELS[p]).join("・")} では{GENERATION_SETTING_LABELS[setting]}は生成へ反映されません</span>
    </p>
  )
}

export function RightPanel({
  open,
  onClose,
  mode = "melody",
}: {
  open: boolean
  onClose: () => void
  mode?: "melody" | "phrase" | "signature" | "counter" | "decoration"
}) {
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
  const selectedSection = project.sections.find(
    (section) => section.id === selectedSectionId,
  )
  const selected = generationSettings.selectedGeneratorProfiles
  const custom = generationSettings.customRange
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const sectionChords = project.chords
    .filter((chord) => chord.sectionId === selectedSectionId)
    .sort((a, b) => a.startBeat - b.startBeat)
  const candidateEvidence =
    mode === "melody" && variant && selectedSection
      ? explainMelodyCandidate(
          variant,
          sectionChords,
          beatsPerBar,
          selectedSection.lengthBars * beatsPerBar,
        )
      : null

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
        "z-40 flex w-72 min-w-0 shrink-0 flex-col gap-3 overflow-x-hidden overflow-y-auto border-l border-hairline bg-surface-tile-3 p-3 transition-transform duration-200",
        "absolute inset-y-0 right-0 lg:static lg:translate-x-0",
        open ? "translate-x-0" : "translate-x-full",
      )}
    >
      <IconButton onClick={onClose} className="self-start lg:hidden" title="閉じる">
        <X size={16} />
      </IconButton>

      <SectionCard title="曲の方向性" className="w-full min-w-0">
        <div className="flex flex-col gap-2.5">
          <FieldGroup label="曲全体のスタイル">
            <Select className="w-full min-w-0" value={project.song.songProfile} onChange={(e) => updateSongField("songProfile", e.target.value as SongProfileId)}>
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
                className="w-full min-w-0"
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

      <details className="w-full rounded-md border border-hairline bg-surface-tile-1">
        <summary className="cursor-pointer list-none px-3 py-3 text-[12px] font-semibold text-body-on-dark hover:bg-white/5">
          詳細な生成設定を開く
          <span className="mt-1 block text-[11px] font-normal text-body-muted">候補の作り方・音域・密度を細かく調整します</span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-hairline p-2">

      {mode === "melody" && <SectionCard title="主旋律の作り方" className="w-full min-w-0">
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
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-body-on-dark">{GENERATOR_PROFILE_LABELS[p]}</span>
                  <span className="break-words text-ink-muted-48">{GENERATOR_PROFILE_DESCRIPTIONS[p]}</span>
                </span>
              </label>
            )
          })}
        </div>
        <div className="mt-2">
          <IgnoredNote setting="key" selected={selected} />
        </div>
      </SectionCard>}

      {(mode === "melody" ||
        mode === "phrase" ||
        mode === "counter" ||
        mode === "decoration") && (
        <SectionCard
          title="技法ライブラリ比較（実験）"
          className="w-full min-w-0"
        >
          <label className="flex cursor-pointer items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              className="mt-0.5 accent-primary"
              checked={
                generationSettings.techniqueExperimentPresetId !==
                null
              }
              onChange={(event) =>
                setGenerationSettings({
                  techniqueExperimentPresetId: event.target.checked
                    ? TECHNIQUE_EXPERIMENT_PRESETS[0].id
                    : null,
                })
              }
            />
            <span className="min-w-0">
              同じseedでA/B比較する
            </span>
          </label>
          {generationSettings.techniqueExperimentPresetId && (
            <div className="mt-3 flex flex-col gap-2">
              <FieldGroup label="Draft Preset">
                <Select
                  className="w-full min-w-0"
                  value={
                    generationSettings.techniqueExperimentPresetId
                  }
                  onChange={(event) =>
                    setGenerationSettings({
                      techniqueExperimentPresetId:
                        event.target
                          .value as TechniqueExperimentPresetId,
                    })
                  }
                >
                  {TECHNIQUE_EXPERIMENT_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </Select>
              </FieldGroup>
              {TECHNIQUE_EXPERIMENT_PRESETS.filter(
                (preset) =>
                  preset.id ===
                  generationSettings.techniqueExperimentPresetId,
              ).map((preset) => (
                <div key={preset.id}>
                  {(() => {
                    const generatorTarget =
                      mode === "phrase"
                        ? "phrase"
                        : mode === "counter"
                          ? "counter"
                          : mode === "decoration"
                            ? "decoration"
                            : "melody"
                    const validationLevel =
                      preset.targetValidationLevels[
                        generatorTarget
                      ] ?? "exploratory"
                    const recommendedSectionRoles =
                      preset.recommendedSectionRolesByTarget?.[
                        generatorTarget
                      ] ?? []
                    return (
                      <>
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span
                      className={clsx(
                        "rounded-full border px-1.5 py-0.5",
                        validationLevel === "confirmed"
                          ? "border-emerald-400/40 text-emerald-300"
                          : "border-amber-400/40 text-amber-300",
                      )}
                    >
                      {validationLevel === "confirmed"
                        ? "100 seed確認済み"
                        : "探索中"}
                    </span>
                    {mode === "melody" &&
                      preset.recommendedProfiles.length > 0 && (
                      <span className="text-ink-muted-48">
                        推奨:{" "}
                        {preset.recommendedProfiles
                          .map(
                            (profile) =>
                              GENERATOR_PROFILE_LABELS[profile],
                          )
                          .join("・")}
                      </span>
                    )}
                    {generatorTarget !== "melody" &&
                      recommendedSectionRoles.length > 0 && (
                        <span className="text-ink-muted-48">
                          推奨:{" "}
                          {recommendedSectionRoles
                            .map(
                              (role) =>
                                SECTION_ROLE_LABELS[role],
                            )
                            .join("・")}
                        </span>
                      )}
                  </div>
                  <p className="text-[11px] text-ink-muted-48">
                    {preset.description}
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-ink-muted-48">
                    {preset.techniqueNames.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                  {mode === "melody" &&
                    preset.recommendedProfiles.length > 0 &&
                    !selected.some((profile) =>
                      preset.recommendedProfiles.includes(profile),
                    ) && (
                      <p className="mt-2 text-[11px] text-amber-300/90">
                        現在選択中のGenerator Profileは自動検証済みの推奨対象外です。
                      </p>
                    )}
                  {generatorTarget !== "melody" &&
                    recommendedSectionRoles.length > 0 &&
                    selectedSection &&
                    !recommendedSectionRoles.includes(
                      selectedSection.role,
                    ) && (
                      <p className="mt-2 text-[11px] text-amber-300/90">
                        現在のSection Roleは自動検証済みの推奨対象外です。
                      </p>
                    )}
                      </>
                    )
                  })()}
                </div>
              ))}
              <p className="border-t border-hairline pt-2 text-[11px] text-amber-300/90">
                Draftの状態は変更しません。通常3案と適用3案を同時生成し、この設定はプロジェクトへ保存されません。
              </p>
            </div>
          )}
        </SectionCard>
      )}

      {(mode === "melody" || mode === "phrase" || mode === "signature") && (
      <SectionCard title="生成パラメータ" className="w-full min-w-0">
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <FieldGroup label="Density">
              <Select className="w-full min-w-0" value={generationSettings.density} onChange={(e) => setGenerationSettings({ density: e.target.value as Density })}>
                <option value="sparse">Sparse</option>
                <option value="balanced">Balanced</option>
                <option value="active">Active</option>
              </Select>
            </FieldGroup>
            {mode === "melody" && <IgnoredNote setting="density" selected={selected} />}
          </div>
          <div className="flex flex-col gap-1">
            <FieldGroup label="Range">
              <Select
                className="w-full min-w-0"
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
              <div className="mt-1 flex min-w-0 items-end gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Label>最低音</Label>
                  <TextInput
                    key={`low-${custom.low}`}
                    defaultValue={noteName(custom.low)}
                    onBlur={(e) => setCustomBound("low", e.target.value)}
                    placeholder="C4"
                    className="w-full min-w-0"
                  />
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Label>最高音</Label>
                  <TextInput
                    key={`high-${custom.high}`}
                    defaultValue={noteName(custom.high)}
                    onBlur={(e) => setCustomBound("high", e.target.value)}
                    placeholder="F5"
                    className="w-full min-w-0"
                  />
                </div>
              </div>
            )}
            {generationSettings.rangePreset === "custom" && (
              <p className="text-[11px] text-ink-muted-48">
                音名(例: C4, F#5, Bb3)で入力。最高音が最低音以下になる入力・音域外は無視されます。
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <FieldGroup label="Drama">
              <Select className="w-full min-w-0" value={generationSettings.drama} onChange={(e) => setGenerationSettings({ drama: e.target.value as Drama })}>
                <option value="restrained">Restrained</option>
                <option value="growing">Growing</option>
                <option value="open">Open</option>
              </Select>
            </FieldGroup>
            {mode === "melody" && <IgnoredNote setting="drama" selected={selected} />}
          </div>
          <p className="mt-1 border-t border-hairline pt-2 text-[11px] text-ink-muted-48">
            {mode === "phrase" || mode === "signature"
              ? `${mode === "signature" ? "Signature Phrase" : "Phrase"}ではDensity / Range / Dramaを利用します。Generator ProfileはMelody専用です。`
              : "生成設定(Density / Range / Drama / Generator Profile)はこのセッション限りで、プロジェクトには保存されません。Key・拍子・Song Profileはプロジェクトに保存されます。"}
          </p>
        </div>
      </SectionCard>
      )}

      {mode === "melody" && <SectionCard title="特徴量" className="w-full min-w-0">
        {variant?.generatorProfile && (
          <p className="mb-1 text-[12px] text-primary-on-dark">
            {GENERATOR_PROFILE_LABELS[variant.generatorProfile as MelodyGeneratorProfile]}
            {variant.patternIndex && ` · Pattern ${variant.patternIndex}`}
          </p>
        )}
        {variant?.openingIntent && (
          <p className="mb-2 text-[11px] text-ink-muted-48">
            入口: {OPENING_ENTRY_LABELS[variant.openingIntent.entryType]} · {OPENING_EMOTION_LABELS[variant.openingIntent.emotionalFunction]} ·{" "}
            {OPENING_REGISTER_LABELS[variant.openingIntent.register]} · {OPENING_DIRECTION_LABELS[variant.openingIntent.initialDirection]}
          </p>
        )}
        {variant?.techniqueExperiment && (
          <div className="mb-3 rounded-sm border border-primary/30 bg-primary/10 px-2.5 py-2 text-[11px]">
            <p className="font-medium text-primary-on-dark">
              {variant.techniqueExperiment.mode === "baseline"
                ? "A/B · Normal"
                : `A/B · ${variant.techniqueExperiment.presetLabel}`}
            </p>
            {variant.generationDiagnostics?.techniqueFitScore !==
              undefined && (
              <p className="mt-1 text-ink-muted-48">
                Technique Fit{" "}
                {Math.round(
                  variant.generationDiagnostics.techniqueFitScore *
                    100,
                )}
                % · Quality{" "}
                {Math.round(
                  variant.generationDiagnostics.qualityScore,
                )}
              </p>
            )}
          </div>
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
          <Button
            variant="dark"
            className="mt-3 h-auto w-full min-w-0 !whitespace-normal px-3 py-2 text-center leading-snug"
            onClick={() => extractMotifDNAFromVariant(variant.id)}
          >
            <Dna size={13} className="shrink-0" />
            <span className="min-w-0 break-words">このメロディからMotif DNAを抽出</span>
          </Button>
        )}
        {project.songMotifDNA && <p className="mt-2 text-[11px] text-ink-muted-48">Song Motif DNA保存済み(他セクション生成へ軽く反映されます)</p>}
      </SectionCard>}

      {mode === "melody" && variant && candidateEvidence && (
        <SectionCard title="候補の根拠" className="w-full min-w-0">
          <p className="mb-3 text-[11px] leading-4 text-ink-muted-48">
            AIの感想ではなく、表示中のMIDI・コード・生成計画から確認できる事実です。
          </p>
          {candidateEvidence.items.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {candidateEvidence.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-sm border border-hairline bg-surface-tile-2 p-2.5"
                >
                  <p className="text-[11px] font-semibold text-body-on-dark">
                    {item.title}
                  </p>
                  <p className="mt-1 text-[11px] leading-4 text-body-muted">
                    {item.observation}
                  </p>
                  <p className="mt-1.5 border-t border-hairline pt-1.5 text-[11px] leading-4 text-ink-muted-48">
                    {item.interpretation}
                  </p>
                  <Button
                    variant="dark"
                    className="mt-2 h-7 px-2 text-[11px]"
                    onClick={() =>
                      previewPlayer.play({
                        bpm: project.song.tempo,
                        chords: sectionChords,
                        melody: variant.notes,
                        mode: "chords-melody",
                        startBeat: item.range.startBeat,
                        range: item.range,
                      })
                    }
                  >
                    <Play size={11} /> 該当箇所を聴く
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-ink-muted-48">
              現在の候補から、十分に具体的な根拠を抽出できませんでした。
            </p>
          )}
          {candidateEvidence.cautions.length > 0 && (
            <div className="mt-3 rounded-sm border border-amber-400/25 bg-amber-400/5 p-2.5">
              <p className="text-[11px] font-semibold text-amber-300">採用前の確認点</p>
              <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[11px] leading-4 text-body-muted">
                {candidateEvidence.cautions.map((caution) => (
                  <li key={caution}>{caution}</li>
                ))}
              </ul>
            </div>
          )}
        </SectionCard>
      )}
        </div>
      </details>
    </aside>
  )
}
