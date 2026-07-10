import { PageHeader } from "./ui";

export function Header({
  title = "BackEvent",
  subtitle = "Backend for events, barer og beholdning",
  kicker,
}: {
  title?: string;
  subtitle?: string;
  kicker?: string;
}) {
  return <PageHeader title={title} subtitle={subtitle} kicker={kicker} className="mb-8" />;
}
