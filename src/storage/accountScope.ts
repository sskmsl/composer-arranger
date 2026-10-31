// undefined は認証を使わないローカル実行。アカウント変更中は保存を止める。
export type StorageAccount = string | null | undefined
let account: StorageAccount
let ready = true
const listeners = new Set<(previous: StorageAccount, next: StorageAccount) => void>()
export const storageAccount = () => account
export const storageAccountReady = () => ready
export function selectStorageAccount(next: string | null): void {
  if (account === next) return
  const previous = account
  account = next
  ready = false
  for (const listener of listeners) listener(previous, next)
}
export function allowStorageAccount(owner: string): void {
  if (account !== owner || ready) return
  ready = true
  for (const listener of listeners) listener(account, account)
}
export function onStorageAccountChange(listener: (previous: StorageAccount, next: StorageAccount) => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export function assertStorageAccount(expected: StorageAccount): void {
  if (account !== expected || !ready) throw new Error("保存中にアカウントが変更されました")
}
