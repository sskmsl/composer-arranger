import { useState } from "react"
import { Play, Square } from "lucide-react"
import { partRowLabel, type ArrangementCellChange, type ArrangementMatrixSection } from "@/core/arrangementChat"
import { Button } from "@/ui/primitives"

/** 最初に見せる区間の数。残りは「残りを表示」で開く(画面を広く取らない)。 */
const VISIBLE_SECTIONS = 6

/** 変更の種類ごとの見分け(色だけに頼らず、ラベルの文字と記号も付ける) */
const KIND_STYLE: Record<ArrangementCellChange["kind"], { label: string; mark: string; badge: string; text: string }> = {
  added: { label: "追加", mark: "＋", badge: "bg-emerald-400/20 text-emerald-200", text: "text-body-on-dark" },
  changed: { label: "変更", mark: "↻", badge: "bg-amber-300/20 text-amber-200", text: "text-body-on-dark" },
  removed: { label: "休み", mark: "－", badge: "bg-rose-400/20 text-rose-200", text: "text-body-muted" },
}
const KIND_ORDER: ArrangementCellChange["kind"][] = ["added", "changed", "removed"]

function changeText(change: ArrangementCellChange, proposed: boolean): string {
  const part = partRowLabel(change.rowId)
  if (change.kind === "added") return `${part}${proposed ? "を加える" : "を追加"}`
  if (change.kind === "removed") return `${part}${proposed ? "を休ませる" : "は休止"}`
  return `${part}：${change.detail ?? "フレーズを変更"}`
}

const LISTEN_BUTTON = "inline-flex items-center gap-1 whitespace-nowrap rounded-sm bg-white/10 px-2 py-1 text-[12px] leading-4 text-body-on-dark transition hover:bg-white/15 active:scale-95"

export function ArrangementChangeSummary({
  matrix, changes, proposal, playingSectionId, playingProposal, onPlayCurrent, onPlayProposal, onApply,
}: {
  matrix: ArrangementMatrixSection[]
  changes: ArrangementCellChange[]
  proposal?: { title: string; summary: string } | null
  playingSectionId: string | null
  playingProposal: boolean
  onPlayCurrent: (sectionId: string) => void
  onPlayProposal?: (sectionId: string) => void
  onApply?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const sections = matrix.filter((section) => changes.some((change) => change.sectionId === section.sectionId))
  const shown = expanded ? sections : sections.slice(0, VISIBLE_SECTIONS)
  const tally = KIND_ORDER.map((kind) => ({ kind, count: changes.filter((change) => change.kind === kind).length })).filter((item) => item.count > 0)
  const playLabel = (sectionId: string, proposed: boolean) => playingSectionId === sectionId && playingProposal === proposed
    ? <><Square size={12} aria-hidden="true" /> 停止</>
    : <><Play size={12} aria-hidden="true" /> {proposed ? "変更案を聴く" : proposal ? "変更前を聴く" : "この箇所を聴く"}</>

  return (
    <div className="flex min-w-0 flex-col gap-2" aria-label={proposal ? "未適用の変更案" : changes.length ? "適用済みの変更内容" : "いまのアレンジ"}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[14px] font-semibold text-body-on-dark">{proposal ? "変更案" : changes.length ? "今回の変更" : "いまのアレンジ"}</h4>
        <span className={`rounded-pill px-2 py-0.5 text-[12px] ${proposal ? "bg-amber-300/15 text-amber-200" : "bg-emerald-400/15 text-emerald-200"}`}>
          {proposal ? "未適用" : changes.length ? "適用済み" : "いまのアレンジ"}
        </span>
      </div>
      {tally.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-[13px] text-body-muted" aria-label="変更の件数">
          <span>{sections.length}区間で</span>
          {tally.map(({ kind, count }) => (
            <span key={kind} className={`rounded-pill px-2 py-0.5 font-medium ${KIND_STYLE[kind].badge}`}>
              {KIND_STYLE[kind].mark} {KIND_STYLE[kind].label} {count}
            </span>
          ))}
        </p>
      )}
      {proposal && (
        <div className="text-[13px] leading-5">
          <p className="font-medium text-body-on-dark">{proposal.title}</p>
          {proposal.summary && <p className="break-words text-body-muted">{proposal.summary}</p>}
        </div>
      )}
      {sections.length === 0 ? (
        <p className="text-[13px] leading-6 text-body-muted">
          {proposal ? "パートの追加・休止や、音の並びの変更はありません。" : "比較できる変更はありません。詳しく見ると、いまのパート構成を確認できます。"}
        </p>
      ) : (
        <>
          <div className="grid min-w-0 items-start gap-2 sm:grid-cols-2">
            {shown.map((section) => (
              <section key={section.sectionId} aria-label={`${section.name}の変更内容`} className="min-w-0 rounded-md border border-hairline bg-surface-tile-2 px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <h5 className="min-w-0 truncate text-[14px] font-semibold text-body-on-dark">
                    {section.name} <span className="font-normal text-ink-soft">{section.startBar}〜{section.endBar}小節</span>
                  </h5>
                  <div className="flex shrink-0 flex-wrap gap-1">
                    <button type="button" className={LISTEN_BUTTON} aria-label={playingSectionId === section.sectionId && !playingProposal ? `${section.name}の${proposal ? "変更前" : "いまのアレンジ"}の再生を停止` : `${section.name}の${proposal ? "変更前" : "いまのアレンジ"}を聴く`} onClick={() => onPlayCurrent(section.sectionId)}>
                      {playLabel(section.sectionId, false)}
                    </button>
                    {proposal && onPlayProposal && (
                      <button type="button" className={LISTEN_BUTTON} aria-label={playingSectionId === section.sectionId && playingProposal ? `${section.name}の変更案の再生を停止` : `${section.name}の変更案を聴く`} onClick={() => onPlayProposal(section.sectionId)}>
                        {playLabel(section.sectionId, true)}
                      </button>
                    )}
                  </div>
                </div>
                <ul className="mt-1.5 flex flex-col gap-1 border-t border-hairline pt-1.5 text-[13px] leading-5">
                  {changes
                    .filter((change) => change.sectionId === section.sectionId)
                    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
                    .map((change) => (
                      <li key={`${change.rowId}:${change.kind}`} className="flex items-baseline gap-2">
                        <span className={`w-14 shrink-0 rounded-sm px-1.5 py-0.5 text-center text-[12px] font-medium ${KIND_STYLE[change.kind].badge}`}>
                          {KIND_STYLE[change.kind].mark} {KIND_STYLE[change.kind].label}
                        </span>
                        <span className={`min-w-0 break-words ${KIND_STYLE[change.kind].text}`}>{changeText(change, Boolean(proposal))}</span>
                      </li>
                    ))}
                </ul>
              </section>
            ))}
          </div>
          {sections.length > VISIBLE_SECTIONS && (
            <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}
              className="self-start rounded-sm px-2 py-1 text-[12px] text-primary-on-dark hover:bg-white/8">
              {expanded ? "折りたたむ" : `残り${sections.length - VISIBLE_SECTIONS}区間を表示`}
            </button>
          )}
        </>
      )}
      {proposal && onApply && (
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-2">
          <Button onClick={onApply}>この案を使う</Button>
          <p className="text-[12px] leading-5 text-ink-soft">この案をまとめて適用します。試聴だけでは変更されません。</p>
        </div>
      )}
    </div>
  )
}
