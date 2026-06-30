import { CountFlow } from "@/components/backevent/count-flow";

export default function AabningPage() {
  return (
    <CountFlow
      title="Åbningsstatus"
      intro="Tæl hvor meget der er nu"
      buttonLabel="Gem åbning"
      savedLabel="Åbning gemt"
    />
  );
}
