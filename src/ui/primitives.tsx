import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react"
import { clsx } from "clsx"

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "dark" }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-pill px-[18px] py-[9px] text-[14px] font-normal transition active:scale-95 disabled:pointer-events-none disabled:opacity-40",
        variant === "primary" && "bg-primary text-on-primary hover:bg-primary-focus",
        variant === "secondary" && "border border-primary text-primary hover:bg-primary/10",
        variant === "ghost" && "text-body-muted hover:bg-white/8 hover:text-body-on-dark",
        variant === "dark" && "rounded-sm bg-white/10 px-[15px] py-[8px] text-[13px] text-body-on-dark hover:bg-white/15",
        className,
      )}
      {...props}
    />
  )
}

export function IconButton({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={clsx(
        "inline-flex h-8 w-8 items-center justify-center rounded-full text-body-muted transition hover:bg-white/10 hover:text-body-on-dark active:scale-95 disabled:opacity-30",
        className,
      )}
      {...props}
    />
  )
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx(
        "rounded-sm border border-hairline bg-surface-tile-2 px-2.5 py-1.5 text-[13px] text-body-on-dark outline-none focus:border-primary-focus",
        className,
      )}
      {...props}
    />
  )
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        "rounded-sm border border-hairline bg-surface-tile-2 px-2.5 py-1.5 text-[13px] text-body-on-dark outline-none placeholder:text-ink-muted-48 focus:border-primary-focus",
        className,
      )}
      {...props}
    />
  )
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={clsx("text-[11px] font-medium uppercase tracking-wide text-ink-muted-48", className)}>{children}</label>
}

export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

export function SectionCard({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx("rounded-lg border border-hairline bg-surface-tile-1 p-4", className)}>
      {title && <h3 className="mb-3 text-[13px] font-semibold text-body-on-dark">{title}</h3>}
      {children}
    </div>
  )
}

export function Pill({ active, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      className={clsx(
        "rounded-pill px-3.5 py-1.5 text-[13px] transition active:scale-95",
        active ? "bg-primary text-on-primary" : "bg-white/6 text-body-muted hover:bg-white/12 hover:text-body-on-dark",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export function Slider(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="range"
      className="h-1 w-full cursor-pointer appearance-none rounded-pill bg-white/12 accent-primary"
      {...props}
    />
  )
}
