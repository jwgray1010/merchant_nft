type OpportunityPreviewCardProps = {
  title: string;
  summary: string;
  href: string;
};

export function OpportunityPreviewCard({ title, summary, href }: OpportunityPreviewCardProps) {
  return (
    <article
      className="rounded-2xl p-4 md:p-5 space-y-3"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Community Opportunity
      </p>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-base leading-relaxed" style={{ color: "var(--muted)" }}>
        {summary}
      </p>
      <a
        href={href}
        className="rounded-xl text-base font-medium px-4 py-2 inline-flex items-center justify-center no-underline"
        style={{ border: "1px solid var(--border)", color: "var(--text)", background: "var(--surface)" }}
      >
        View details
      </a>
    </article>
  );
}
