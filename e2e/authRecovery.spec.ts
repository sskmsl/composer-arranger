import { test, expect, type Page } from "playwright/test"
import { readFile } from "node:fs/promises"

const observed = new WeakMap<Page, { external: string[]; errors: string[] }>()
test.beforeEach(async ({ page, context }) => {
  const state = { external: [] as string[], errors: [] as string[] }
  observed.set(page, state)
  context.on("page", next => next.on("pageerror", error => state.errors.push(error.message)))
  page.on("pageerror", error => state.errors.push(error.message))
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === "127.0.0.1" || url.protocol === "blob:" || url.protocol === "data:") return route.continue()
    state.external.push(url.hostname)
    return route.abort()
  })
  await context.route(/\/version\.json\?/, route => route.fulfill({ json: { id: "e2e0000" } }))
})
test.afterEach(async ({ page }) => {
  expect(observed.get(page)?.external).toEqual([])
  expect(observed.get(page)?.errors).toEqual([])
})
async function ready(page: Page, owner = "A") {
  await expect.poll(() => page.evaluate(() => (window as any).reliability?.accountState())).toEqual({ owner, ready: true })
  await expect.poll(() => page.evaluate(() => (window as any).reliability.state().hydrated)).toBe(true)
}
async function seed(page: Page) {
  expect(await page.evaluate(() => (window as any).reliability.seed())).toBe(true)
  await page.getByRole("button", { name: /^(アレンジ・書出し|アレンジ)$/ }).click()
}
async function title(page: Page, value: string) {
  await page.locator("header input").first().fill(value)
  await page.locator("header input").first().press("Tab")
}

test("failed cloud saves survive reload and resend only after connectivity returns", async ({ page }) => {
  await page.goto("/e2e/harness.html?auth=1&offline=1")
  await ready(page); await seed(page); await title(page, "Durable cloud song")
  await expect(page.getByRole("alert").filter({ hasText: "クラウドに未送信" })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await page.evaluate(async () => (await (window as any).reliability.pendingCloud("A")).length)).toBe(1)
  await page.reload(); await ready(page)
  expect(await page.evaluate(() => (window as any).reliability.state().project.title)).toBe("Durable cloud song")
  await page.evaluate(() => { (window as any).authFixture.offline(false); window.dispatchEvent(new Event("online")) })
  await expect(page.getByText("変更をクラウドへ送信しました", { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(async () => (await (window as any).reliability.pendingCloud("A")).length)).toBe(0)
  expect(await page.evaluate(() => (window as any).reliability.remoteTitles("A"))).toEqual(["Durable cloud song"])
})

test("an old send response cannot remove a newer persistent cloud edit", async ({ page }) => {
  await page.addInitScript(() => { Date.prototype.toISOString = () => "2026-11-01T00:00:00.000Z" })
  await page.goto("/e2e/harness.html?auth=1"); await ready(page)
  await page.evaluate(() => (window as any).authFixture.holdPush("A"))
  await seed(page); await title(page, "First cloud edit")
  await expect.poll(() => page.evaluate(() => (window as any).authFixture.calls().filter((call: any) => call.name === "upsert_arranger_project").length)).toBe(1)
  await title(page, "Newest cloud edit")
  await page.evaluate(() => (window as any).authFixture.releasePush("A"))
  await expect.poll(() => page.evaluate(() => (window as any).reliability.remoteTitles("A"))).toEqual(["Newest cloud edit"])
  expect(await page.evaluate(async () => (await (window as any).reliability.pendingCloud("A")).length)).toBe(0)
})

test("persistent cloud records remain isolated when the authenticated account changes", async ({ page }) => {
  await page.goto("/e2e/harness.html?auth=1&offline=1"); await ready(page); await seed(page)
  await title(page, "Only account A")
  await expect(page.getByRole("alert").filter({ hasText: "クラウドに未送信" })).toBeVisible()
  await page.evaluate(() => { (window as any).authFixture.emit("B"); (window as any).authFixture.offline(false) })
  await ready(page, "B")
  await seed(page); await title(page, "Only account B")
  await expect.poll(() => page.evaluate(() => (window as any).reliability.remoteTitles("B"))).toEqual(["Only account B"])
  expect(await page.evaluate(async () => (await (window as any).reliability.pendingCloud("A")).length)).toBe(1)
  await page.evaluate(() => (window as any).authFixture.emit("A")); await ready(page)
  await expect.poll(() => page.evaluate(() => (window as any).reliability.remoteTitles("A"))).toEqual(["Only account A"])
  expect(await page.evaluate(() => (window as any).reliability.remoteTitles("B"))).toEqual(["Only account B"])
})

test("deleting an offline cloud save leaves a deletion to resend instead of resurrecting the song", async ({ page }) => {
  await page.goto("/e2e/harness.html?auth=1&offline=1"); await ready(page); await seed(page)
  const id = await page.evaluate(() => (window as any).reliability.state().project.projectId)
  await page.evaluate(async (id) => (window as any).reliability.state().deleteStoredProject(id), id)
  await page.evaluate(() => { (window as any).authFixture.offline(false); window.dispatchEvent(new Event("online")) })
  await expect.poll(() => page.evaluate((id) => (window as any).authFixture.remote("A").find((row: any) => row.id === id)?.deleted_at, id)).toBeTruthy()
  expect(await page.evaluate((id) => (window as any).authFixture.remote("A").find((row: any) => row.id === id)?.data, id)).toBeNull()
})

for (const recovery of ["reload", "online"] as const) test(`a remote deletion wins over a newer offline edit during ${recovery} recovery`, async ({ page }) => {
  await page.goto("/e2e/harness.html?auth=1&offline=1"); await ready(page); await seed(page)
  await title(page, "Newer offline edit of a deleted song")
  await expect(page.getByRole("alert").filter({ hasText: "クラウドに未送信" })).toBeVisible()
  const id = await page.evaluate(() => (window as any).reliability.state().project.projectId)
  await page.evaluate((id) => {
    (window as any).authFixture.deleteRemote("A", id, "2000-01-01T00:00:00.000Z")
    ;(window as any).authFixture.offline(false)
  }, id)
  if (recovery === "reload") { await page.reload(); await ready(page) }
  else await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await expect.poll(() => page.evaluate(async () => (await (window as any).reliability.pendingCloud("A")).length)).toBe(0)
  expect(await page.evaluate((id) => (window as any).authFixture.remote("A").find((row: any) => row.id === id), id)).toEqual({
    id, data: null, updated_at: "2000-01-01T00:00:00.000Z", deleted_at: "2000-01-01T00:00:00.000Z",
  })
  if (recovery === "online") { await page.reload(); await ready(page) }
  await expect.poll(() => page.evaluate(() => (window as any).reliability.storedTitles())).not.toContain("Newer offline edit of a deleted song")
})

for (const mode of ["active", "inactive", "offline"] as const) test(`explicit undo-delete restores the ${mode} song to cloud and survives reload`, async ({ page }) => {
  await page.goto("/e2e/harness.html?auth=1"); await ready(page); await seed(page)
  await title(page, "Undo delete target")
  const id = await page.evaluate(() => (window as any).reliability.state().project.projectId)
  await expect.poll(() => page.evaluate(() => (window as any).reliability.remoteTitles("A"))).toContain("Undo delete target")
  if (mode === "inactive") await page.evaluate(async () => { const state = (window as any).reliability.state(); state.newProject(); await state.flushSave() })
  const activeId = await page.evaluate(() => (window as any).reliability.state().project.projectId)
  if (mode === "offline") await page.evaluate(() => (window as any).authFixture.offline(true))
  await page.getByRole("button", { name: "曲", exact: true }).click()
  await page.getByRole("menu").getByRole("button", { name: "開く", exact: true }).click()
  const row = page.getByRole("listitem").filter({ hasText: "Undo delete target" })
  await row.getByRole("button", { name: "削除", exact: true }).click()
  await row.getByRole("button", { name: "削除", exact: true }).click()
  if (mode !== "offline") await expect.poll(() => page.evaluate((id) => (window as any).authFixture.remote("A").find((row: any) => row.id === id)?.deleted_at, id)).toBeTruthy()
  await page.getByRole("button", { name: "元に戻す", exact: true }).click()
  await expect(row).toBeVisible()
  expect(await page.evaluate(() => (window as any).reliability.state().project.projectId)).toBe(mode === "inactive" ? activeId : id)
  let restoredTitle = "Undo delete target"
  if (mode === "offline") {
    await page.getByRole("button", { name: "閉じる", exact: true }).click()
    restoredTitle = "Edited after offline undo"
    await title(page, restoredTitle)
    await expect.poll(() => page.evaluate(async (id) => (await (window as any).reliability.pendingCloud("A")).find((entry: any) => entry.project.projectId === id)?.restoredAt, id)).toBeTruthy()
    await page.reload(); await ready(page)
    expect(await page.evaluate(async (id) => (await (window as any).reliability.pendingCloud("A")).find((entry: any) => entry.project.projectId === id)?.restoredAt, id)).toBeTruthy()
    await page.evaluate(() => { (window as any).authFixture.offline(false); window.dispatchEvent(new Event("online")) })
  }
  await expect.poll(() => page.evaluate(() => (window as any).reliability.remoteTitles("A"))).toContain(restoredTitle)
  await page.reload(); await ready(page)
  await expect.poll(() => page.evaluate(() => (window as any).reliability.storedTitles())).toContain(restoredTitle)
  if (mode === "inactive") expect(await page.evaluate(() => (window as any).reliability.state().project.projectId)).toBe(activeId)
})

test("an inactive unsaved song can be downloaded without replacing the active song", async ({ page }) => {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(value: any, key?: IDBValidKey) {
      if ((window as any).failRescueId === value?.projectId && this.name === "projects") throw new DOMException("fixture quota", "QuotaExceededError")
      return original.call(this, value, key)
    }
  })
  await page.goto("/e2e/harness.html")
  await expect.poll(() => page.evaluate(() => (window as any).reliability?.state().hydrated)).toBe(true)
  await seed(page)
  await page.evaluate(() => { (window as any).failRescueId = (window as any).reliability.state().project.projectId })
  await title(page, "Inactive rescued song")
  await expect(page.getByRole("alert").filter({ hasText: "この端末に曲を保存できませんでした" })).toBeVisible()
  await page.evaluate(async () => { const state = (window as any).reliability.state(); state.newProject(); await state.flushSave() })
  const activeId = await page.evaluate(() => (window as any).reliability.state().project.projectId)
  await page.getByRole("button", { name: "未保存の曲（1）", exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const downloading = page.waitForEvent("download")
  await page.getByRole("button", { name: "Inactive rescued songをファイルに保存", exact: true }).click()
  const download = await downloading
  const rescued = JSON.parse(await readFile((await download.path())!, "utf8"))
  expect(rescued.title).toBe("Inactive rescued song")
  expect(rescued.projectId).not.toBe(activeId)
  expect(rescued.unsavedProjects).toBeUndefined()
  expect(await page.evaluate(() => (window as any).reliability.state().project.projectId)).toBe(activeId)
})

test("a stale initial session cannot override a newer sign-in event", async ({ page }) => {
  await page.goto("/e2e/harness.html?auth=1&holdInitial=1")
  await expect.poll(() => page.evaluate(() => Boolean((window as any).authFixture))).toBe(true)
  await page.evaluate(() => (window as any).authFixture.emit("B")); await ready(page, "B")
  await page.evaluate(() => (window as any).authFixture.releaseInitial("A"))
  // Drain the delivered initial response and React effects before checking the selected account.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await page.evaluate(() => (window as any).reliability.accountState().owner)).toBe("B")
})

test("a late sync failure from the previous account does not display an error for the new account", async ({ page }) => {
  await page.goto("/e2e/harness.html?auth=1&holdList=A")
  await expect.poll(() => page.evaluate(() => (window as any).authFixture?.calls().filter((call: any) => call.name === "list_arranger_project_metadata" && call.owner === "A").length)).toBe(1)
  await page.evaluate(() => (window as any).authFixture.emit("B")); await ready(page, "B")
  await page.evaluate(() => (window as any).authFixture.releaseList("A", true))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(page.getByText("クラウド同期を一時停止しました", { exact: true })).toHaveCount(0)
})

test("sign-out and immediate sign-in to the same account cannot leave storage permanently paused", async ({ page }) => {
  await page.goto("/e2e/harness.html?auth=1"); await ready(page)
  await page.evaluate(() => { (window as any).authFixture.emit(null); (window as any).authFixture.emit("A") })
  await ready(page)
})

test("the real login form leads through AuthGate into the editable app", async ({ page }) => {
  await page.goto("/e2e/harness.html?auth=1&signedout=1")
  await page.getByLabel("メールアドレス").fill("B@example.test")
  await page.getByLabel("パスワード").fill("fixture-password")
  await page.getByRole("button", { name: "ログイン", exact: true }).click()
  await ready(page, "B"); await seed(page)
  await title(page, "Signed in through the form")
  await expect.poll(() => page.evaluate(() => (window as any).reliability.remoteTitles("B"))).toEqual(["Signed in through the form"])
})

test("an initial session failure leaves a usable login and can be retried", async ({ page }) => {
  await page.goto("/e2e/harness.html?auth=1&failInitial=1")
  await expect(page.getByRole("alert")).toContainText("ログイン状態を確認できませんでした")
  await expect(page.getByRole("button", { name: "ログイン", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "ログイン状態を再確認", exact: true }).click()
  await ready(page)
})

test("a blocked version-one database upgrade recovers without deleting its saved song", async ({ page, context }) => {
  await page.goto("/e2e/harness.html")
  await expect.poll(() => page.evaluate(() => (window as any).reliability?.state().hydrated)).toBe(true)
  const original = await page.evaluate(() => (window as any).reliability.state().project)
  original.title = "Legacy saved song"
  await page.goto("/version.json")
  await page.evaluate(async (project) => {
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase("composer-arranger"); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error) })
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("composer-arranger", 1)
      request.onupgradeneeded = () => { request.result.createObjectStore("projects", { keyPath: "projectId" }); request.result.createObjectStore("meta") }
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    const tx = db.transaction(["projects", "meta"], "readwrite")
    tx.objectStore("projects").put({ ...project, savedAt: new Date().toISOString() })
    tx.objectStore("meta").put(project.projectId, "lastOpenedProjectId")
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    ;(window as any).legacyConnection = db
  }, original)
  const app = await context.newPage()
  await app.goto("http://127.0.0.1:5185/e2e/harness.html")
  await expect(app.getByRole("alert")).toContainText("ほかのタブ")
  await page.close()
  await app.getByRole("button", { name: "読み込みを再試行", exact: true }).click()
  await expect.poll(() => app.evaluate(() => (window as any).reliability.state().project.title)).toBe("Legacy saved song")
  expect(await app.evaluate(() => (window as any).reliability.storedTitles())).toEqual(["Legacy saved song"])
  await app.close()
})
