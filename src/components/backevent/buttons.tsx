import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "./ui";

type PrimaryButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

export function PrimaryButton({ children, className = "", ...props }: PrimaryButtonProps) {
  return (
    <Button className={className} {...props}>
      {children}
    </Button>
  );
}

export function BackButton({ href = "/" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line bg-macro px-3 py-2 text-sm font-bold text-pantone140 shadow-sm transition hover:border-pantone139 hover:bg-soft focus:outline-none focus:ring-2 focus:ring-pantone140/35 focus:ring-offset-2 focus:ring-offset-macro"
    >
      <ArrowLeft className="h-5 w-5" aria-hidden />
      Tilbage
    </Link>
  );
}
