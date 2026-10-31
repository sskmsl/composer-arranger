import { resolve } from "node:path"
import { mergeConfig } from "vite"
import base from "./vite.config"
// 通常の公開distにはテスト入口・fixtureを含めない。
export default mergeConfig(base, {
  build: { outDir: "dist-e2e", rolldownOptions: { input: {
    app: resolve("index.html"), harness: resolve("e2e/harness.html"),
  } } },
})
