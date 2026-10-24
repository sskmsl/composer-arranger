/**
 * 合格する案を作れなかったときの、画面の文。
 * 原因が分かるときは、その原因を先に出す(内部の採点の言葉は使わない)。古い保存データは原因が無いので、確認する場所だけを出す。
 */
export function qualityWarningText(reasons: readonly string[] | undefined): string {
  const cause = reasons?.length ? `主な原因は、${reasons.join("、")}ことです。` : ""
  return `十分な品質の案を作れませんでした。${cause}いま表示している案は、品質の基準に届いていません。セクションの区切り、コード、主旋律を確認してから作り直してください。`
}
