export type ArrangementSoundTarget =
  | "selected-section"
  | "intro"
  | "verse"
  | "pre"
  | "chorus"
  | "bridge"
  | "interlude"
  | "final"
  | "outro"
  | "whole-song"

export type ArrangementSoundRole =
  | "stabs"
  | "pulse"
  | "pad"
  | "bass"
  | "strings"
  | "bell"
  | "counter"
  | "transition"
  | "percussion"
  | "silence"

export interface ArrangementSoundInstruction {
  enabled: boolean
  target: ArrangementSoundTarget
  targetSectionId?: string
  role: ArrangementSoundRole
  material: "single-note" | "dyad" | "chord" | "arpeggio" | "root" | "melody-fragment" | "noise"
  behavior: "hit" | "riff" | "pulse" | "sustain" | "swell" | "answer" | "fill" | "silence"
  articulation: "short" | "medium" | "long" | "legato"
  repetition: "none" | "exact" | "evolving"
  register: "low" | "middle" | "high"
  motion: "ascending" | "descending" | "wave" | "static"
  /** 1小節内の四分音符単位の発音位置。空ならBehaviorから生成側が決める。 */
  rhythmSteps: number[]
  preserveMelody: boolean
  source: string
}

function targetFrom(source: string): ArrangementSoundTarget {
  if (/イントロ|曲の頭|冒頭|intro/.test(source)) return "intro"
  if (/aメロ|verse/.test(source)) return "verse"
  if (/bメロ|プレコーラス|pre[ -]?chorus/.test(source)) return "pre"
  if (/ラスサビ|最後のサビ|final/.test(source)) return "final"
  if (/サビ|chorus/.test(source)) return "chorus"
  if (/ブリッジ|bridge/.test(source)) return "bridge"
  if (/間奏|interlude/.test(source)) return "interlude"
  if (/アウトロ|outro|終わり/.test(source)) return "outro"
  if (/全曲|曲全体|whole/.test(source)) return "whole-song"
  return "selected-section"
}

function roleFrom(source: string): ArrangementSoundRole | null {
  if (/無音|何も鳴らさ|音を入れない|silence/.test(source)) return "silence"
  if (/ベル|グラス|鐘|bell|glass/.test(source)) return "bell"
  if (/対旋律|カウンター|受け答え|counter/.test(source)) return "counter"
  if (/つなぎ|移行|フィル|transition|fill/.test(source)) return "transition"
  if (/ストリング|弦|strings?|violin|cello/.test(source)) return "strings"
  if (/パッド|pad|持続和音|伸ばす和音/.test(source)) return "pad"
  if (/ベース|低音|bass/.test(source)) return "bass"
  if (/ドラム|打楽器|パーカッション|太鼓|drum|percussion/.test(source)) return "percussion"
  if (/アルペジオ|分散和音|arpeggio|arp/.test(source)) return "pulse"
  if (/和音|コード|スタブ|chord|stab/.test(source)) return "stabs"
  if (/単音|シンセ|リフ|反復音|pulse|riff|フレーズ/.test(source)) return "pulse"
  return null
}

function rhythmStepsFrom(source: string, behavior: ArrangementSoundInstruction["behavior"]): number[] {
  if (/裏拍|オフビート|off[ -]?beat/.test(source)) return [0.5, 1.5, 2.5, 3.5]
  if (/16分|sixteenth/.test(source)) return [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75]
  if (/8分|eighth/.test(source)) return [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
  if (/4分|四分|quarter/.test(source)) return [0, 1, 2, 3]
  if (/まばら|少なく|疎ら|sparse/.test(source)) return [0, 2.5]
  if (behavior === "riff") return [0, 0.75, 1.5, 2.75]
  if (behavior === "pulse") return [0.5, 1.5, 2.5, 3.5]
  if (behavior === "hit") return [0, 2.5]
  return []
}

/**
 * 自然文の「どんな音にしたいか」を、決定論的Generatorが実行できる演奏指示へ変換する。
 * AIの構造化結果がない場合の安全網でもあり、特定の一例に限定しない。
 */
export function arrangementSoundInstructionFromText(source: string): ArrangementSoundInstruction | undefined {
  const normalized = source.normalize("NFKC").toLocaleLowerCase().trim()
  if (!normalized) return undefined
  const role = roleFrom(normalized)
  if (!role) return undefined
  const hasExplicitTarget = /イントロ|曲の頭|冒頭|aメロ|bメロ|プレコーラス|ラスサビ|最後のサビ|サビ|ブリッジ|間奏|アウトロ|全曲|曲全体|intro|verse|pre[ -]?chorus|chorus|bridge|interlude|outro|whole/.test(normalized)
  const hasConcreteSoundShape = /単音|2音|二音|和音|コード|分散和音|アルペジオ|反復|繰り返|リフ|刻|短く|長く|伸ば|スウェル|徐々に|だんだん|裏拍|[48]分|16分|つなぎ|つなぐ|受け答え|フィル|無音|single|dyad|chord|arpeggio|riff|repeat|short|long|swell|off[ -]?beat|eighth|sixteenth|fill|silence/.test(normalized)
  if (!hasExplicitTarget && !hasConcreteSoundShape) return undefined
  const material: ArrangementSoundInstruction["material"] = role === "silence"
    ? "noise"
    : /分散和音|アルペジオ|arpeggio|arp/.test(normalized)
        ? "arpeggio"
      : /和音|コード|chord|stab/.test(normalized)
        ? "chord"
        : /2音|二音|dyad/.test(normalized)
          ? "dyad"
          : /ルート|根音|root/.test(normalized)
            ? "root"
            : /メロディ.*一部|主旋律.*一部|melody.*fragment/.test(normalized)
              ? "melody-fragment"
              : role === "percussion" ? "noise" : "single-note"
  const behavior: ArrangementSoundInstruction["behavior"] = role === "silence"
    ? "silence"
    : /スウェル|だんだん.*大き|徐々に.*大き|盛り上が|swell/.test(normalized)
      ? "swell"
      : /受け答え|応答|answer/.test(normalized)
        ? "answer"
        : /つなぎ|つなぐ|移行|フィル|fill|transition/.test(normalized)
          ? "fill"
          : /リフ|riff/.test(normalized)
            ? "riff"
            : /反復|繰り返|刻|パルス|pulse|loop/.test(normalized)
              ? "pulse"
              : /伸ば|持続|sustain/.test(normalized)
                ? "sustain"
                : "hit"
  const articulation: ArrangementSoundInstruction["articulation"] = /短く|打撃|叩|歯切れ|スタッカート|staccato/.test(normalized)
    ? "short"
    : /長く|伸ば|持続|ロング|sustain/.test(normalized)
      ? "long"
      : /滑らか|レガート|legato/.test(normalized)
        ? "legato"
        : "medium"
  const repetition: ArrangementSoundInstruction["repetition"] = /少しずつ変|徐々に変|発展|変化させ|evolv/.test(normalized)
    ? "evolving"
    : /反復|繰り返|リフ|riff|ループ|loop|刻/.test(normalized)
      ? "exact"
      : "none"
  const register: ArrangementSoundInstruction["register"] = /高い|高音|高域|上の音|high/.test(normalized)
    ? "high"
    : /低い|低音|低域|下の音|low|bass/.test(normalized)
      ? "low"
      : "middle"
  const motion: ArrangementSoundInstruction["motion"] = /上昇|上がる|上行|ascending|rise/.test(normalized)
    ? "ascending"
    : /下降|下がる|下行|descending|fall/.test(normalized)
      ? "descending"
      : /波|上下|wave/.test(normalized)
        ? "wave"
        : "static"
  return {
    enabled: true,
    target: targetFrom(normalized),
    role,
    material,
    behavior,
    articulation,
    repetition,
    register,
    motion,
    rhythmSteps: rhythmStepsFrom(normalized, behavior),
    preserveMelody: !/主旋律.*変え|メロディ.*変え|rewrite melody/.test(normalized),
    source: source.trim().slice(0, 500),
  }
}

export function requestsPercussiveChordRiff(source: string): boolean {
  const instruction = arrangementSoundInstructionFromText(source)
  return instruction?.material === "chord"
    && instruction.articulation === "short"
    && (instruction.behavior === "riff" || instruction.behavior === "pulse")
}

export function arrangementSoundInstructionLabel(instruction: ArrangementSoundInstruction): string {
  const material = instruction.material === "arpeggio" ? "分散和音" : instruction.material === "chord" ? "和音" : instruction.material === "dyad" ? "2音" : instruction.material === "root" ? "低い基準音" : instruction.material === "noise" ? "打楽器" : "単音"
  const behavior = instruction.behavior === "riff" ? "短い型を反復" : instruction.behavior === "pulse" ? "一定のリズムで反復" : instruction.behavior === "sustain" ? "長く伸ばす" : instruction.behavior === "swell" ? "徐々に大きくする" : instruction.behavior === "answer" ? "主旋律へ受け答えする" : instruction.behavior === "fill" ? "次の部分へつなぐ" : instruction.behavior === "silence" ? "何も鳴らさない" : "要所で鳴らす"
  return `${material}を${behavior}`
}

export function arrangementSoundInstructionAppliesTo(
  instruction: ArrangementSoundInstruction | undefined,
  sectionId: string,
  semanticRole: string | undefined,
  directedSectionId?: string,
): boolean {
  if (!instruction?.enabled) return false
  if (instruction.targetSectionId) return instruction.targetSectionId === sectionId
  if (instruction.target === "whole-song") return true
  if (instruction.target === "selected-section") return !directedSectionId || directedSectionId === sectionId
  if (instruction.target === "interlude") return semanticRole === "other" || semanticRole === "bridge"
  return instruction.target === semanticRole
}
