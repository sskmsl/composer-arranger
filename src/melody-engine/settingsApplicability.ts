/**
 * Issue #13(PR#17後の前提更新): 9つのGenerator Profileそれぞれで、
 * グローバルな生成設定(Density / Range / Drama / Key)が実際の生成へ反映されるかどうかを
 * 明示する対応表。UIはこの表を根拠に「このProfileでは効かない設定」を利用者へ知らせ、
 * テストはこの表と実挙動の整合を検証する。
 *
 * - "applied": その設定がこのProfileの出力へ意味のある差を生む
 * - "not-applicable": このProfileは専用パイプライン/固定文法のため、その設定を(ほぼ)参照しない
 */
import type { MelodyGeneratorProfile } from "@/core/melody"

export type GenerationSettingKey = "density" | "range" | "drama" | "key"

export type Applicability = "applied" | "not-applicable"

export const GENERATION_SETTING_LABELS: Record<GenerationSettingKey, string> = {
  density: "Density",
  range: "Range",
  drama: "Drama",
  key: "Key",
}

/**
 * parametric 6種は既存GenerationParams経由でDensity/Range/Drama/Keyすべてを反映する。
 * bespoke 3種は専用パイプラインで、反映される設定が限定される:
 * - Range: 3種とも音域制約として必ず使う → applied
 * - Density: noteDensityへ寄せる形で反映 → applied(Speech-Rhythmicは同音反復主体のため限定的だがappliedとする)
 * - Drama: Speech-Rhythmicのsyncopation等へbaseParams経由で軽く反映 → applied。
 *          Elegiac/Incantatoryは弧・反復設計が主で、Dramaの効きは実質無いため not-applicable
 * - Key: bespoke 3種は現状Scale寄せを行っておらず(コード追従が主) → not-applicable
 */
export const SETTINGS_APPLICABILITY: Record<MelodyGeneratorProfile, Record<GenerationSettingKey, Applicability>> = {
  standard: { density: "applied", range: "applied", drama: "applied", key: "applied" },
  minimal: { density: "applied", range: "applied", drama: "applied", key: "applied" },
  leaping: { density: "applied", range: "applied", drama: "applied", key: "applied" },
  rhythmic: { density: "applied", range: "applied", drama: "applied", key: "applied" },
  chromatic: { density: "applied", range: "applied", drama: "applied", key: "applied" },
  cinematic: { density: "applied", range: "applied", drama: "applied", key: "applied" },
  "elegiac-cantabile": { density: "applied", range: "applied", drama: "not-applicable", key: "not-applicable" },
  "speech-rhythmic": { density: "applied", range: "applied", drama: "applied", key: "not-applicable" },
  incantatory: { density: "applied", range: "applied", drama: "not-applicable", key: "not-applicable" },
}

/** 指定した設定が「効かない」Profileのラベル一覧(UIの注意書き用)。全Profileで効くなら空配列 */
export function profilesIgnoring(
  setting: GenerationSettingKey,
  selectedProfiles: MelodyGeneratorProfile[],
): MelodyGeneratorProfile[] {
  return selectedProfiles.filter((p) => SETTINGS_APPLICABILITY[p][setting] === "not-applicable")
}
