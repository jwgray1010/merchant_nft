import { Card } from "./Card";
import { SectionTitle } from "./SectionTitle";

type RouteCardProps = {
  title?: string;
  steps: [string, string, string];
  line?: string;
};

export function RouteCard({ title = "Town Route Tip", steps, line }: RouteCardProps) {
  return (
    <Card>
      <SectionTitle>{title}</SectionTitle>
      <div className="flex items-center gap-2 text-sm text-[#0F172A]" style={{ marginBottom: 8 }}>
        <span>{steps[0]}</span>
        <span style={{ color: "#6B7280" }}>•</span>
        <span>{steps[1]}</span>
        <span style={{ color: "#6B7280" }}>•</span>
        <span>{steps[2]}</span>
      </div>
      {line ? <p className="text-base leading-relaxed text-[#6B7280]">{line}</p> : null}
    </Card>
  );
}
