import { useState } from "react"
import { Play, Square } from "lucide-react"
import { partRowLabel, type ArrangementCellChange, type ArrangementMatrixSection } from "@/core/arrangementChat"
import { Button } from "@/ui/primitives"

/** 最初に見せる区間の数。残りは「残りを表示」で開く(画面を広く取らない)。 */
const VISIBLE_SECTIONS = 6

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
          <div className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((section) => (
              <section key={section.sectionId} aria-label={`${section.name}の変更内容`} className="min-w-0 rounded-md bg-surface-tile-2 px-2.5 py-2">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <h5 className="min-w-0 truncate text-[13px] font-semibold text-body-on-dark">
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
                <ul className="mt-1.5 flex flex-wrap gap-1 text-[12px] leading-5 text-body-muted">
                  {changes.filter((change) => change.sectionId === section.sectionId).map((change) => (
                    <li key={`${change.rowId}:${change.kind}`} className="rounded-pill bg-white/6 px-2 py-0.5">
                      {partRowLabel(change.rowId)}{change.kind === "added" ? (proposal ? "を加える" : "を追加") : change.kind === "removed" ? (proposal ? "を休ませる" : "は休止") : `：${change.detail ?? "フレーズを変更"}`}
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
