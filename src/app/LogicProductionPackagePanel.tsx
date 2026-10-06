import { useMemo, useState } from "react"
import { clsx } from "clsx"
import { logicSoundPalette, logicSoundRows } from "@/midi/logicProductionPackage"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * Logic Pro用の音源と設定。曲全体MIDIに入るトラックごとに「おすすめ音源」と「一言の設定」だけを並べる。
 * MIDI自体は画面上部の「曲全体MIDI」で書き出す(ここでは同じものを重ねて出さない)。
 */
export function LogicProductionPackagePanel() {
  const project = useProjectStore((state) => state.project)
  const rows = useMemo(() => logicSoundRows(project), [project])
  const palette = useMemo(() => logicSoundPalette(project), [project])
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null)

  return (
    <section aria-labelledby="logic-package-heading" className="flex flex-col gap-3">
      <div>
        <h3 id="logic-package-heading" className="text-[14px] font-semibold text-body-on-dark">Logic Proでの音源と設定</h3>
        <p className="mt-1 text-[13px] leading-5 text-body-muted">
          画面上部の「曲全体MIDI」を書き出してLogic Proの新規プロジェクトへ読み込み、テンポ情報を使ってください。
          下の表のトラックがすべて入っています。各トラックに、表の音源を割り当てます。
          Reproは、この端末にあるファクトリープリセットの実名を表示します。
          Kontakt音源は、Logic Proでは「Kontakt 8」を選び、その中で表示されたライブラリと楽器・奏法を読み込みます。
          「最終プリセット」の末尾にある名前まで選んでください。Kontaktの検索欄には末尾の名前を入力できます。
          音量はミックス開始時の目安です。まず表示値へ合わせ、マスターの最大音量が-6 dB前後に収まるよう最後に微調整してください。
          設定中のトラックは、行をクリックすると目印として選択できます。
        </p>
      </div>

      <div className="rounded-lg border border-primary/35 bg-primary/8 p-3">
        <div className="text-[12px] font-medium text-primary-on-dark">今回の音の世界</div>
        <div className="mt-1 text-[14px] font-semibold text-body-on-dark">{palette.title}</div>
        <p className="mt-1 text-[13px] leading-5 text-body-muted">{palette.description}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {palette.coreSounds.map((sound) => (
            <span key={sound} className="rounded-pill bg-white/7 px-2.5 py-1 text-[12px] text-body-on-dark">{sound}</span>
          ))}
        </div>
        <p className="mt-2 text-[12px] leading-5 text-body-muted">選んだ理由：{palette.reason}</p>
        <p className="mt-2 text-[12px] leading-5 text-ink-soft">バランス：{palette.mixFocus}</p>
      </div>

      {rows.length === 0 ? (
        <p className="text-[13px] text-body-muted">書き出せる音がまだありません。</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline">
          <table className="w-full min-w-[44rem] text-left text-[13px]">
            <thead className="bg-white/[0.04] text-[12px] text-ink-soft">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">トラック</th>
                <th scope="col" className="px-3 py-2 font-medium">Logicで選ぶ音源</th>
                <th scope="col" className="px-3 py-2 font-medium">最終プリセット（検索名まで）</th>
                <th scope="col" className="px-3 py-2 font-medium">音量目安</th>
                <th scope="col" className="px-3 py-2 font-medium">設定</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const rowKey = `${row.trackName}:${index}`
                const selected = selectedRowKey === rowKey
                return (
                  <tr
                    key={rowKey}
                    tabIndex={0}
                    aria-selected={selected}
                    aria-label={`${row.trackName}の設定を確認`}
                    onClick={() => setSelectedRowKey(rowKey)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return
                      event.preventDefault()
                      setSelectedRowKey(rowKey)
                    }}
                    className={clsx(
                      "cursor-pointer border-t border-hairline align-top outline-none transition hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                      selected && "bg-primary/12",
                    )}
                  >
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 font-medium text-body-on-dark">
                        {row.trackName}
                        {selected && <span className="rounded-pill bg-primary/20 px-2 py-0.5 text-[11px] text-primary-on-dark">確認中</span>}
                      </div>
                      <div className="text-[12px] text-ink-soft">{row.role}</div>
                    </td>
                    <td className="px-3 py-2 text-body-on-dark">{row.product}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-body-on-dark">{row.preset}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums text-body-on-dark">{row.volumeDb} dB</td>
                    <td className="px-3 py-2 leading-5 text-body-muted">{row.setting}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
