import { spawnSync } from "node:child_process"

// 各エンジンに従来の300秒の全体上限を適用し、証拠を別々に残す。
for (const [group, projects] of [["chromium", ["desktop", "mobile"]], ["webkit", ["webkit-desktop", "webkit-mobile"]]]) {
  console.log(`Browser checks: ${group}`)
  const result = spawnSync(process.execPath, ["node_modules/playwright/cli.js", "test", ...projects.map(name => `--project=${name}`), ...process.argv.slice(2)], {
    stdio: "inherit", env: { ...process.env, BROWSER_CHECK_GROUP: group },
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
