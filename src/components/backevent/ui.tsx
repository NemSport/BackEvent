import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";

type ButtonTone = "primary" | "secondary" | "danger" | "success" | "info" | "quiet";
type ButtonSize = "md" | "sm" | "compact";
type StatusTone = "success" | "pending" | "danger" | "inactive" | "info";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const buttonToneClasses: Record<ButtonTone, string> = {
  primary: "border-pantone139 bg-pantone139 text-ink shadow-sm hover:bg-pantone139/90",
  secondary: "border-line bg-macro text-pantone140 shadow-sm hover:border-pantone139 hover:bg-soft",
  danger: "border-warmRed bg-warmRed text-macro shadow-sm hover:bg-warmRed/90",
  success: "border-ok bg-ok text-macro shadow-sm hover:bg-ok/90",
  info: "border-info/20 bg-info/10 text-info shadow-sm hover:bg-info/15",
  quiet: "border-transparent bg-soft text-muted hover:bg-line/50",
};

const buttonSizeClasses: Record<ButtonSize, string> = {
  md: "min-h-[3.25rem] rounded-2xl px-4 py-3 text-base md:min-h-11 md:px-4 md:py-2.5",
  sm: "min-h-11 rounded-xl px-3 py-2 text-sm",
  compact: "min-h-8 rounded-lg px-2.5 py-1.5 text-xs",
};

export function Button({
  children,
  className,
  tone = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  tone?: ButtonTone;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 border font-bold transition focus:outline-none focus:ring-2 focus:ring-pantone140/35 focus:ring-offset-2 focus:ring-offset-macro active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50",
        buttonToneClasses[tone],
        buttonSizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  children,
  className,
  tone = "secondary",
  size = "md",
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
  tone?: ButtonTone;
  size?: ButtonSize;
}) {
  return (
    <Link
      className={cn(
        "inline-flex items-center justify-center gap-2 border font-bold transition focus:outline-none focus:ring-2 focus:ring-pantone140/35 focus:ring-offset-2 focus:ring-offset-macro active:scale-[0.99]",
        buttonToneClasses[tone],
        buttonSizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  );
}

export function Card({
  children,
  className,
  as = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "article" | "section" | "div";
}) {
  const Component = as;

  return <Component className={cn("rounded-2xl border border-line bg-macro p-4 shadow-sm md:p-5", className)}>{children}</Component>;
}

export function PageHeader({
  title,
  subtitle,
  kicker,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  kicker?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-6 rounded-2xl bg-pantone139 px-5 py-5 text-ink shadow-sm md:px-6 md:py-5", className)}>
      {kicker ? <p className="mb-2 text-xs font-bold uppercase tracking-wide text-pantone140">{kicker}</p> : null}
      <h1 className="text-3xl font-bold leading-tight md:text-4xl">{title}</h1>
      {subtitle ? <p className="mt-2 max-w-2xl text-base font-medium text-pantone140">{subtitle}</p> : null}
      {children}
    </header>
  );
}

const statusToneClasses: Record<StatusTone, string> = {
  success: "border-green-100 bg-green-50 text-ok",
  pending: "border-pantone139/60 bg-pantone139/25 text-pantone140",
  danger: "border-warmRed/25 bg-warmRed/10 text-warmRed",
  inactive: "border-line bg-soft text-muted",
  info: "border-info/20 bg-info/10 text-info",
};

export function StatusPill({
  children,
  tone,
  className,
}: {
  children: ReactNode;
  tone: StatusTone;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-bold md:text-sm", statusToneClasses[tone], className)}>
      {children}
    </span>
  );
}

export function Notice({
  children,
  tone = "info",
  className,
}: {
  children: ReactNode;
  tone?: "info" | "danger" | "success" | "pending";
  className?: string;
}) {
  const classes = {
    info: "border-info/20 bg-info/10 text-info",
    danger: "border-warmRed/25 bg-warmRed/10 text-warmRed",
    success: "border-green-100 bg-green-50 text-ok",
    pending: "border-pantone139/60 bg-pantone139/20 text-pantone140",
  }[tone];

  return <p className={cn("rounded-2xl border px-4 py-3 text-sm font-bold", classes, className)}>{children}</p>;
}
