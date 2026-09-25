import { useRef, useState } from "react"
import { Trash2, Upload } from "lucide-react"
import { useProjectStore } from "@/store/useProjectStore"
import {
  REFERENCE_APPLY_TARGETS,
  REFERENCE_TARGET_LABELS,
  parseReferenceProfile,
  type ReferenceApplyTarget,
  type ReferenceInfluenceAmount,
  type ReferenceInfluenceSetting,
} from "@/core/referenceProfile"
import { FieldGroup, IconButton, Select, Button } from "@/ui/primitives"

const AMOUNT_LABELS: Record<ReferenceInfluenceAmount, string> = { low: "弱", moderate: "中", high: "強" }

/**
 * 参考曲の特徴(数値だけ)を読み込み、用途ごとにどれだけ参考にするかを選ぶ。
 * 参考曲の旋律・コード・音型は読み込まない(プロファイルに入っていない)。
 */
export function ReferenceInfluenceField() {
  const song = useProjectStore((state) => state.project.song)
  const updateSongField = useProjectStore((state) => state.updateSongField)
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const profiles = song.referenceProfiles ?? []
  const influences = song.referenceInfluences ?? []

  const importProfile = async (file: File) => {
    try {
      const profile = parseReferenceProfile(JSON.parse(await file.text()))
      const id = profiles.some((item) => item.id === profile.id) ? `${profile.id}-${Date.now()}` : profile.id
      updateSongField("referenceProfiles", [...profiles, { ...profile, id }])
      updateSongField("referenceInfluences", [...influences, { profileId: id, targets: {} }])
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "読み込めませんでした")
    }
  }

  const setAmount = (profileId: string, target: ReferenceApplyTarget, amount: ReferenceInfluenceAmount | "") => {
    const next: ReferenceInfluenceSetting[] = influences.map((setting) => {
      if (setting.profileId !== profileId) return setting
      const targets = { ...setting.targets }
      if (amount) targets[target] = amount
      else delete targets[target]
      return { ...setting, targets }
    })
    updateSongField("referenceInfluences", next)
  }

  const remove = (profileId: string) => {
    updateSongField("referenceProfiles", profiles.filter((profile) => profile.id !== profileId))
    updateSongField("referenceInfluences", influences.filter((setting) => setting.profileId !== profileId))
  }

  return (
    <FieldGroup label="参考曲（特徴だけを参考にする）">
      <p className="text-[12px] leading-5 text-body-muted">
        参考曲の旋律やコードは使わず、密度・余白・リズムの傾向・音の距離などの特徴だけを、選んだ用途に少しだけ効かせます。
      </p>
      {profiles.map((profile) => {
        const setting = influences.find((item) => item.profileId === profile.id)
        return (
          <div key={profile.id} className="mt-1 rounded border border-hairline p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[12px] font-semibold text-body-on-dark">{profile.label}</span>
              <IconButton aria-label={`${profile.label}を外す`} onClick={() => remove(profile.id)}><Trash2 size={13} /></IconButton>
            </div>
            <div className="mt-1 flex flex-col gap-1">
              {REFERENCE_APPLY_TARGETS.map((target) => {
                const amount = setting?.targets[target]
                return (
                  <label key={target} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2 text-[12px] text-body-muted">
                    <span className="truncate">{REFERENCE_TARGET_LABELS[target]}</span>
                    <Select className="w-full py-1 text-[12px]" value={typeof amount === "string" ? amount : ""}
                      aria-label={`${profile.label}を${REFERENCE_TARGET_LABELS[target]}に使う強さ`}
                      onChange={(event) => setAmount(profile.id, target, event.target.value as ReferenceInfluenceAmount | "")}>
                      <option value="">使わない</option>
                      {(Object.keys(AMOUNT_LABELS) as ReferenceInfluenceAmount[]).map((key) => <option key={key} value={key}>{AMOUNT_LABELS[key]}</option>)}
                    </Select>
                  </label>
                )
              })}
            </div>
          </div>
        )
      })}
      <input ref={input} type="file" accept=".json,application/json" className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void importProfile(file)
          event.target.value = ""
        }} />
      <Button variant="secondary" className="mt-1 w-full" onClick={() => input.current?.click()}>
        <Upload size={13} /> 参考曲の特徴を読み込む
      </Button>
      {error && <p className="text-[12px] text-amber-300">{error}</p>}
    </FieldGroup>
  )
}
