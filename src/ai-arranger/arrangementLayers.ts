import type { ArrangementLayerKind, ArrangementLayerProposal } from "@/core/arrangementChat"
import type { ComposerProject } from "@/core/project"
import type { CounterCreativeRisk, CounterGeneratorStyle, ReactiveLayerCandidate } from "@/core/reactiveLayer"
import { normalizeSectionTimeline } from "@/core/sectionTimeline"
import { generateCounterCandidates } from "@/melody-engine/counterGenerator"
import { DEFAULT_DECORATION_SETTINGS, generateDecorationCandidates } from "@/melody-engine/decorationGenerator"
import { generateFlowingCounterLine } from "@/melody-engine/flowingCounterLine"
import { parseTimeSignature } from "@/core/section"
import { notesByPartRole } from "@/core/sectionLayers"
import { counterGenerationInput, decorationGenerationInput, performGeneratedNotes } from "@/store/generationInputs"

/**
 * アレンジ相談から、主旋律の後ろで鳴る対旋律と、フレーズの切れ目に入る合いの手(装飾)を作る。
 * 旋律タブの対旋律・装飾と同じエンジンを使い、セクションごとに最も良い候補を1つ選んで付ける。
 */

const COUNTER_WORDS = /対旋律|カウンター|裏メロ|オブリ|メロディ(?:ー)?の(?:後ろ|裏|下|上)|主旋律の(?:後ろ|裏|下|上)|(?:後ろ|裏)で(?:鳴|流|歌)|アレンジメロディ|サブメロ/
const FILL_WORDS = /合いの手|フィル|おかず|装飾|(?:隙間|すき間|休符)(?:を|に)(?:埋|入れ|何か)|間を埋|フレーズ(?:の|と)?(?:間|切れ目|終わり|区切り|合間)|フレーズ間/
const REMOVE_TAIL = "(?:は|を|も)?(?:全部|すべて|いったん)?(?:外|抜|なく|なし|消|止|やめ|いらない|要らない)"

/** 相談文から、対旋律・合いの手のどちらの話か(どちらでもなければ null) */
export function layerKindFromText(texts: string[]): ArrangementLayerKind | null {
  const text = texts.join("\n")
  const counter = text.search(COUNTER_WORDS)
  const fill = text.search(FILL_WORDS)
  if (counter < 0 && fill < 0) return null
  if (counter < 0) return "fill"
  if (fill < 0) return "counter"
  // 両方出てきたら、先に言った方を優先する
  return counter <= fill ? "counter" : "fill"
}

/** 「対旋律は外して」のような、外す指示 */
export function layerRemovalFromText(texts: string[]): ArrangementLayerKind | null {
  const text = texts.join("\n")
  if (new RegExp(`(?:${COUNTER_WORDS.source})${REMOVE_TAIL}`).test(text)) return "counter"
  if (new RegExp(`(?:${FILL_WORDS.source})${REMOVE_TAIL}`).test(text)) return "fill"
  return null
}

const STYLE_WORDS: Array<{ pattern: RegExp; style: CounterGeneratorStyle }> = [
  { pattern: /弦|ストリングス|チェロ|バイオリン|ヴァイオリン|ビオラ/, style: "string-answer" },
  { pattern: /ピアノ|鍵盤|エレピ/, style: "piano-echo" },
  { pattern: /ベル|グロッケン|鉄琴|オルゴール|チェレスタ/, style: "bell-response" },
  { pattern: /ギター/, style: "guitar-fill" },
  { pattern: /シンセ|パッド/, style: "synth-whisper" },
]

/** 相談文から、対旋律の楽器の性格と攻め具合を読む(書かれていなければエンジンに任せる) */
export function counterPreferencesFromText(text: string): {
  preferredStyles?: CounterGeneratorStyle[]
  preferredCreativeRisks?: CounterCreativeRisk[]
} {
  const style = STYLE_WORDS.find((entry) => entry.pattern.test(text))?.style
  const risk: CounterCreativeRisk | undefined = /実験|意外|大胆に|尖/.test(text)
    ? "radical"
    : /攻め|動き(?:を|が)?(?:多|大き)|目立/.test(text)
      ? "bold"
      : /控えめ|シンプル|さりげな|静か|邪魔しない/.test(text)
        ? "focused"
        : undefined
  return {
    ...(style ? { preferredStyles: [style] } : {}),
    ...(risk ? { preferredCreativeRisks: [risk] } : {}),
  }
}

/**
 * 対旋律の作り方。flowing は主旋律の後ろでずっと流れる線、answer は主旋律の隙間に短く答える線(従来のエンジン)
 */
export type CounterMode = "flowing-below" | "flowing-above" | "answer"

export const COUNTER_MODE_TEXT: Record<CounterMode, { title: string; summary: string }> = {
  "flowing-below": {
    title: "主旋律の下で流れる対旋律",
    summary: "主旋律の下で、コードの3度・7度をなめらかにつなぐもう一本の線が流れ続けます。主旋律が伸ばす所で動き、細かく動く所では伸ばします。",
  },
  "flowing-above": {
    title: "主旋律の上で流れる対旋律",
    summary: "主旋律より高い所で、弦の高音のように長くなめらかな線が流れ続けます。主旋律が伸ばす所で動き、細かく動く所では伸ばします。",
  },
  answer: {
    title: "主旋律に答える対旋律",
    summary: "主旋律の休みや伸ばしの所だけに、短く答えるフレーズを置きます。",
  },
}

/** 相談文から対旋律の作り方を読む(書かれていなければ null) */
export function counterModeFromText(text: string): CounterMode | null {
  if (/答え|呼応|問いかけ|掛け合い|やりとり|やり取り/.test(text)) return "answer"
  if (/上で|上に|上から|高い(?:所|音域)|高音で/.test(text)) return "flowing-above"
  if (/下で|下に|下から|低い(?:所|音域)|低音で/.test(text)) return "flowing-below"
  return null
}

const LAYER_LABELS: Record<ArrangementLayerKind, string> = { counter: "対旋律", fill: "合いの手" }

export function layerLabel(kind: ArrangementLayerKind): string {
  return LAYER_LABELS[kind]
}

function bestCandidate<T extends { quality: { overallQuality: number } }>(candidates: T[]): T | undefined {
  return [...candidates].sort((a, b) => b.quality.overallQuality - a.quality.overallQuality)[0]
}

/**
 * 対象セクションごとに対旋律または合いの手を1つずつ作る。
 * 対旋律は主旋律が必要なので、主旋律のないセクションは理由付きで外す。
 */
export function buildLayerProposal(
  project: ComposerProject,
  kind: ArrangementLayerKind,
  options: { scopeSectionIds?: string[]; seed: number; text: string; counterMode?: CounterMode },
): ArrangementLayerProposal {
  const sections = normalizeSectionTimeline(project.sections)
    .filter((section) => !options.scopeSectionIds?.length || options.scopeSectionIds.includes(section.id))
  const candidates: ReactiveLayerCandidate[] = []
  const skipped: Array<{ sectionId: string; reason: string }> = []
  const preferences = counterPreferencesFromText(options.text)
  const counterMode = options.counterMode ?? counterModeFromText(options.text) ?? "flowing-below"
  const beatsPerBar = parseTimeSignature(project.song.timeSignature).beatsPerBar
  sections.forEach((section, index) => {
    const seed = (options.seed + index * 7919) >>> 0
    if (kind === "counter") {
      const input = counterGenerationInput(project, section.id, seed)
      if (!input) {
        skipped.push({ sectionId: section.id, reason: "主旋律がまだありません" })
        return
      }
      if (counterMode !== "answer") {
        const notes = generateFlowingCounterLine({
          melody: notesByPartRole(input.melody, "lead"),
          chords: input.chords,
          key: input.key,
          totalBeats: input.totalBeats,
          beatsPerBar,
          seed,
          placement: counterMode === "flowing-above" ? "above" : "below",
        })
        if (notes.length === 0) {
          skipped.push({ sectionId: section.id, reason: "コードを読み取れませんでした" })
          return
        }
        candidates.push(finish(project, section.id, flowingCandidate(section.id, input.melody.id, notes, seed, preferences.preferredStyles?.[0]), "counter-voice"))
        return
      }
      const chosen = bestCandidate(generateCounterCandidates({ ...input, ...preferences, poolSize: 24, finalCount: 4 }))
      if (!chosen) {
        skipped.push({ sectionId: section.id, reason: "主旋律に隙間が少なく、入れる余地がありません" })
        return
      }
      candidates.push(finish(project, section.id, chosen, "counter-voice"))
      return
    }
    const input = decorationGenerationInput(project, section.id, seed, DEFAULT_DECORATION_SETTINGS)
    if (!input) {
      skipped.push({ sectionId: section.id, reason: "コード進行がありません" })
      return
    }
    const chosen = bestCandidate(generateDecorationCandidates({ ...input, candidateCount: 4 }))
    if (!chosen) {
      skipped.push({ sectionId: section.id, reason: "合いの手を入れる余地がありません" })
      return
    }
    candidates.push(finish(project, section.id, chosen, "transition-color"))
  })
  return { kind, candidates, ...(skipped.length > 0 ? { skipped } : {}) }
}

/** 流れる対旋律を、旋律タブの対旋律と同じ候補の形にする */
function flowingCandidate(
  sectionId: string,
  melodyVariantId: string,
  notes: ReactiveLayerCandidate["notes"],
  seed: number,
  style: CounterGeneratorStyle | undefined,
): ReactiveLayerCandidate {
  return {
    id: "",
    batchId: "",
    sectionId,
    targetMelodyVariantId: melodyVariantId,
    kind: "counter",
    role: "counterline",
    generatorStyle: style ?? "string-answer",
    name: "流れる対旋律",
    notes,
    seed,
    // 主旋律との交差・同音・半音の重なりは作る段階で避けている
    quality: {
      melodyRespect: 90, harmonicFit: 92, gapUsage: 70, registerSeparation: 88,
      motifRelationship: 60, sectionFit: 80, transitionValue: 70, overallQuality: 82,
    },
    collisions: {
      samePitchOverlapBeats: 0, minorSecondOverlapBeats: 0, protectedMomentOverlapBeats: 0,
      voiceCrossingCount: 0, simultaneousAttackCount: 0, hasBlockingCollision: false,
    },
    createdAt: "",
  }
}

/** 候補に演奏情報とIDを付けて、曲に加えられる形にする(旋律タブで作る候補と同じ手順) */
function finish(
  project: ComposerProject,
  sectionId: string,
  candidate: ReactiveLayerCandidate,
  role: "counter-voice" | "transition-color",
): ReactiveLayerCandidate {
  const identified = candidate.notes.map((note) => ({ ...note, id: crypto.randomUUID() }))
  // 流れる対旋律は音を切らずにつなぐ(答える対旋律用の演奏処理は、主旋律に場所を譲るため音を短くする)
  const flowing = candidate.role === "counterline"
  const performed = flowing ? null : performGeneratedNotes(project, sectionId, identified, role)
  return {
    ...candidate,
    id: crypto.randomUUID(),
    batchId: `chat:${sectionId}`,
    sectionId,
    name: flowing ? "相談の対旋律（流れる線）" : `相談の${role === "counter-voice" ? "対旋律" : "合いの手"}`,
    notes: performed?.notes ?? identified,
    ...(performed ? { performanceSpec: performed.performanceSpec } : {}),
    createdAt: new Date().toISOString(),
  }
}

/** 外す案(候補は作らず、対象セクションから外すだけ) */
export function removalLayerProposal(
  project: ComposerProject,
  kind: ArrangementLayerKind,
  scopeSectionIds?: string[],
): ArrangementLayerProposal {
  const assigned = kind === "counter" ? project.sectionReactiveLayerAssignments : project.sectionDecorationLayerAssignments
  const removeSectionIds = Object.keys(assigned ?? {})
    .filter((sectionId) => !scopeSectionIds?.length || scopeSectionIds.includes(sectionId))
  return { kind, candidates: [], removeSectionIds }
}
