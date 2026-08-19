import type { MelodyNote } from "@/core/melody"
import type { ComposerProject } from "@/core/project"
import { parseTimeSignature } from "@/core/section"
import {
  buildSongPlaybackMaterial,
  normalizeSectionTimeline,
} from "@/core/sectionTimeline"
import type { AudibleLayerCollisionReview } from "./types"

interface AudibleLayer {
  id: "melody-accompaniment" | "accompaniment-pattern" | "reactive-layers"
  label: string
  notes: MelodyNote[]
}

const ATTACK_TOLERANCE_BEATS = 0.08
const MIN_OVERLAP_BEATS = 0.03

function overlapBeats(left: MelodyNote, right: MelodyNote): number {
  return Math.max(
    0,
    Math.min(
      left.startBeat + left.durationBeats,
      right.startBeat + right.durationBeats,
    ) - Math.max(left.startBeat, right.startBeat),
  )
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100
}

function notesInSection(
  notes: MelodyNote[],
  sectionStart: number,
  sectionEnd: number,
): MelodyNote[] {
  return notes
    .filter(
      (note) =>
        note.startBeat < sectionEnd &&
        note.startBeat + note.durationBeats > sectionStart,
    )
    .map((note) => ({
      ...note,
      startBeat: Math.max(0, note.startBeat - sectionStart),
      durationBeats:
        Math.min(sectionEnd, note.startBeat + note.durationBeats) -
        Math.max(sectionStart, note.startBeat),
    }))
}

function protectedMelodyNotes(notes: MelodyNote[]): Set<string> {
  if (notes.length === 0) return new Set()
  const ordered = [...notes].sort(
    (left, right) => left.startBeat - right.startBeat || left.pitch - right.pitch,
  )
  const peak = Math.max(...ordered.map((note) => note.pitch))
  const protectedIds = new Set<string>()
  for (const [index, note] of ordered.entries()) {
    const previous = ordered[index - 1]
    if (
      note.pitch === peak ||
      note.durationBeats >= 1.5 ||
      (previous && Math.abs(note.pitch - previous.pitch) >= 5)
    ) {
      protectedIds.add(note.id)
    }
  }
  return protectedIds
}

function emptyReview(sectionId: string, summary: string): AudibleLayerCollisionReview {
  return {
    version: "1.0.0",
    sectionId,
    status: "pending",
    score: 0,
    summary,
    metrics: {
      reviewedSupportLayerCount: 0,
      samePitchOverlapBeats: 0,
      semitoneOverlapBeats: 0,
      protectedAttackCount: 0,
      simultaneousAttackCount: 0,
      supportCollisionBeats: 0,
    },
    findings: [],
  }
}

/**
 * Preview/MIDIと同じ材料を監査する。生成候補の保存済みscoreではなく、現在Set Activeの
 * 組み合わせを再計算するため、後から伴奏やPerformanceを変更した場合も結果が追従する。
 */
export function reviewAudibleLayerCollisions(
  project: ComposerProject,
  sectionId: string,
): AudibleLayerCollisionReview {
  const sections = normalizeSectionTimeline(project.sections)
  const section = sections.find((candidate) => candidate.id === sectionId)
  if (!section) return emptyReview(sectionId, "対象Sectionがありません。")

  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const sectionStart = (section.startBar - 1) * beatsPerBar
  const sectionEnd = sectionStart + section.lengthBars * beatsPerBar
  const material = buildSongPlaybackMaterial(project)
  const lead = notesInSection(material.lead, sectionStart, sectionEnd)
  if (lead.length === 0) {
    return emptyReview(
      sectionId,
      "Active Melodyを設定すると、実際に鳴る補助レイヤーとの衝突を確認できます。",
    )
  }

  const supportLayers = ([
    {
      id: "melody-accompaniment",
      label: "Melody内Accompaniment",
      notes: notesInSection(material.accompaniment, sectionStart, sectionEnd),
    },
    {
      id: "accompaniment-pattern",
      label: "Accompaniment Pattern",
      notes: notesInSection(material.accompanimentPattern, sectionStart, sectionEnd),
    },
    {
      id: "reactive-layers",
      label: "Counter / Decoration",
      notes: notesInSection(material.reactiveLayers, sectionStart, sectionEnd),
    },
  ] satisfies AudibleLayer[]).filter((layer) => layer.notes.length > 0)

  if (supportLayers.length === 0) {
    return {
      ...emptyReview(sectionId, "主旋律以外のActiveレイヤーはありません。"),
      status: "strong",
      score: 100,
      findings: [{
        id: "lead-only",
        severity: "pass",
        title: "主旋律を覆うActiveレイヤーはありません",
        evidence: "現在のPreview/MIDI材料はLead単独です。",
        recommendation: "追加する場合も、主旋律の休符と感情点を先に保護してください。",
        sources: [],
      }],
    }
  }

  const protectedIds = protectedMelodyNotes(lead)
  let samePitchOverlapBeats = 0
  let semitoneOverlapBeats = 0
  let protectedAttackCount = 0
  let simultaneousAttackCount = 0
  let supportCollisionBeats = 0
  const involvedSources = new Set<string>()

  for (const layer of supportLayers) {
    for (const support of layer.notes) {
      for (const melody of lead) {
        const overlap = overlapBeats(support, melody)
        if (overlap < MIN_OVERLAP_BEATS) continue
        const pitchDistance = Math.abs(support.pitch - melody.pitch)
        if (pitchDistance === 0) {
          samePitchOverlapBeats += overlap
          involvedSources.add(layer.label)
        } else if (pitchDistance === 1) {
          semitoneOverlapBeats += overlap
          involvedSources.add(layer.label)
        }
        const attacksTogether =
          Math.abs(support.startBeat - melody.startBeat) <= ATTACK_TOLERANCE_BEATS
        if (attacksTogether) simultaneousAttackCount += 1
        if (protectedIds.has(melody.id) && attacksTogether) {
          protectedAttackCount += 1
          involvedSources.add(layer.label)
        }
      }
    }
  }

  for (let leftIndex = 0; leftIndex < supportLayers.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < supportLayers.length; rightIndex += 1) {
      const left = supportLayers[leftIndex]
      const right = supportLayers[rightIndex]
      for (const leftNote of left.notes) {
        for (const rightNote of right.notes) {
          if (Math.abs(leftNote.pitch - rightNote.pitch) > 1) continue
          const overlap = overlapBeats(leftNote, rightNote)
          if (overlap < MIN_OVERLAP_BEATS) continue
          supportCollisionBeats += overlap
          involvedSources.add(left.label)
          involvedSources.add(right.label)
        }
      }
    }
  }

  samePitchOverlapBeats = rounded(samePitchOverlapBeats)
  semitoneOverlapBeats = rounded(semitoneOverlapBeats)
  supportCollisionBeats = rounded(supportCollisionBeats)
  const findings: AudibleLayerCollisionReview["findings"] = []
  let score = 100

  if (samePitchOverlapBeats >= 0.12 || semitoneOverlapBeats >= 0.25) {
    const blocking = samePitchOverlapBeats >= 0.5 || semitoneOverlapBeats >= 0.75
    score -= blocking ? 34 : 18
    findings.push({
      id: "pitch-collision",
      severity: blocking ? "blocking" : "warning",
      title: "主旋律と補助レイヤーに近接音程の重なりがあります",
      evidence: `同音 ${samePitchOverlapBeats.toFixed(2)}拍 / 短2度 ${semitoneOverlapBeats.toFixed(2)}拍`,
      recommendation: "コードトーンへ一律補正せず、補助音の発音位置・オクターブ・休符の順で主旋律から離してください。",
      sources: [...involvedSources],
    })
  }

  if (protectedAttackCount > 0) {
    score -= Math.min(30, protectedAttackCount * 10)
    findings.push({
      id: "protected-attack",
      severity: protectedAttackCount >= 2 ? "blocking" : "warning",
      title: "主旋律の感情点へ補助アタックが重なっています",
      evidence: `最高音・長音・跳躍着地への同時アタック ${protectedAttackCount}回`,
      recommendation: "補助音を直前の期待または直後の応答へ移し、感情点を単独で到達させてください。",
      sources: [...involvedSources],
    })
  }

  const attackLimit = Math.max(3, Math.ceil(lead.length * 0.35))
  if (simultaneousAttackCount > attackLimit) {
    score -= 12
    findings.push({
      id: "attack-shadowing",
      severity: "warning",
      title: "補助レイヤーが主旋律のリズムをなぞりすぎています",
      evidence: `同時アタック ${simultaneousAttackCount}回（目安 ${attackLimit}回以下）`,
      recommendation: "主旋律と同時に鳴らす回数を減らし、裏拍・保持音・応答フレーズへ役割を分けてください。",
      sources: supportLayers.map((layer) => layer.label),
    })
  }

  if (supportCollisionBeats >= 0.5) {
    score -= supportCollisionBeats >= 1.5 ? 18 : 9
    findings.push({
      id: "support-collision",
      severity: supportCollisionBeats >= 1.5 ? "warning" : "notice",
      title: "補助レイヤー同士が同じ音域を占有しています",
      evidence: `補助間の同音・短2度重複 ${supportCollisionBeats.toFixed(2)}拍`,
      recommendation: "Counter・Decoration・Patternのうち、同じ機能を担う一つを休ませてください。",
      sources: [...involvedSources],
    })
  }

  score = Math.max(0, Math.round(score))
  const status = findings.some((finding) => finding.severity === "blocking")
    ? "revise"
    : findings.some((finding) => finding.severity === "warning")
      ? "watch"
      : "strong"
  if (findings.length === 0) {
    findings.push({
      id: "audible-separation",
      severity: "pass",
      title: "実音上の重大な衝突はありません",
      evidence: "Preview/MIDI材料で同音・短2度・感情点アタックの集中は検出されませんでした。",
      recommendation: "音色の倍音と残響はノート情報だけで測れないため、最終試聴で確認してください。",
      sources: supportLayers.map((layer) => layer.label),
    })
  }

  return {
    version: "1.0.0",
    sectionId,
    status,
    score,
    summary:
      status === "strong"
        ? "実際に鳴るレイヤーは主旋律の音程と感情点を守っています。"
        : status === "revise"
          ? "実音で主旋律を覆う衝突があります。採用前の修正を推奨します。"
          : "採用可能ですが、主旋律と補助音の発音位置を分ける余地があります。",
    metrics: {
      reviewedSupportLayerCount: supportLayers.length,
      samePitchOverlapBeats,
      semitoneOverlapBeats,
      protectedAttackCount,
      simultaneousAttackCount,
      supportCollisionBeats,
    },
    findings,
  }
}
