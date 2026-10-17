import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import type { Color } from "../lib/api";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export const colorVar = (c: Color | string | null | undefined) => `var(--${c || "cobalt"})`;

type Variant = "primary" | "quiet" | "ghost" | "danger";

export function Button({
  variant = "quiet",
  size = "md",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-sm" : "h-10 px-3.5 text-[0.95rem]",
        variant === "primary" && "bg-cobalt text-white hover:brightness-110 dark:text-paper",
        variant === "quiet" && "border border-line bg-surface text-ink hover:bg-sunken",
        variant === "ghost" && "text-muted hover:bg-sunken hover:text-ink",
        variant === "danger" && "text-clay hover:bg-clay-soft",
        className,
      )}
      {...rest}
    />
  );
}

export function IconButton({ label, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx("inline-flex size-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-sunken hover:text-ink", className)}
      {...rest}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-muted">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-faint">{hint}</p>}
    </div>
  );
}

const control =
  "w-full rounded-lg border border-line bg-surface px-3 text-ink placeholder:text-faint focus:border-cobalt focus:outline-none focus-visible:outline-none focus:ring-2 focus:ring-cobalt/20";

export const Input = ({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) => <input className={cx(control, "h-10", className)} {...rest} />;

export const Textarea = ({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cx(control, "py-2", className)} {...rest} />
);

export const Select = ({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) => <select className={cx(control, "h-10 pr-8", className)} {...rest} />;

export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-2xl bg-surface p-0 text-ink shadow-lift backdrop:bg-ink/30 backdrop:backdrop-blur-[2px]",
        "sm:m-auto sm:rounded-2xl",
        wide ? "sm:max-w-2xl" : "sm:max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
            <h2 className="text-lg font-semibold">{title}</h2>
            <IconButton label="Cerrar" onClick={onClose}>
              <X size={18} />
            </IconButton>
          </header>
          <div className="scrollbar-thin overflow-y-auto px-5 py-4 pb-safe">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-line px-5 py-6">
      {icon && <div className="text-faint">{icon}</div>}
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Loading({ label = "Cargando" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted">
      <span className="size-2 animate-pulse rounded-full bg-ochre" />
      {label}…
    </div>
  );
}

export function PageHeader({ title, children, sub }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[2rem] leading-tight font-semibold sm:text-[2.4rem]">{title}</h1>
        {sub && <p className="mt-1 text-muted">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

export function Section({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("mb-8", className)}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-md bg-sunken px-1.5 py-0.5 text-xs text-muted">#{children}</span>;
}

export function Dot({ color, className }: { color: Color | string | null | undefined; className?: string }) {
  return <span aria-hidden className={cx("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: colorVar(color) }} />;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("h-8 rounded-md px-3 text-sm transition-colors", value === o.value ? "bg-ink text-paper" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
