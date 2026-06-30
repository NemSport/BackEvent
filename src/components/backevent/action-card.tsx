import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export function ActionCard({
  href,
  title,
  description,
  icon: Icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-36 items-center gap-4 rounded-[1.75rem] border border-line bg-macro p-5 shadow-soft transition hover:-translate-y-0.5 hover:border-pantone139 md:min-h-24 md:gap-3 md:p-4"
    >
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-pantone139 text-pantone140 md:h-11 md:w-11 md:rounded-xl">
        <Icon className="h-7 w-7 md:h-5 md:w-5" aria-hidden />
      </span>
      <span>
        <span className="block text-xl font-bold text-ink md:text-lg">{title}</span>
        <span className="mt-1 block text-base font-medium text-muted md:text-sm">{description}</span>
      </span>
    </Link>
  );
}
