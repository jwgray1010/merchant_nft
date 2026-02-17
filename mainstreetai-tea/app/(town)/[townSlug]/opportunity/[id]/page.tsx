import { AIMessagePreview } from "../../../../../components/actions/AIMessagePreview";
import { OpportunityCard, type OpportunityCardData } from "../../../../../components/cards/OpportunityCard";

type OpportunityPageProps = {
  params: {
    townSlug: string;
    id: string;
  };
  searchParams?: {
    help?: string;
  };
};

function demoOpportunity(id: string): OpportunityCardData {
  return {
    id,
    title: "School Carnival Support",
    details:
      "Our local school carnival is this Saturday. Organizers are looking for drinks and light sponsorship support for families.",
    whenLine: "Saturday · 10:00 AM to 2:00 PM",
    sourceLine: "Shared by the school community board",
  };
}

export default function OpportunityDetailPage({ params, searchParams }: OpportunityPageProps) {
  const opportunity = demoOpportunity(params.id);
  const showMessage = searchParams?.help === "1";
  const helpHref = `/${params.townSlug}/opportunity/${opportunity.id}?help=1`;
  const laterHref = `/${params.townSlug}`;
  const sendHref = `/${params.townSlug}/commitment/${opportunity.id}`;

  return (
    <section className="space-y-6">
      <OpportunityCard data={opportunity} />

      <section
        className="rounded-2xl p-4 md:p-5 space-y-3"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <h2 className="text-lg font-semibold">How would you like to respond?</h2>
        <p className="text-base leading-relaxed" style={{ color: "var(--muted)" }}>
          If this is a fit, we can send one calm message and keep it simple.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href={helpHref}
            className="rounded-xl text-base font-medium px-4 py-3 inline-flex items-center justify-center no-underline"
            style={{ background: "var(--accent)", color: "#ffffff" }}
          >
            I Can Help
          </a>
          <a
            href={laterHref}
            className="rounded-xl text-base font-medium px-4 py-3 inline-flex items-center justify-center no-underline"
            style={{ border: "1px solid var(--border)", color: "var(--text)", background: "var(--surface)" }}
          >
            Maybe Later
          </a>
        </div>
      </section>

      {showMessage ? (
        <AIMessagePreview
          message="Hi there — we’d be glad to help with drinks for the school carnival. We can support in a way that fits your setup. Thanks for organizing something great for local families."
          sendHref={sendHref}
        />
      ) : null}
    </section>
  );
}
