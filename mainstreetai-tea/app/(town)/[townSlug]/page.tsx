import { OpportunityPreviewCard } from "../../../components/cards/OpportunityPreviewCard";
import { SnapShareCard } from "../../../components/cards/SnapShareCard";
import { TodayPlanCard } from "../../../components/cards/TodayPlanCard";

type HomePageProps = {
  params: {
    townSlug: string;
  };
};

const DEMO_OPPORTUNITY_ID = "school-carnival";

export default function TownHomePage({ params }: HomePageProps) {
  const opportunityHref = `/${params.townSlug}/opportunity/${DEMO_OPPORTUNITY_ID}`;

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Good morning — we’re glad you’re here.</h1>
        <p className="text-base leading-relaxed" style={{ color: "var(--muted)" }}>
          Here are the three things we can keep simple today.
        </p>
      </header>

      <TodayPlanCard href={`/${params.townSlug}/opportunity/${DEMO_OPPORTUNITY_ID}`} />
      <SnapShareCard href={`/${params.townSlug}/commitment/${DEMO_OPPORTUNITY_ID}`} />
      <OpportunityPreviewCard
        title="School Carnival Support"
        summary="The PTA is looking for local help with refreshments. A small yes goes a long way."
        href={opportunityHref}
      />
    </section>
  );
}
