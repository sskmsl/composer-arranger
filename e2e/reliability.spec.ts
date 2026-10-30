import { test, expect, type Page } from "playwright/test"
import { readFile } from "node:fs/promises"

async function seed(page: Page) {
  expect(await page.evaluate(() => (window as any).reliability.seed())).toBe(true)
}
async function arrangementPage(page: Page) {
  await page.getByRole("button", { name: /^(アレンジ・書出し|アレンジ)$/ }).click()
  await expect(page.locator("header input").first()).toBeVisible()
}
async function editTitle(page: Page, title: string) {
  await page.locator("header input").first().fill(title)
  await page.locator("header input").first().press("Tab")
}
async function saved(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as any).reliability.state().saveStatus)).toBe("saved")
}

test.beforeEach(async ({ page }) => {
  await page.route(/\/version\.json\?/, (route) => route.fulfill({ json: { id: "e2e0000" } }))
  await page.addInitScript(() => {
    const w = window as any
    w.__failSaves = false
    w.__failOpen = sessionStorage.getItem("failOpen") === "1"
    const open = indexedDB.open.bind(indexedDB)
    indexedDB.open = ((...args: Parameters<IDBFactory["open"]>) => {
      if (w.__failOpen) throw new DOMException("Injected unavailable storage", "UnknownError")
      return open(...args)
    }) as IDBFactory["open"]
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
      if (w.__failSaves && this.name === "projects") throw new DOMException("Injected quota", "QuotaExceededError")
      return put.call(this, value, key)
    }
    Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true })
  })
  await page.goto("/e2e/harness.html")
  await expect.poll(() => page.evaluate(() => (window as any).reliability?.state().hydrated)).toBe(true)
})

test("edit, durable save, reload and actual MIDI download", async ({ page }) => {
  await seed(page)
  await arrangementPage(page)
  await editTitle(page, "Browser saved song")
  await saved(page)
  await page.reload()
  await expect.poll(() => page.evaluate(() => (window as any).reliability?.state().project.title)).toBe("Browser saved song")
  await arrangementPage(page)
  const downloading = page.waitForEvent("download")
  await page.getByRole("button", { name: "曲全体MIDI", exact: true }).click()
  const download = await downloading
  const bytes = await readFile((await download.path())!)
  expect(bytes.subarray(0, 4).toString()).toBe("MThd")
  expect(bytes.length).toBeGreaterThan(100)
})

test("quota failure keeps edits, exports JSON and retries the latest version", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await seed(page)
  await arrangementPage(page)
  await page.evaluate(() => { (window as any).__failSaves = true })
  await editTitle(page, "Unsaved but recoverable")
  const warning = page.getByRole("alert").filter({ hasText: "この端末に曲を保存できませんでした" })
  await expect(warning).toBeVisible()
  const downloading = page.waitForEvent("download")
  await warning.getByRole("button", { name: "ファイルに保存", exact: true }).click()
  const download = await downloading
  const backup = JSON.parse(await readFile((await download.path())!, "utf8"))
  expect(backup.title).toBe("Unsaved but recoverable")
  await page.evaluate(() => { (window as any).__failSaves = false })
  await warning.getByRole("button", { name: "保存を再試行", exact: true }).click()
  await saved(page)
  await expect(warning).toHaveCount(0)
  await page.reload()
  await expect.poll(() => page.evaluate(() => (window as any).reliability?.state().project.title)).toBe("Unsaved but recoverable")
  expect(errors).toEqual([])
})

test("startup read failure exits loading and retries without deleting the stored song", async ({ page }) => {
  await seed(page)
  await page.evaluate(() => sessionStorage.setItem("failOpen", "1"))
  await page.reload()
  const warning = page.getByRole("alert").filter({ hasText: "保存した曲を読み込めませんでした" })
  await expect(warning).toBeVisible()
  await expect(page.getByText("読み込み中…", { exact: true })).toHaveCount(0)
  await page.evaluate(() => { (window as any).__failOpen = false; sessionStorage.removeItem("failOpen") })
  await warning.getByRole("button", { name: "読み込みを再試行" }).click()
  await expect(warning).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).reliability.state().project.sections.length)).toBeGreaterThan(0)
})

test("update reload is blocked on save failure and preserves the last edit after retry", async ({ page }) => {
  await seed(page)
  await arrangementPage(page)
  await page.unroute(/\/version\.json\?/)
  await page.route(/\/version\.json\?/, (route) => route.fulfill({ json: { id: "new0000" } }))
  await page.evaluate(() => window.dispatchEvent(new Event("focus")))
  const update = page.getByRole("status").filter({ hasText: "新しい版が公開されています" })
  await expect(update).toBeVisible()
  await page.evaluate(() => { (window as any).__failSaves = true; (window as any).__samePage = "kept" })
  await editTitle(page, "Last edit before update")
  await update.getByRole("button", { name: "再読み込み", exact: true }).click()
  await expect(update.getByRole("alert")).toContainText("再読み込みを止めました")
  expect(await page.evaluate(() => (window as any).__samePage)).toBe("kept")
  await page.evaluate(() => { (window as any).__failSaves = false })
  const dialogs: string[] = []
  page.on("dialog", async (dialog) => { dialogs.push(dialog.type()); await dialog.dismiss() })
  await update.getByRole("button", { name: "再読み込み", exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).__samePage ?? "reloaded")).toBe("reloaded")
  await expect.poll(() => page.evaluate(() => (window as any).reliability?.state().project.title)).toBe("Last edit before update")
  expect(dialogs).toEqual([])
})

test("failed lazy JS shows recovery and saved reload restores the workspace", async ({ page }) => {
  await seed(page)
  await page.route(/\/assets\/ArrangementWorkspace-[^/]+\.js/, (route) => route.abort())
  await page.getByRole("button", { name: /^(アレンジ・書出し|アレンジ)$/ }).click()
  const recovery = page.getByRole("alert").filter({ hasText: "画面を読み込めませんでした" })
  await expect(recovery).toBeVisible()
  await page.unroute(/\/assets\/ArrangementWorkspace-[^/]+\.js/)
  await recovery.getByRole("button", { name: "保存して再読み込み" }).click()
  await expect.poll(() => page.evaluate(() => (window as any).reliability?.state().hydrated)).toBe(true)
  await arrangementPage(page)
  await expect(page.getByRole("button", { name: "曲全体MIDI", exact: true })).toBeVisible()
  await expect(recovery).toHaveCount(0)
})

test("worker cancellation keeps the existing song", async ({ page }) => {
  await seed(page)
  await arrangementPage(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route(/\/assets\/arrangement\.worker-[^/]+\.js/, async (route) => { await gate; await route.continue().catch(() => {}) })
  await page.getByRole("button", { name: /^「.+」で全曲を作る$/ }).click()
  const progress = page.getByRole("status").filter({ hasText: "全曲アレンジを作っています" })
  await expect(progress).toBeVisible()
  await progress.getByRole("button", { name: "作成を中止" }).click()
  release()
  await expect(progress).toHaveCount(0)
  expect(await page.evaluate(() => Boolean((window as any).reliability.state().project.fullSongArrangement))).toBe(false)
})

test("editing while a worker runs discards its obsolete result", async ({ page }) => {
  await seed(page)
  await arrangementPage(page)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route(/\/assets\/arrangement\.worker-[^/]+\.js/, async (route) => { await gate; await route.continue().catch(() => {}) })
  await page.getByRole("button", { name: /^「.+」で全曲を作る$/ }).click()
  await expect(page.getByRole("button", { name: "作成を中止" })).toBeVisible()
  await editTitle(page, "Edited during generation")
  release()
  await expect(page.getByRole("alert").filter({ hasText: "計算中に曲が変更された" }).first()).toBeVisible()
  expect(await page.evaluate(() => (window as any).reliability.state().project.title)).toBe("Edited during generation")
  expect(await page.evaluate(() => Boolean((window as any).reliability.state().project.fullSongArrangement))).toBe(false)
})

test("real module Worker preserves full arrangements, diagnostic, scoped recipes and restored versions", async ({ page }, testInfo) => {
  const rows = await page.evaluate(() => (window as any).reliability.compareWorkers())
  await testInfo.attach("worker-equivalence", { body: JSON.stringify(rows, null, 2), contentType: "application/json" })
  expect(rows).toHaveLength(8)
  expect(rows.filter((row: any) => !row.same || row.diagnosticSame === false)).toEqual([])
})


test("a visible page detects a published update without switching tabs", async ({ page }) => {
  await page.clock.install()
  await page.reload()
  await expect.poll(() => page.evaluate(() => (window as any).reliability?.state().hydrated)).toBe(true)
  await page.unroute(/\/version\.json\?/)
  await page.route(/\/version\.json\?/, (route) => route.fulfill({ json: { id: "poll000" } }))
  await page.clock.runFor(60_000)
  await expect(page.getByRole("status").filter({ hasText: "新しい版が公開されています" })).toBeVisible()
})

test("real worker generation applies a new version and leaves the UI thread responsive", async ({ page }) => {
  await seed(page)
  await arrangementPage(page)
  await page.getByRole("button", { name: /^「.+」で全曲を作る$/ }).click()
  await expect.poll(() => page.evaluate(() => (window as any).reliability.state().project.fullSongArrangement?.tracks.length ?? 0)).toBeGreaterThan(0)
  expect(await page.evaluate(() => Boolean((window as any).reliability.state().project.arrangementChat?.currentVersionId))).toBe(true)
  const responsiveness = await page.evaluate(() => (window as any).reliability.responsiveWorker())
  expect(responsiveness.tracks).toBeGreaterThan(0)
  expect(responsiveness.ticks).toBeGreaterThan(2)
})

test("an AI proposal cannot be applied before its worker result is ready", async ({ page }) => {
  expect(await page.evaluate(() => (window as any).reliability.seedProposal())).toBe(true)
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  await page.route(/\/assets\/arrangement\.worker-[^/]+\.js/, async (route) => { await gate; await route.continue().catch(() => {}) })
  await arrangementPage(page)
  await expect(page.getByRole("status").filter({ hasText: "変更案の音を準備しています" })).toBeVisible()
  await expect(page.getByRole("button", { name: "この案を使う", exact: true })).toHaveCount(0)
  await expect(page.getByText("パートの追加・休止や、音の並びの変更はありません。", { exact: true })).toHaveCount(0)
  release()
  const apply = page.getByRole("button", { name: "この案を使う", exact: true })
  await expect(apply).toBeVisible()
  await apply.click()
  expect(await page.evaluate(() => (window as any).reliability.state().project.arrangementChat.messages.find((m: any) => m.id === "browser-proposal").appliedProposalId)).toBe("browser-candidate")
})
