import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "./ui";

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
      className={cn(
        "group flex min-h-24 items-center gap-3 rounded-2xl border p-4 shadow-sm transition hover:border-pantone139 hover:bg-soft/70 focus:outline-none focus:ring-2 focus:ring-pantone140/35 focus:ring-offset-2 focus:ring-offset-macro md:min-h-20 md:px-4 md:py-3",
        tone === "primary" ? "border-pantone139 bg-pantone139/85 hover:bg-pantone139/90" : "border-line bg-macro",
      )}
    >
      <span
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-pantone140 md:h-10 md:w-10",
          tone === "primary" ? "bg-macro/70" : "bg-pantone139/25",
        )}
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
