/** 保存に失敗した場合は、画面のデータを失う再読み込みを実行しない。 */
export async function reloadAfterSave(flush: () => Promise<boolean>, reload: () => void): Promise<boolean> {
  try {
    if (!await flush()) return false
  } catch { return false }
  reload()
  return true
}
