import { useMemo } from "react"
import { logicSoundRows } from "@/midi/logicProductionPackage"
import { useProjectStore } from "@/store/useProjectStore"

/**
 * Logic Pro用の音源と設定。曲全体MIDIに入るトラックごとに「おすすめ音源」と「一言の設定」だけを並べる。
 * MIDI自体は画面上部の「曲全体MIDI」で書き出す(ここでは同じものを重ねて出さない)。
 */
export function LogicProductionPackagePanel() {
  const project = useProjectStore((state) => state.project)
  const rows = useMemo(() => logicSoundRows(project), [project])

  return (
    <section aria-labelledby="logic-package-heading" className="flex flex-col gap-3">
      <div>
        <h3 id="logic-package-heading" className="text-[14px] font-semibold text-body-on-dark">Logic Proでの音源と設定</h3>
        <p className="mt-1 text-[12px] leading-5 text-body-muted">
          画面上部の「曲全体MIDI」を書き出してLogic Proの新規プロジェクトへ読み込み、テンポ情報を使ってください。
          下の表のトラックがすべて入っています。各トラックに、表の音源を割り当てます。
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12px] text-body-muted">書き出せる音がまだありません。</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline">
          <table className="w-full min-w-[36rem] text-left text-[12px]">
            <thead className="bg-white/[0.04] text-[11px] text-ink-muted-48">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">トラック</th>
                <th scope="col" className="px-3 py-2 font-medium">おすすめ音源</th>
                <th scope="col" className="px-3 py-2 font-medium">設定</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.trackName} className="border-t border-hairline align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium text-body-on-dark">{row.trackName}</div>
                    <div className="text-[11px] text-ink-muted-48">{row.role}</div>
                  </td>
                  <td className="px-3 py-2 text-body-on-dark">{row.product}</td>
                  <td className="px-3 py-2 leading-5 text-body-muted">{row.setting}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
