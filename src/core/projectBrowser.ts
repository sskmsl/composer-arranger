/**
 * Issue #14: 保存済みComposer Projectをブラウズ/整理するための純粋ロジック。
 * IndexedDB非依存(テスト可能)にし、DB配線は storage/projectRepository.ts が担う。
 */
import { CURRENT_SCHEMA_VERSION, type ComposerProject } from "./project"
import { resolveProjectTiming } from "./timingMigration"
import { parseTimeSignature } from "./section"

export interface ProjectSummary {
  projectId: string
  title: string
  /** IndexedDB保存時刻(ISO)。未保存レコードは null */
  savedAt: string | null
  tempo: number
  key: string
  timeSignature: string
  sectionCount: number
  /** Issue #16: 時間単位を自動判定できない旧1.1データ。一覧で「移行要確認」を示す */
  timingAmbiguous: boolean
}

/**
 * 保存レコード(生JSON可)から一覧表示用のサマリを作る。
 * timingは resolveProjectTiming で判定のみ行い、曖昧な場合も再スケールしない(project側は参照用)。
 */
export function summarizeProject(record: unknown): ProjectSummary {
  const savedAt = (record as { savedAt?: unknown })?.savedAt
  const result = resolveProjectTiming(record)
  const p = result.project
  return {
    projectId: p.projectId,
    title: p.title,
    savedAt: typeof savedAt === "string" ? savedAt : null,
    tempo: p.song.tempo,
    key: p.song.key,
    timeSignature: p.song.timeSignature,
    sectionCount: p.sections.length,
    timingAmbiguous: result.status === "ambiguous",
  }
}

/** 一覧の並べ替え: 更新日時の新しい順(savedAtが無いものは末尾) */
export function sortSummariesByRecency(items: ProjectSummary[]): ProjectSummary[] {
  return [...items].sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""))
}

/** タイトル部分一致(大文字小文字無視)での絞り込み */
export function filterSummaries(items: ProjectSummary[], query: string): ProjectSummary[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((s) => s.title.toLowerCase().includes(q))
}

/**
 * プロジェクトを複製する(Issue #14)。新しいprojectIdを持ち、タイトル以外の全データ
 * (Song Motif DNA / generatorProfileRoles / melodyVariantsのgeneratorProfile・patternIndex・
 * advancedMetrics・prosodyPlan 等 / timeBase)を保持する。参照共有を避けるため深いコピーを行う。
 */
export function duplicateProjectData(project: ComposerProject): ComposerProject {
  const clone: ComposerProject = JSON.parse(JSON.stringify(project))
  clone.projectId = crypto.randomUUID()
  clone.title = `${project.title} のコピー`
  clone.schemaVersion = CURRENT_SCHEMA_VERSION
  return clone
}

/**
 * lastOpened プロジェクトを削除したときの、削除後の lastOpened を決める(Issue #14)。
 * 削除対象が lastOpened でなければ据え置き。lastOpened を消した場合は残りの先頭、無ければ null。
 */
export function nextLastOpenedAfterDelete(
  deletedId: string,
  lastOpenedId: string | null | undefined,
  remainingIds: string[],
): string | null {
  if (lastOpenedId && lastOpenedId !== deletedId) return lastOpenedId
  return remainingIds.find((id) => id !== deletedId) ?? null
}

/** section数だけでなく、拍子から総小節数の目安も出す(表示補助) */
export function totalBarsOf(project: ComposerProject): number {
  const ts = parseTimeSignature(project.song.timeSignature)
  void ts
  return project.sections.reduce((sum, s) => sum + s.lengthBars, 0)
}
