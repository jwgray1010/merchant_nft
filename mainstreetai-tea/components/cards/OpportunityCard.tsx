export type OpportunityCardData = {
  id: string;
  title: string;
  details: string;
  whenLine: string;
  sourceLine: string;
};

type OpportunityCardProps = {
  data: OpportunityCardData;
};

export function OpportunityCard({ data }: OpportunityCardProps) {
  return (
    <article
      className="rounded-2xl p-4 md:p-5 space-y-3"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Community Opportunity
      </p>
      <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">{data.title}</h1>
      <p className="text-base leading-relaxed">{data.details}</p>
      <div className="space-y-1">
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {data.whenLine}
        </p>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {data.sourceLine}
        </p>
      </div>
    </article>
  );
}
