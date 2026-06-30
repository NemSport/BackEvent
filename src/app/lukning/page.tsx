import { CountFlow } from "@/components/backevent/count-flow";

export default function LukningPage() {
  return (
    <CountFlow
      title="Lukkestatus"
      intro="Hvor meget er tilbage?"
      buttonLabel="Gem lukning"
      savedLabel="Lukning gemt"
    />
  );
}
