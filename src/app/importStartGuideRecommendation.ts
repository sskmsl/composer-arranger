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
      reason: "コードと主旋律はそろっています。音を増やす前に、まずリズムで曲の呼吸と進み方を決めるのがおすすめです。",
      prompt: "いまのコードと主旋律は変えずに、音を詰めすぎないドラムを考えて。キック・スネア・ハイハットの役割と、休みで作る呼吸も具体的に。",
    }
  }
  if (!roles.has("bass")) {
    return {
      target: "bass",
      title: "ベースを考える",
      reason: "リズムはありますが、ベースがまだありません。コードの根音をなぞるだけでなく、曲の重心を先に決めます。",
      prompt: "いまのコード・主旋律・ドラムを生かして、根音をなぞるだけではないベースを考えて。休みの置き方とキックとの分担も。",
    }
  }
  if (!roles.has("counter") && !roles.has("decoration")) {
    return {
      target: "counter",
      title: "対旋律・合いの手を考える",
      reason: "土台はそろっています。主旋律を邪魔せずに曲の印象を強める、対旋律や合いの手が要るかを考えます。",
      prompt: "いまの主旋律・コード・リズム・ベースは崩さずに、対旋律や合いの手が本当に要るか判断して。要るなら、主旋律の休みに置く形で。",
    }
  }
  return {
    target: "arrangement",
    title: "曲全体の密度と起伏を整理",
    reason: "主なパートはそろっています。音を足す前に、セクションごとの厚みと、山場まで取っておく音を決めます。",
    prompt: "読み込んだパートを生かして、曲全体の厚みと、山場まで取っておく音を見直して。足すより削る方を優先して。",
  }
}
