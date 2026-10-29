export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev"

/** 手元のビルド("dev")では比べない。公開された版のIDが違うときだけ、新しい版がある */
export function isNewVersionAvailable(current: string, latest: unknown): boolean {
  return current !== "dev" && typeof latest === "string" && latest.length > 0 && latest !== current
}

export async function fetchLatestBuildId(): Promise<string | null> {
  try {
    const response = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" })
    if (!response.ok) return null
    const body = (await response.json()) as { id?: unknown }
    return typeof body.id === "string" ? body.id : null
  } catch {
    return null
  }
}
