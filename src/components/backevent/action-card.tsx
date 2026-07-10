import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export function ActionCard({
  href,
  title,
  description,
  icon: Icon,
  tone = "secondary",
}: {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tone?: "primary" | "secondary";
}) {
  return (
    <Link
      href={href}
      className={`group flex min-h-28 items-center gap-3 rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft focus:outline-none focus:ring-2 focus:ring-pantone139/60 md:min-h-20 md:px-4 md:py-3 ${
        tone === "primary" ? "border-pantone139 bg-pantone139/80" : "border-line bg-macro hover:border-pantone139"
      }`}
    >
      <span
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl md:h-10 md:w-10 ${
          tone === "primary" ? "bg-macro/70 text-pantone140" : "bg-pantone139/35 text-pantone140"
        }`}
      >
        <Icon className="h-6 w-6 md:h-5 md:w-5" aria-hidden />
      </span>
      <span>
        <span className="block text-lg font-bold text-ink md:text-base">{title}</span>
        <span className="mt-0.5 block text-sm font-medium text-muted">{description}</span>
      </span>
    </Link>
  );
}
