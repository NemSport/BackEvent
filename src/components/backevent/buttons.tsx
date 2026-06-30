import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type PrimaryButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

export function PrimaryButton({ children, className = "", ...props }: PrimaryButtonProps) {
  return (
    <button
      className={`min-h-14 w-full rounded-2xl bg-pantone139 px-5 py-4 text-lg font-bold text-ink shadow-soft transition hover:bg-pantone139/90 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 md:min-h-11 md:px-4 md:py-2.5 md:text-base ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function BackButton({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-12 items-center gap-2 rounded-2xl border border-line bg-macro px-4 py-3 text-base font-bold text-pantone140 shadow-sm md:min-h-10 md:px-3 md:py-2 md:text-sm"
    >
      <ArrowLeft className="h-5 w-5" aria-hidden />
      Tilbage
    </Link>
  );
}
