import { Component, type ReactNode } from "react"
import { useProjectStore } from "@/store/useProjectStore"
import { downloadProjectFile } from "@/storage/projectFile"
import { Button } from "@/ui/primitives"
import { reloadAfterSave } from "./reloadAfterSave"

/** 遅延読込・描画の失敗で編集データや画面全体を失わないための復旧案内。 */
export class WorkspaceErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean; busy: boolean; blocked: boolean }> {
  state = { failed: false, busy: false, blocked: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <section role="alert" className="flex min-w-0 flex-1 flex-col items-start gap-3 p-5 text-body-on-dark">
      <p>画面を読み込めませんでした。編集中の曲は残っています。保存してから再読み込みしてください。</p>
      {this.state.blocked && <p>保存を確認できないため、再読み込みを止めました。曲をファイルに保存してから再試行してください。</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={this.state.busy} onClick={async () => {
          this.setState({ busy: true })
          const ok = await reloadAfterSave(() => useProjectStore.getState().flushSave(), () => window.location.reload())
          this.setState({ busy: false, blocked: !ok })
        }}>{this.state.busy ? "保存を確認中…" : "保存して再読み込み"}</Button>
        <Button variant="dark" onClick={() => downloadProjectFile(useProjectStore.getState().project)}>ファイルに保存</Button>
      </div>
    </section>
  }
}
