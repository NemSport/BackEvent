export function Header({
  title = "BackEvent",
  subtitle = "Backend for events, barer og beholdning",
  kicker,
}: {
  title?: string;
  subtitle?: string;
  kicker?: string;
}) {
  return (
    <header className="mb-8 rounded-[2rem] bg-pantone139 px-5 py-7 text-ink shadow-soft sm:px-8 sm:py-9 lg:rounded-[1.5rem] lg:px-6 lg:py-6">
      {kicker ? <p className="mb-2 text-sm font-bold uppercase tracking-wide text-pantone140">{kicker}</p> : null}
      <h1 className="text-4xl font-bold leading-tight sm:text-5xl lg:text-4xl">{title}</h1>
      <p className="mt-2 max-w-2xl text-lg font-medium text-pantone140 lg:text-base">{subtitle}</p>
    </header>
  );
}
