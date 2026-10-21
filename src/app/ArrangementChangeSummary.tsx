import { Play, Square } from "lucide-react"
import { partRowLabel, type ArrangementCellChange, type ArrangementMatrixSection } from "@/core/arrangementChat"
import { Button } from "@/ui/primitives"

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
  const sections = matrix.filter((section) => changes.some((change) => change.sectionId === section.sectionId))
  const playLabel = (sectionId: string, proposed: boolean) => playingSectionId === sectionId && playingProposal === proposed
    ? <><Square size={12} aria-hidden="true" /> 停止</>
    : <><Play size={12} aria-hidden="true" /> {proposed ? "変更案を聴く" : proposal ? "変更前を聴く" : "この箇所を聴く"}</>

  return (
    <div className="flex min-w-0 flex-col gap-3" aria-label={proposal ? "未適用の変更案" : changes.length ? "適用済みの変更内容" : "いまのアレンジ"}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[14px] font-semibold text-body-on-dark">{proposal ? "変更案" : changes.length ? "今回の変更" : "いまのアレンジ"}</h4>
        <span className={`rounded-pill px-2 py-0.5 text-[12px] ${proposal ? "bg-amber-300/15 text-amber-200" : "bg-emerald-400/15 text-emerald-200"}`}>
          {proposal ? "未適用" : changes.length ? "適用済み" : "いまのアレンジ"}
        </span>
      </div>
      {proposal && (
        <div className="text-[13px] leading-6">
          <p className="font-medium text-body-on-dark">{proposal.title}</p>
          {proposal.summary && <p className="break-words text-body-muted">{proposal.summary}</p>}
        </div>
      )}
      {sections.length === 0 ? (
        <p className="text-[13px] leading-6 text-body-muted">
          {proposal ? "パートの追加・休止や、音の並びの変更はありません。" : "比較できる変更はありません。詳しく見ると、いまのパート構成を確認できます。"}
        </p>
      ) : (
        <div className="grid min-w-0 gap-3 md:grid-cols-2">
          {sections.map((section) => (
            <section key={section.sectionId} aria-label={`${section.name}の変更内容`} className="min-w-0 rounded-lg bg-surface-tile-2 p-3">
              <h5 className="text-[13px] font-semibold text-body-on-dark">
                {section.name} <span className="font-normal text-ink-soft">{section.startBar}〜{section.endBar}小節</span>
              </h5>
              <ul className="mt-2 flex flex-col gap-1 text-[13px] leading-6 text-body-muted">
                {changes.filter((change) => change.sectionId === section.sectionId).map((change) => (
                  <li key={`${change.rowId}:${change.kind}`}>
                    {partRowLabel(change.rowId)}{change.kind === "added" ? (proposal ? "を加える" : "を追加") : change.kind === "removed" ? (proposal ? "を休ませる" : "は休止") : `：${change.detail ?? "フレーズを変更"}`}
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="dark" aria-label={playingSectionId === section.sectionId && !playingProposal ? `${section.name}の${proposal ? "変更前" : "いまのアレンジ"}の再生を停止` : `${section.name}の${proposal ? "変更前" : "いまのアレンジ"}を聴く`} onClick={() => onPlayCurrent(section.sectionId)}>
                  {playLabel(section.sectionId, false)}
                </Button>
                {proposal && onPlayProposal && (
                  <Button variant="dark" aria-label={playingSectionId === section.sectionId && playingProposal ? `${section.name}の変更案の再生を停止` : `${section.name}の変更案を聴く`} onClick={() => onPlayProposal(section.sectionId)}>
                    {playLabel(section.sectionId, true)}
                  </Button>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
      {proposal && onApply && (
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
          <Button onClick={onApply}>この案を使う</Button>
          <p className="text-[12px] leading-5 text-ink-soft">この案をまとめて適用します。試聴だけでは変更されません。</p>
        </div>
      )}
    </div>
  )
}
