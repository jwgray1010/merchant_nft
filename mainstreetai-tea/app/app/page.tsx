import { Camera, Clock, MapPin, Sparkles, TrendingUp } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { NeighborhoodChip } from "../../components/ui/Chip";
import { PrimaryButton } from "../../components/ui/PrimaryButton";
import { RouteCard } from "../../components/ui/RouteCard";
import { SectionTitle } from "../../components/ui/SectionTitle";
import { StreakDots } from "../../components/ui/StreakDots";
import { StreetDivider } from "../../components/ui/StreetDivider";
import { COLORS } from "../../styles/localPremiumTokens";

export default function PremiumLocalHomePage() {
  return (
    <main className="space-y-6">
      <Card>
        <div className="flex flex-wrap gap-2" style={{ marginBottom: 10 }}>
          <NeighborhoodChip>Local Network Member</NeighborhoodChip>
          <NeighborhoodChip>Town Pulse: Active</NeighborhoodChip>
          <NeighborhoodChip>After Work</NeighborhoodChip>
          <NeighborhoodChip>School Week</NeighborhoodChip>
        </div>
        <SectionTitle>Good to see you</SectionTitle>
        <h1 className="text-xl font-semibold tracking-tight" style={{ marginTop: 8, color: COLORS.text }}>
          Ready for your daily local move?
        </h1>
        <p className="text-base leading-relaxed" style={{ marginTop: 8, color: COLORS.subtext }}>
          One tap creates your special, caption, and sign with calm, neighborhood-friendly copy.
        </p>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <NeighborhoodChip>Momentum: Rising</NeighborhoodChip>
          <a href="/app/progress" className="no-underline">
            <StreakDots days={[true, true, true, false, false, true, true]} />
          </a>
        </div>
        <p className="text-base leading-relaxed" style={{ marginTop: 8, color: COLORS.subtext }}>
          You've been showing up consistently - keep today's step simple.
        </p>
      </Card>
      <a
        href="/camera"
        className="w-full py-6 text-xl rounded-2xl bg-[#1F4E79] text-white transition-all duration-150 ease-out hover:opacity-95 active:scale-[0.98] font-semibold no-underline inline-flex items-center justify-center"
      >
        <span className="inline-flex items-center gap-2">📷 Snap &amp; Post</span>
      </a>
      <PrimaryButton className="py-6 text-xl rounded-2xl bg-[#1F4E79]" type="button">
        <span className="inline-flex items-center gap-2">
          <Sparkles size={20} strokeWidth={1.5} />
          Make Me Money Today
        </span>
      </PrimaryButton>
      <p className="text-base leading-relaxed" style={{ color: COLORS.subtext }}>
        Made for local owners. Built for real life.
      </p>

      <StreetDivider />

      <section className="grid grid-cols-2 gap-3">
        <Card>
          <a className="block text-[#111827] no-underline" href="/app/media">
            <Camera size={16} strokeWidth={1.5} color={COLORS.subtext} />
            <h2 className="text-base font-semibold tracking-tight" style={{ marginTop: 10 }}>
              Media
            </h2>
            <p className="text-base leading-relaxed" style={{ marginTop: 6, color: COLORS.subtext }}>
              Improve photo captions.
            </p>
          </a>
        </Card>
        <Card>
          <a className="block text-[#111827] no-underline" href="/app/post-now">
            <Clock size={16} strokeWidth={1.5} color={COLORS.subtext} />
            <h2 className="text-base font-semibold tracking-tight" style={{ marginTop: 10 }}>
              Post Now
            </h2>
            <p className="text-base leading-relaxed" style={{ marginTop: 6, color: COLORS.subtext }}>
              Check best timing now.
            </p>
          </a>
        </Card>
        <Card>
          <a className="block text-[#111827] no-underline" href="/app/town">
            <MapPin size={16} strokeWidth={1.5} color={COLORS.subtext} />
            <h2 className="text-base font-semibold tracking-tight" style={{ marginTop: 10 }}>
              Town
            </h2>
            <p className="text-base leading-relaxed" style={{ marginTop: 6, color: COLORS.subtext }}>
              View local network flow.
            </p>
          </a>
        </Card>
        <Card>
          <a className="block text-[#111827] no-underline" href="/app/insights">
            <TrendingUp size={16} strokeWidth={1.5} color={COLORS.subtext} />
            <h2 className="text-base font-semibold tracking-tight" style={{ marginTop: 10 }}>
              What worked lately
            </h2>
            <p className="text-base leading-relaxed" style={{ marginTop: 6, color: COLORS.subtext }}>
              See what to repeat.
            </p>
          </a>
        </Card>
      </section>

      <StreetDivider />
      <RouteCard steps={["Coffee", "Recharge", "Errands"]} line="A simple itinerary style flow, not analytics." />
    </main>
  );
}
