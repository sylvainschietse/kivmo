import Link from "next/link";
import type { ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx("rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "neutral" | "gain" | "loss" | "warn" | "info";

/** Valeur chiffrée très visible ; le ton est toujours doublé d'un libellé. */
export function Stat({ label, value, hint, tone = "neutral", toneLabel }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; toneLabel?: string }) {
  const color = { neutral: "text-ink", gain: "text-green", loss: "text-loss", warn: "text-warn", info: "text-info" }[tone];
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className={cx("num mt-1 text-2xl font-bold sm:text-3xl", color)}>{value}</p>
      {toneLabel && <p className={cx("text-xs font-semibold", color)}>{toneLabel}</p>}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone | "lime" }) {
  const cls = {
    neutral: "bg-surface-2 text-ink",
    gain: "bg-green-soft text-green",
    loss: "bg-loss-soft text-loss",
    warn: "bg-warn-soft text-warn",
    info: "bg-info-soft text-info",
    lime: "bg-lime text-lime-ink",
  }[tone];
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", cls)}>{children}</span>;
}

export function Notice({ tone = "info", title, children }: { tone?: "info" | "warn" | "loss" | "gain"; title?: string; children: ReactNode }) {
  const cls = { info: "bg-info-soft border-info/30", warn: "bg-warn-soft border-warn/30", loss: "bg-loss-soft border-loss/30", gain: "bg-green-soft border-green/30" }[tone];
  const label = { info: "Information", warn: "Attention", loss: "Erreur", gain: "Réussi" }[tone];
  return (
    <div role={tone === "loss" ? "alert" : "status"} className={cx("rounded-xl border p-3 text-sm", cls)}>
      <p className="font-semibold">{title ?? label}</p>
      <div className="mt-0.5 text-ink/90">{children}</div>
    </div>
  );
}

const btn = {
  primary: "bg-green text-green-ink hover:opacity-90",
  secondary: "bg-surface-2 text-ink hover:bg-line",
  lime: "bg-lime text-lime-ink hover:opacity-90",
  danger: "bg-loss text-white hover:opacity-90",
  ghost: "text-ink hover:bg-surface-2",
};
export type BtnVariant = keyof typeof btn;

export function Button({ children, variant = "primary", className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return (
    <button {...rest} className={cx("tap inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50", btn[variant], className)}>
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: BtnVariant; className?: string }) {
  return (
    <Link href={href} className={cx("tap inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition", btn[variant], className)}>
      {children}
    </Link>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export const inputCls = "tap w-full min-w-0 rounded-xl border border-line bg-surface px-3 py-2 text-ink placeholder:text-muted/70";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />;
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(inputCls, props.className)} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, "min-h-24", props.className)} />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface p-6 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorFromQuery({ error }: { error?: string | string[] }) {
  const e = Array.isArray(error) ? error[0] : error;
  if (!e) return null;
  return (
    <div className="mb-4">
      <Notice tone="loss">{e}</Notice>
    </div>
  );
}

export function OkFromQuery({ ok }: { ok?: string | string[] }) {
  const e = Array.isArray(ok) ? ok[0] : ok;
  if (!e) return null;
  return (
    <div className="mb-4">
      <Notice tone="gain">{e}</Notice>
    </div>
  );
}

/** Tableau accessible (équivalent des graphiques). */
export function Table({ head, rows, caption }: { head: string[]; rows: ReactNode[][]; caption?: string }) {
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="num w-full min-w-[480px] border-collapse text-sm">
        {caption && <caption className="mb-2 text-left text-xs text-muted">{caption}</caption>}
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="border-b border-line px-2 py-2 text-left font-semibold text-muted">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/60">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-2 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IntegrationPill({ status }: { status: "connecte" | "bac_a_sable" | "a_connecter" | "local" }) {
  const map = { connecte: ["Connecté", "gain"], bac_a_sable: ["Bac à sable", "info"], a_connecter: ["À connecter", "warn"], local: ["Mode local", "info"] } as const;
  return <Badge tone={map[status][1]}>{map[status][0]}</Badge>;
}
