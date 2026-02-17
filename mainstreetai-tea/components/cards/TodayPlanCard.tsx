type TodayPlanCardProps = {
  href: string;
  title?: string;
  subtitle?: string;
};

export function TodayPlanCard({
  href,
  title = "Today’s Plan",
  subtitle = "Here’s something we can try today.",
}: TodayPlanCardProps) {
  return (
    <article
      className="rounded-2xl p-4 md:p-5 space-y-3"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-base leading-relaxed" style={{ color: "var(--muted)" }}>
        {subtitle}
      </p>
      <a
        href={href}
        className="rounded-xl text-base font-medium px-4 py-3 inline-flex items-center justify-center no-underline"
        style={{ background: "var(--accent)", color: "#ffffff" }}
      >
        Open Today’s Plan
      </a>
    </article>
  );
}
