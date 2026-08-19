import type { ComposerProject } from "@/core/project"
import type {
  ArrangementDirectorBlueprint,
  ArrangementOrchestrationBlueprint,
  OrchestrationPartPlan,
  SectionOrchestrationPlan,
} from "./types"

function dynamicForEnergy(energy: number): OrchestrationPartPlan["dynamic"] {
  if (energy <= 1) return "pp"
  if (energy === 2) return "p"
  if (energy === 3) return "mp"
  if (energy === 4) return "mf"
  return "f"
}

function velocityForDynamic(
  dynamic: OrchestrationPartPlan["dynamic"],
): readonly [number, number] {
  if (dynamic === "pp") return [34, 52]
  if (dynamic === "p") return [45, 64]
  if (dynamic === "mp") return [58, 78]
  if (dynamic === "mf") return [70, 92]
  return [84, 108]
}

function performanceArc(energy: number, policy: string): string {
  if (policy === "express") return "入口では輪郭を明確にし、中盤で全音域を開き、終端は次の余韻を残す"
  if (policy === "approach") return "音量より前景への接近とアタックの明瞭化で期待を上げる"
  if (policy === "recover") return "発音数と高域を引き、残響と減衰で直前の頂点を記憶として残す"
  if (energy <= 2) return "小さな強弱差と呼吸を保ち、変化を急がず一つの音色を定着させる"
  return "同じ強さを維持せず、フレーズ単位の膨張と後退を交互に作る"
}

function part(
  value: OrchestrationPartPlan,
): OrchestrationPartPlan {
  return value
}

export function buildOrchestrationBlueprint(
  project: ComposerProject,
  director: ArrangementDirectorBlueprint,
): ArrangementOrchestrationBlueprint {
  const sections = director.sections.map((sectionPlan): SectionOrchestrationPlan => {
    const section = project.sections.find((candidate) => candidate.id === sectionPlan.sectionId)
    const content = section?.content
    const leadExpected = (content?.lead ?? "melody") !== "none"
    const accompanimentExpected = (content?.accompaniment ?? "chords") !== "none"
    const activeMelody = Boolean(project.sectionMelodyAssignments[sectionPlan.sectionId])
    const activeAccompaniment = Boolean(
      project.sectionAccompanimentPatternAssignments[sectionPlan.sectionId],
    )
    const activeCounter = Boolean(project.sectionReactiveLayerAssignments?.[sectionPlan.sectionId])
    const activeDecoration = Boolean(project.sectionDecorationLayerAssignments?.[sectionPlan.sectionId])
    const intentionalSilence =
      !leadExpected &&
      !accompanimentExpected &&
      !activeMelody &&
      !activeAccompaniment &&
      !activeCounter &&
      !activeDecoration
    const dynamic = dynamicForEnergy(sectionPlan.targetEnergy)
    const nextPlan = director.sections[sectionPlan.order + 1]
    const parts: OrchestrationPartPlan[] = []

    if (leadExpected || activeMelody) {
      parts.push(part({
        id: `${sectionPlan.sectionId}:lead-focus`,
        role: "lead-focus",
        family: "lead-voice",
        sourceState: activeMelody ? "active" : "recommended",
        register: sectionPlan.registerFocus === "full" ? "middle-high" : sectionPlan.registerFocus,
        distance: sectionPlan.climaxPolicy === "recover" ? "middle" : "intimate",
        articulation: sectionPlan.targetEnergy >= 4 ? "legato" : "decaying",
        dynamic,
        velocityRange: velocityForDynamic(dynamic),
        timing: "floating",
        entry: (content?.entryOffsetBeats ?? 0) > 0
          ? `${content?.entryOffsetBeats}拍の無音後に前景へ入る`
          : "Section冒頭で、伴奏より一瞬遅く呼吸して入る",
        exit: nextPlan?.targetEnergy && nextPlan.targetEnergy > sectionPlan.targetEnergy
          ? "終端を短く閉じ、次Sectionの入口へ空間を渡す"
          : "語尾を切らず、自然減衰を残す",
        purpose: "主旋律を常に最も読み取りやすい前景へ置く",
      }))
    }

    if (accompanimentExpected) {
      const family = sectionPlan.targetEnergy <= 2 ? "atmospheric-pad" : "piano-keys"
      const supportDynamic = sectionPlan.targetEnergy >= 5 ? "mf" : sectionPlan.targetEnergy >= 3 ? "mp" : "p"
      parts.push(part({
        id: `${sectionPlan.sectionId}:harmonic-space`,
        role: "harmonic-space",
        family,
        sourceState: "active",
        register: sectionPlan.registerFocus === "low" ? "low-middle" : "middle",
        distance: sectionPlan.targetEnergy >= 4 ? "middle" : "distant",
        articulation: sectionPlan.targetEnergy >= 4 ? "pulsed" : "sustained",
        dynamic: supportDynamic,
        velocityRange: velocityForDynamic(supportDynamic),
        timing: "slightly-behind",
        entry: "主旋律のアタックを隠さない位置から入る",
        exit: "コード終端で切らず、次の和音または残響へ接続する",
        purpose: "コード説明ではなく、主旋律が存在する空間と重力を作る",
      }))
    }

    if (
      !intentionalSilence && (activeAccompaniment ||
      (sectionPlan.targetEnergy >= 3 && project.arrangementSettings.rhythmActivity >= 0.4)
      )
    ) {
      parts.push(part({
        id: `${sectionPlan.sectionId}:pulse-foundation`,
        role: "pulse-foundation",
        family: sectionPlan.targetEnergy >= 4 ? "percussion" : "analog-synth",
        sourceState: activeAccompaniment ? "active" : "recommended",
        register: "low-middle",
        distance: "middle",
        articulation: "pulsed",
        dynamic: sectionPlan.targetEnergy >= 4 ? "mf" : "mp",
        velocityRange: velocityForDynamic(sectionPlan.targetEnergy >= 4 ? "mf" : "mp"),
        timing: sectionPlan.targetEnergy >= 4 ? "strict" : "slightly-behind",
        entry: sectionPlan.climaxPolicy === "approach"
          ? "Section後半から限定的に入り、次Sectionで輪郭を完成させる"
          : "1拍目を毎回強調せず、主旋律の隙間から周期を示す",
        exit: "最後の反復だけ一打または一音を抜き、次の展開を予告する",
        purpose: "音数ではなく周期とアクセントで推進力を作る",
      }))
    }

    if (!intentionalSilence && (activeCounter || (
      sectionPlan.additionBudget > 0 &&
      sectionPlan.targetEnergy >= 2 &&
      sectionPlan.targetEnergy <= 4 &&
      section?.role !== "intro"
    ))) {
      parts.push(part({
        id: `${sectionPlan.sectionId}:counter-voice`,
        role: "counter-voice",
        family: sectionPlan.targetEnergy <= 2 ? "mallet-bell" : "strings",
        sourceState: activeCounter ? "active" : "recommended",
        register: sectionPlan.registerFocus === "low-middle" ? "middle" : "middle-high",
        distance: "middle",
        articulation: sectionPlan.targetEnergy <= 2 ? "decaying" : "legato",
        dynamic: sectionPlan.targetEnergy >= 4 ? "mp" : "p",
        velocityRange: velocityForDynamic(sectionPlan.targetEnergy >= 4 ? "mp" : "p"),
        timing: "floating",
        entry: "主旋律の休符または長音の後半だけに応答する",
        exit: "主旋律の次の重要アタックより前に退く",
        purpose: "主旋律を二重化せず、別の視点または残像を作る",
      }))
    }

    if (!intentionalSilence && (
      activeDecoration ||
      sectionPlan.climaxPolicy === "approach" ||
      sectionPlan.climaxPolicy === "recover"
    )) {
      parts.push(part({
        id: `${sectionPlan.sectionId}:transition-color`,
        role: "transition-color",
        family: sectionPlan.climaxPolicy === "recover" ? "atmospheric-pad" : "mallet-bell",
        sourceState: activeDecoration ? "active" : "recommended",
        register: sectionPlan.climaxPolicy === "recover" ? "middle" : "middle-high",
        distance: "distant",
        articulation: sectionPlan.climaxPolicy === "recover" ? "decaying" : "swelling",
        dynamic: "p",
        velocityRange: velocityForDynamic("p"),
        timing: sectionPlan.climaxPolicy === "approach" ? "slightly-ahead" : "slightly-behind",
        entry: "Section終端の最後のフレーズ後に限定して入る",
        exit: "次Sectionの主要アタックと重ねず、直前または残響だけで接続する",
        purpose: "効果音ではなく、Section間の時間を演奏する",
      }))
    }

    if (parts.length === 0) {
      parts.push(part({
        id: `${sectionPlan.sectionId}:intentional-silence`,
        role: "intentional-silence",
        family: "silence",
        sourceState: "active",
        register: "middle",
        distance: "distant",
        articulation: "decaying",
        dynamic: "pp",
        velocityRange: [1, 1],
        timing: "floating",
        entry: "音を追加しない",
        exit: "残響または次Sectionの弱起だけを許可する",
        purpose: "空白を構成上の出来事として保持する",
      }))
    }

    const audibleParts = parts.filter((candidate) => candidate.role !== "intentional-silence")
    const activeParts = audibleParts.filter((candidate) => candidate.sourceState === "active")
    const recommendedParts = audibleParts.filter((candidate) => candidate.sourceState === "recommended")
    const recommendationSlots = Math.max(0, sectionPlan.densityCeiling - activeParts.length)
    // 既存Activeが上限超過していても隠さない。超過自体はReview Loopが指摘する。
    const allowedParts = [
      ...activeParts,
      ...recommendedParts.slice(0, recommendationSlots),
    ]
    const finalParts = parts[0]?.role === "intentional-silence" ? parts : allowedParts
    const overriddenParts = finalParts.map((candidate) => {
      const override = project.sectionOrchestrationOverrides?.[sectionPlan.sectionId]?.[candidate.role]
      return {
        ...candidate,
        ...(override ?? {}),
        velocityRange: override?.dynamic
          ? velocityForDynamic(override.dynamic)
          : candidate.velocityRange,
        // Role・sourceState・登退場・目的はDirectorの責務として上書きさせない。
        id: candidate.id,
        role: candidate.role,
        sourceState: candidate.sourceState,
        entry: candidate.entry,
        exit: candidate.exit,
        purpose: candidate.purpose,
      }
    })

    return {
      sectionId: sectionPlan.sectionId,
      maxSimultaneousParts: sectionPlan.densityCeiling,
      performanceArc: performanceArc(sectionPlan.targetEnergy, sectionPlan.climaxPolicy),
      parts: overriddenParts,
      withheldGestures: sectionPlan.withhold.map((resource) => `${resource}はまだ使わない`),
    }
  })

  return { version: "1.0.0", sections }
}
