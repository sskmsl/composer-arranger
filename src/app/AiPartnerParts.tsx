import { conciseDirectionText, plainDirectionText } from "@/ai-arranger/directionPresentation"
import { Select } from "@/ui/primitives"

export function ContextStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-white/[0.04] px-3 py-2">
      <div className="text-[12px] text-ink-soft">{label}</div>
      <div className="mt-0.5 truncate text-[13px] text-body-on-dark">{value}</div>
    </div>
  )
}

export function DiagnosisList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-sm bg-white/[0.04] px-3 py-2">
      <div className="text-[12px] uppercase tracking-wide text-ink-soft">{title}</div>
      <ul className="mt-1 space-y-1 text-[12px] leading-5 text-body-muted">
        {items.map((item) => <li key={item}>• {conciseDirectionText(item, 56)}</li>)}
      </ul>
    </div>
  )
}

export function Tag({ children }: { children: string }) {
  return (
    <span className="rounded-pill border border-hairline px-2 py-0.5 text-[12px] text-body-muted">
      {children}
    </span>
  )
}

export function DirectorNote({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-sm bg-white/[0.04] px-3 py-2">
      <div className="text-[12px] uppercase tracking-wide text-primary-on-dark">{label}</div>
      <div className="mt-1 break-words leading-5 text-body-muted">{plainDirectionText(value)}</div>
    </div>
  )
}

export function OrchestrationOverrideSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[][]
  onChange: (value: string) => void
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-ink-soft">
      {label}
      <Select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 !py-1 text-[12px]"
      >
        <option value="auto">自動</option>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>{optionLabel}</option>
        ))}
      </Select>
    </label>
  )
}
