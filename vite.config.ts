import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// 公開された版を見分けるID。CI(GITHUB_SHA)でのビルドだけ付け、手元のビルド・開発中は "dev"
const buildId = process.env.GITHUB_SHA?.slice(0, 7) ?? "dev"

export default defineConfig({
  base: "./", // GitHub Pagesのサブパス配信でもそのまま動くよう相対パスにする
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    react(),
    tailwindcss(),
    {
      // 開いたままの画面が古い版かどうかを確かめるための、最新版のID
      name: "emit-version-file",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ id: buildId }) })
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
