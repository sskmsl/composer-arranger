import { useMemo, useState } from "react"
import { RefreshCw } from "lucide-react"
import { analyzeFullSongArrangement } from "@/melody-engine/arrangementGenerator"
import { useProjectStore } from "@/store/useProjectStore"
import { Button, Select } from "@/ui/primitives"

const STRENGTH_LABELS = ["静か", "控えめ", "中間", "強い", "最も強い"] as const

/** 生成で使う0〜100の強さを、画面の5段階の名前へ */
function strengthLabel(energy: number): string {
  if (energy <= 28) return STRENGTH_LABELS[0]
  if (energy <= 45) return STRENGTH_LABELS[1]
  if (energy <= 63) return STRENGTH_LABELS[2]
  if (energy <= 81) return STRENGTH_LABELS[3]
  return STRENGTH_LABELS[4]
}

/**
 * アレンジ画面「詳しい調整」の盛り上げ方。セクションごとの強さと、最も盛り上げる場所だけを決める。
 * ふだんは自動のままでよく、楽器ごとの細かい調整はアレンジ相談(言葉)かLogic Pro側で行う。
 */
export function ArrangementIntensityPanel() {
  const project = useProjectStore((state) => state.project)
  const setClimax = useProjectStore((state) => state.setArrangementDirectorClimax)
  const setSectionOverride = useProjectStore((state) => state.setArrangementDirectorSectionOverride)
  const regenerate = useProjectStore((state) => state.generateDirectionArrangement)
  const [busy, setBusy] = useState(false)
  const arrangement = project.fullSongArrangement
  const overrides = project.arrangementDirectorOverrides

  // 次に全曲を作るときに使われる強さ(いまの設定から計算)
  const analysis = useMemo(() => analyzeFullSongArrangement(project), [project])
  const climaxId = analysis.sections.reduce<string | null>(
    (found, section) => found ?? (section.energy >= 100 ? section.sectionId : null),
    null,
  )
  const climaxName = analysis.sections.find((section) => section.sectionId === climaxId)?.sectionName
  // いまの全曲アレンジと強さが違うセクションがあれば、作り直しを案内する
  const changed = Boolean(arrangement) && analysis.sections.some((section) => {
    const used = arrangement?.analysis.sections.find((item) => item.sectionId === section.sectionId)
    return used ? strengthLabel(used.energy) !== strengthLabel(section.energy) : false
  })

  const rebuild = async () => {
    if (!arrangement || busy) return
    setBusy(true)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    try {
      regenerate("盛り上げ方を変更", arrangement.plan.brief, arrangement.plan.directive ?? { intention: arrangement.plan.brief })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="intensity-heading" className="flex flex-col gap-3">
      <div>
        <h3 id="intensity-heading" className="text-[14px] font-semibold text-body-on-dark">盛り上げ方</h3>
        <p className="mt-1 text-[13px] leading-5 text-body-muted">
          セクションごとの強さです。ふだんは自動のままで大丈夫です。
        </p>
      </div>

      <label className="flex flex-wrap items-center gap-2 text-[13px] text-body-muted">
        最も盛り上げる場所
        <Select
          value={overrides?.climaxSectionId ?? "auto"}
          onChange={(event) => setClimax(event.target.value === "auto" ? null : event.target.value)}
          className="!py-1.5 text-[13px]"
        >
          <option value="auto">自動{climaxName && !overrides?.climaxSectionId ? `（いまは${climaxName}）` : ""}</option>
          {project.sections.map((section) => (
            <option key={section.id} value={section.id}>{section.name}</option>
          ))}
        </Select>
      </label>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {analysis.sections.map((section) => {
          const manual = overrides?.sections[section.sectionId]?.targetEnergy
          const isClimax = section.sectionId === climaxId
          return (
            <label
              key={section.sectionId}
              className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-hairline bg-white/[0.025] px-3 py-2"
            >
              <span className="min-w-0 truncate text-[14px] text-body-on-dark">{section.sectionName}</span>
              {isClimax ? (
                <span className="shrink-0 text-[13px] text-primary-on-dark">最も強い（盛り上げる場所）</span>
              ) : (
                <Select
                  aria-label={`${section.sectionName}の強さ`}
                  value={manual ?? "auto"}
                  onChange={(event) => setSectionOverride(section.sectionId, {
                    targetEnergy: event.target.value === "auto" ? null : Number(event.target.value) as 1 | 2 | 3 | 4 | 5,
                  })}
                  className="!py-1.5 text-[13px]"
                >
                  <option value="auto">{manual ? "自動" : `自動（${strengthLabel(section.energy)}）`}</option>
                  {STRENGTH_LABELS.map((label, index) => (
                    <option key={label} value={index + 1}>{label}</option>
                  ))}
                </Select>
              )}
            </label>
          )
        })}
      </div>

      {changed && (
        <div className="flex flex-col gap-3 rounded-md border border-primary/35 bg-primary/10 px-3 py-2.5 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-[13px] leading-5 text-body-on-dark">
            いまの全曲アレンジとは強さが違います。作り直すと反映されます（新しい版になるので、前の版にも戻せます）。
          </p>
          <Button onClick={rebuild} disabled={busy} className="justify-center sm:shrink-0">
            <RefreshCw size={14} /> {busy ? "作っています…" : "この強さで作り直す"}
          </Button>
        </div>
      )}
    </section>
  )
}
