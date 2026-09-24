import type {
  ArrangementGenerationDirective,
  ArrangementTrackId,
  FullSongArrangement,
} from "./arrangementGeneration"
import type { ComposerProject } from "./project"
import { parseTimeSignature } from "./section"
import { buildSongPlaybackMaterial, normalizeSectionTimeline } from "./sectionTimeline"

/**
 * アレンジ相談チャット。
 * 形になった曲について会話し、AIの提案を「全曲アレンジの版」として試聴・適用・取り消しする。
 * 版は全曲アレンジ本体(1版で数十KB)を持たず、同じ結果を作り直せる生成条件と、
 * 前の版からの変化の要約だけを保存する。
 */

/** 同じ全曲アレンジを作り直すための生成条件 */
export interface ArrangementRecipe {
  brief: string
  directive?: ArrangementGenerationDirective
  seed: number
  revision: number
  /**
   * 作り直すセクション。指定があれば、それ以外のセクションは元の版の音をそのまま残す
   * (「サビを開いて」でAメロまで変わらないように)。なければ曲全体を作り直す。
   */
  scopeSectionIds?: string[]
  /** 「パッドは抜いて」のように外すよう言われたパート(作り直す範囲の中で外す) */
  removeRowIds?: ArrangementPartRowId[]
}

export type ArrangementCellChangeKind = "added" | "removed" | "changed"

export interface ArrangementCellChange {
  sectionId: string
  rowId: ArrangementPartRowId
  kind: ArrangementCellChangeKind
  /** changed のときの中身(「音域を上げる」など) */
  detail?: string
}

export interface ArrangementVersion {
  id: string
  number: number
  label: string
  createdAt: string
  source: "original" | "existing" | "chat"
  /** original(追加パートなし)は持たない */
  recipe?: ArrangementRecipe
  /** この版の全曲アレンジのID。相談の外で作り直されたかどうかの判定に使う */
  arrangementId: string | null
  /** 前の版からの変化 */
  changes: ArrangementCellChange[]
  /** 一部のセクションだけ作り直した版の、元になった版 */
  baseVersionId?: string
}

export interface ArrangementChatProposal {
  id: string
  /** 案A・案B・案C */
  label: string
  title: string
  summary: string
  /** いまの版からの具体的な変化(実際に生成して比べた結果) */
  points: string[]
  /** 次の相談でAIへ渡す、AI側の案の中身 */
  generator: string
  generationBrief: string
  recipe: ArrangementRecipe
}

export interface ArrangementChatMessage {
  id: string
  role: "user" | "assistant"
  createdAt: string
  text: string
  proposals?: ArrangementChatProposal[]
  /** 適用した案のIDと、その結果できた版 */
  appliedProposalId?: string
  appliedVersionId?: string
  dismissed?: boolean
}

export interface ArrangementChatState {
  updatedAt: string
  messages: ArrangementChatMessage[]
  versions: ArrangementVersion[]
  currentVersionId: string | null
  confirmedConstraints: string[]
}

export const MAX_ARRANGEMENT_CHAT_MESSAGES = 60
export const MAX_ARRANGEMENT_VERSIONS = 30

export type ArrangementPartRowId =
  | "drums"
  | "bass"
  | "pulse"
  | "pad"
  | "glass"
  | "transition"
  | "strings-low"
  | "strings-high"

export interface ArrangementPartRow {
  id: ArrangementPartRowId
  label: string
  color: string
  trackIds: ArrangementTrackId[]
}

/** 21の生成トラックを、耳で区別しやすい8つのパートにまとめる */
export const ARRANGEMENT_PART_ROWS: ArrangementPartRow[] = [
  {
    id: "drums",
    label: "ドラム",
    color: "#fb923c",
    trackIds: [
      "dr-kick",
      "dr-snare",
      "dr-closed-hat",
      "dr-open-hat",
      "dr-low-tom",
      "dr-high-tom",
      "dr-field-drum",
      "dr-gran-cassa",
      "dr-crash",
    ],
  },
  { id: "bass", label: "ベース", color: "#4fd1b5", trackIds: ["syn-bass"] },
  { id: "pulse", label: "シンセの刻み", color: "#f472b6", trackIds: ["syn-pulse", "syn-stabs"] },
  { id: "pad", label: "パッド", color: "#c084fc", trackIds: ["syn-dark-pad"] },
  { id: "glass", label: "高音のきらめき", color: "#7dd3fc", trackIds: ["syn-high-glass"] },
  { id: "transition", label: "つなぎのフレーズ", color: "#a3e635", trackIds: ["syn-transition-phrase", "syn-final-lift"] },
  { id: "strings-low", label: "弦（低音）", color: "#fcd34d", trackIds: ["str-cello", "str-viola"] },
  { id: "strings-high", label: "弦（高音）", color: "#fbbf24", trackIds: ["str-violin-2", "str-violin-1", "str-upper"] },
]

const ROW_BY_TRACK = new Map<ArrangementTrackId, ArrangementPartRowId>(
  ARRANGEMENT_PART_ROWS.flatMap((row) => row.trackIds.map((trackId) => [trackId, row.id] as const)),
)

export function partRowLabel(rowId: ArrangementPartRowId): string {
  return ARRANGEMENT_PART_ROWS.find((row) => row.id === rowId)?.label ?? rowId
}

export interface ArrangementMatrixCell {
  noteCount: number
  /** 1小節あたりの音数 */
  notesPerBar: number
  averagePitch: number | null
  /** 音の並びが同じかどうかを比べるための要約 */
  signature: string
}

export interface ArrangementMatrixSection {
  sectionId: string
  name: string
  startBar: number
  endBar: number
  lengthBars: number
  hasMelody: boolean
  hasChords: boolean
  cells: Record<ArrangementPartRowId, ArrangementMatrixCell>
}

function emptyCell(): ArrangementMatrixCell {
  return { noteCount: 0, notesPerBar: 0, averagePitch: null, signature: "" }
}

/** セクション×パートごとに、全曲アレンジの音数と音の並びをまとめる(ミュート中のトラックは鳴らないので除く) */
export function arrangementPartMatrix(
  project: ComposerProject,
  arrangement: FullSongArrangement | null | undefined,
): ArrangementMatrixSection[] {
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  const sections = normalizeSectionTimeline(project.sections)
  const material = buildSongPlaybackMaterial(project, arrangement?.plan.directive?.timelineConstraints)
  const leadNotes = [...material.melody]
  const grouped = new Map<string, Array<{ trackId: ArrangementTrackId; startBeat: number; durationBeats: number; pitch: number }>>()
  for (const track of arrangement?.tracks ?? []) {
    if (track.muted) continue
    const rowId = ROW_BY_TRACK.get(track.id)
    if (!rowId) continue
    for (const note of track.notes) {
      const key = `${note.sectionId}:${rowId}`
      const list = grouped.get(key) ?? []
      list.push({ trackId: track.id, startBeat: note.startBeat, durationBeats: note.durationBeats, pitch: note.pitch })
      grouped.set(key, list)
    }
  }
  return sections.map((section) => {
    const startBeat = (section.startBar - 1) * beatsPerBar
    const endBeat = startBeat + section.lengthBars * beatsPerBar
    const cells = {} as Record<ArrangementPartRowId, ArrangementMatrixCell>
    for (const row of ARRANGEMENT_PART_ROWS) {
      const notes = grouped.get(`${section.id}:${row.id}`) ?? []
      if (notes.length === 0) {
        cells[row.id] = emptyCell()
        continue
      }
      const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch || a.trackId.localeCompare(b.trackId))
      cells[row.id] = {
        noteCount: notes.length,
        notesPerBar: notes.length / Math.max(1, section.lengthBars),
        averagePitch: notes.reduce((sum, note) => sum + note.pitch, 0) / notes.length,
        signature: sorted
          .map((note) => `${note.trackId}@${Math.round(note.startBeat * 4)}:${note.pitch}:${Math.round(note.durationBeats * 4)}`)
          .join("|"),
      }
    }
    return {
      sectionId: section.id,
      name: section.name,
      startBar: section.startBar,
      endBar: section.startBar + section.lengthBars - 1,
      lengthBars: section.lengthBars,
      hasMelody: leadNotes.some((note) => note.startBeat >= startBeat && note.startBeat < endBeat),
      hasChords: project.chords.some((chord) => chord.sectionId === section.id),
      cells,
    }
  })
}

function changeDetail(before: ArrangementMatrixCell, after: ArrangementMatrixCell): string {
  const pitchShift = (after.averagePitch ?? 0) - (before.averagePitch ?? 0)
  if (pitchShift >= 7) return "音域を上げる"
  if (pitchShift <= -7) return "音域を下げる"
  const ratio = after.noteCount / Math.max(1, before.noteCount)
  if (ratio >= 1.4) return "音数を増やす"
  if (ratio <= 0.7) return "音数を減らす"
  return "フレーズを変える"
}

/** 2つの全曲アレンジの違いを、セクション×パートの単位で求める */
export function diffArrangementMatrices(
  before: ArrangementMatrixSection[],
  after: ArrangementMatrixSection[],
): ArrangementCellChange[] {
  const beforeBySection = new Map(before.map((section) => [section.sectionId, section]))
  const changes: ArrangementCellChange[] = []
  for (const section of after) {
    const previous = beforeBySection.get(section.sectionId)
    for (const row of ARRANGEMENT_PART_ROWS) {
      const a = previous?.cells[row.id] ?? emptyCell()
      const b = section.cells[row.id]
      if (a.noteCount === 0 && b.noteCount === 0) continue
      if (a.noteCount === 0) changes.push({ sectionId: section.sectionId, rowId: row.id, kind: "added" })
      else if (b.noteCount === 0) changes.push({ sectionId: section.sectionId, rowId: row.id, kind: "removed" })
      else if (a.signature !== b.signature) {
        changes.push({ sectionId: section.sectionId, rowId: row.id, kind: "changed", detail: changeDetail(a, b) })
      }
    }
  }
  return changes
}

/** 変化を「サビ：弦（高音）・ベルを足す、パッドを外す」のようなセクションごとの文にする */
export function describeArrangementChanges(
  changes: ArrangementCellChange[],
  sections: Array<{ sectionId: string; name: string }>,
): string[] {
  const lines: string[] = []
  for (const section of sections) {
    const own = changes.filter((change) => change.sectionId === section.sectionId)
    if (own.length === 0) continue
    const labelsOf = (kind: ArrangementCellChangeKind) =>
      own.filter((change) => change.kind === kind).map((change) => partRowLabel(change.rowId))
    const parts: string[] = []
    const added = labelsOf("added")
    if (added.length > 0) parts.push(`${added.join("・")}を足す`)
    for (const change of own.filter((candidate) => candidate.kind === "changed")) {
      parts.push(`${partRowLabel(change.rowId)}の${change.detail ?? "フレーズを変える"}`)
    }
    const removed = labelsOf("removed")
    if (removed.length > 0) parts.push(`${removed.join("・")}を外す`)
    lines.push(`${section.name}：${parts.join("、")}`)
  }
  return lines
}

export function emptyArrangementChat(): ArrangementChatState {
  return {
    updatedAt: new Date(0).toISOString(),
    messages: [],
    versions: [],
    currentVersionId: null,
    confirmedConstraints: [],
  }
}

/** いまの全曲アレンジから、次の版を作り直すための生成条件を取り出す */
export function recipeFromArrangement(arrangement: FullSongArrangement): ArrangementRecipe {
  return {
    brief: arrangement.plan.brief,
    ...(arrangement.plan.directive ? { directive: arrangement.plan.directive } : {}),
    seed: arrangement.plan.seed,
    revision: Math.max(0, ...arrangement.tracks.map((track) => track.generationRevision)),
  }
}

/** 版の一覧の中で、いま鳴っている全曲アレンジに当たる版(相談の外で作り直された場合はなし) */
export function currentArrangementVersion(
  chat: ArrangementChatState | undefined,
  arrangement: FullSongArrangement | null | undefined,
): ArrangementVersion | null {
  if (!chat) return null
  const current = chat.versions.find((version) => version.id === chat.currentVersionId)
  if (!current) return null
  return current.arrangementId === (arrangement?.id ?? null) ? current : null
}

/**
 * 版を積む。いまの全曲アレンジがどの版とも一致しないとき(初回や相談の外で作り直した後)は、
 * まずそれを「これまでの全曲アレンジ」または「追加パートなし」として版に残し、あとで戻れるようにする。
 */
export function pushArrangementVersion(
  chat: ArrangementChatState,
  previousArrangement: FullSongArrangement | null | undefined,
  next: { id: string; label: string; createdAt: string; recipe: ArrangementRecipe; arrangementId: string; changes: ArrangementCellChange[] },
): ArrangementChatState {
  let versions = [...chat.versions]
  const baseline = currentArrangementVersion(chat, previousArrangement)
  const baseVersionId = baseline?.id ?? `${next.id}:base`
  if (!baseline) {
    versions.push({
      id: `${next.id}:base`,
      number: 0,
      label: previousArrangement ? "これまでの全曲アレンジ" : "追加パートなし（原曲のみ）",
      createdAt: next.createdAt,
      source: previousArrangement ? "existing" : "original",
      ...(previousArrangement ? { recipe: recipeFromArrangement(previousArrangement) } : {}),
      arrangementId: previousArrangement?.id ?? null,
      changes: [],
    })
  }
  versions.push({
    ...next,
    number: 0,
    source: "chat",
    ...(next.recipe.scopeSectionIds?.length ? { baseVersionId } : {}),
  })
  versions = versions.slice(-MAX_ARRANGEMENT_VERSIONS)
  // 版番号は作った順に1から振り直さず、既存の番号を保ったまま続きの番号を付ける
  let lastNumber = Math.max(0, ...chat.versions.map((version) => version.number))
  versions = versions.map((version) => {
    if (version.number > 0) return version
    lastNumber += 1
    return { ...version, number: lastNumber }
  })
  return {
    ...chat,
    updatedAt: next.createdAt,
    versions,
    currentVersionId: next.id,
  }
}

/**
 * 一部のセクションだけを差し替えた全曲アレンジ。scope のセクションは generated の音、
 * それ以外は base の音を使う。base がない(追加パートなし)ときは scope の外は鳴らさない。
 */
export function spliceArrangement(
  base: FullSongArrangement | null | undefined,
  generated: FullSongArrangement,
  scopeSectionIds: readonly string[] | undefined,
): FullSongArrangement {
  if (!scopeSectionIds || scopeSectionIds.length === 0) return generated
  const scope = new Set(scopeSectionIds)
  const baseTracks = new Map((base?.tracks ?? []).map((track) => [track.id, track]))
  const trackIds = [...new Set([...(base?.tracks ?? []).map((track) => track.id), ...generated.tracks.map((track) => track.id)])]
  const generatedTracks = new Map(generated.tracks.map((track) => [track.id, track]))
  const tracks = trackIds.map((trackId) => {
    const kept = baseTracks.get(trackId)
    const fresh = generatedTracks.get(trackId)
    const template = kept ?? fresh!
    return {
      ...template,
      muted: kept?.muted ?? fresh?.muted ?? false,
      generationRevision: fresh?.generationRevision ?? template.generationRevision,
      notes: [
        ...(kept?.notes ?? []).filter((note) => !scope.has(note.sectionId)),
        ...(fresh?.notes ?? []).filter((note) => scope.has(note.sectionId)),
      ].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch),
    }
  })
  const basePlanSections = new Map((base?.plan.sections ?? []).map((section) => [section.sectionId, section]))
  return {
    ...generated,
    id: `${base?.id ?? "none"}|${generated.id}@${[...scope].sort().join(",")}`,
    plan: {
      ...generated.plan,
      sections: generated.plan.sections.map((section) =>
        scope.has(section.sectionId) ? section : basePlanSections.get(section.sectionId) ?? section,
      ),
    },
    tracks,
  }
}

/** 版の全曲アレンジを作り直す。一部だけ作り直した版は、元になった版から順にたどって組み立てる */
export function arrangementForVersion(
  versions: readonly ArrangementVersion[],
  versionId: string,
  generate: (recipe: ArrangementRecipe) => FullSongArrangement,
  depth = 0,
): FullSongArrangement | undefined {
  const version = versions.find((candidate) => candidate.id === versionId)
  if (!version?.recipe) return undefined
  const generated = generate(version.recipe)
  const scope = version.recipe.scopeSectionIds
  // 元の版が履歴から消えている(古い版の整理)ときは、作り直した音だけを使う
  const base = scope?.length && version.baseVersionId && depth < MAX_ARRANGEMENT_VERSIONS
    ? arrangementForVersion(versions, version.baseVersionId, generate, depth + 1)
    : undefined
  return withoutPartRows(spliceArrangement(base, generated, scope), version.recipe.removeRowIds, scope)
}

/** 指定したパートの音を、範囲(なければ曲全体)の中から外す */
export function withoutPartRows(
  arrangement: FullSongArrangement,
  rowIds: readonly ArrangementPartRowId[] | undefined,
  scopeSectionIds: readonly string[] | undefined,
): FullSongArrangement {
  if (!rowIds || rowIds.length === 0) return arrangement
  const trackIds = new Set(ARRANGEMENT_PART_ROWS.filter((row) => rowIds.includes(row.id)).flatMap((row) => row.trackIds))
  const scope = scopeSectionIds?.length ? new Set(scopeSectionIds) : null
  return {
    ...arrangement,
    id: `${arrangement.id}-${[...rowIds].sort().join(",")}`,
    tracks: arrangement.tracks.map((track) =>
      trackIds.has(track.id)
        ? { ...track, notes: track.notes.filter((note) => scope !== null && !scope.has(note.sectionId)) }
        : track,
    ),
  }
}

const REMOVAL_WORDS: Array<{ pattern: string; rows: ArrangementPartRowId[] }> = [
  { pattern: "ドラム|打楽器|リズム隊", rows: ["drums"] },
  { pattern: "ベース|低音", rows: ["bass"] },
  { pattern: "パッド", rows: ["pad"] },
  { pattern: "ストリングス|弦楽器|弦", rows: ["strings-low", "strings-high"] },
  { pattern: "シンセ", rows: ["pulse"] },
  { pattern: "きらめき|ベル", rows: ["glass"] },
]

/**
 * 「パッドは引いて」「ドラムを抜く」のような、パートを外す指示を読み取る。
 * 「抜かないで」「外さずに」のような打ち消しは外す指示として扱わない。
 */
export function partRowsToRemove(texts: string[]): ArrangementPartRowId[] {
  const text = texts.join("\n")
  const rows = new Set<ArrangementPartRowId>()
  for (const { pattern, rows: targets } of REMOVAL_WORDS) {
    const regex = new RegExp(`(?:${pattern})(?:の音|の音色|パート)?(?:は|を|も)?(?:全部|すべて|いったん)?(外|抜|引|な[くし]|止|やめ)`, "g")
    for (const match of text.matchAll(regex)) {
      const after = text.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 4)
      if (/^(か|さ|め|か)?(ない|ず)/.test(after) || /^[かさ]なく/.test(after)) continue
      targets.forEach((row) => rows.add(row))
    }
  }
  return [...rows]
}
