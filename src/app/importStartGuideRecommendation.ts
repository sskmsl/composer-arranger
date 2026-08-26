import type { ComposerProject, ImportedArrangementTrackRole } from "@/core/project"

export interface ImportNextStep {
  target: "melody" | "rhythm" | "bass" | "counter" | "arrangement"
  title: string
  reason: string
  prompt: string
}

function importedRoles(project: ComposerProject): Set<ImportedArrangementTrackRole> {
  return new Set(project.importedArrangement?.tracks.map((track) => track.role) ?? [])
}

/** 読み込んだ実データの不足役割から、最初に検討する一手だけを返す。 */
export function recommendImportNextStep(project: ComposerProject): ImportNextStep {
  const roles = importedRoles(project)
  const hasMelody = roles.has("melody") || Object.values(project.sectionMelodyAssignments).some(Boolean)

  if (!hasMelody) {
    return {
      target: "melody",
      title: "主旋律の確認・生成",
      reason: "主旋律として確定されたトラックがありません。まず曲の中心を決めると、後続パートの衝突を避けられます。",
      prompt: "読み込んだコードと既存トラックを尊重し、この曲の中心になる主旋律をどう設計すべきか3案を提案して。既存パートとぶつからない余白も示して。",
    }
  }
  if (!roles.has("drums")) {
    return {
      target: "rhythm",
      title: "リズム設計",
      reason: "コードとMelodyは揃っています。次は音を増やす前に、曲の呼吸と推進力を決めるのが効果的です。",
      prompt: "現在のコードとActive Melodyを変えず、音を詰めすぎないリズム設計を3案提案して。Kick・Snare・Hat・Percの役割と、休符で作る呼吸を具体化して。",
    }
  }
  if (!roles.has("bass")) {
    return {
      target: "bass",
      title: "Bassの役割設計",
      reason: "リズムはありますが低域の設計が未確定です。コードのルート追従ではなく、曲の重力を先に決めます。",
      prompt: "現在のコード、Active Melody、ドラムを尊重し、ルートを機械的に追わないBassの役割を3案提案して。余白とKickとの分担も示して。",
    }
  }
  if (!roles.has("counter") && !roles.has("decoration")) {
    return {
      target: "counter",
      title: "第二の顔を設計",
      reason: "土台は揃っています。主旋律を邪魔せず、曲を記憶に残すCounterまたはDecorationの必要性を判断します。",
      prompt: "現在の主旋律・コード・リズム・Bassを壊さず、このセクションに第二の顔が本当に必要か判断して。必要ならCounterまたはDecorationを余白へ置く3案を提案して。",
    }
  }
  return {
    target: "arrangement",
    title: "曲全体の密度と起伏を整理",
    reason: "主要パートは揃っています。新しい音を足す前に、Sectionごとの役割・密度・温存する要素を決めます。",
    prompt: "読み込んだ全パートを尊重し、曲全体の密度、Sectionごとの役割、クライマックスまで温存する要素を診断して。追加より削る判断を優先して3案を提案して。",
  }
}
