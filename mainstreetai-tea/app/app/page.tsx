import { Card } from "../../components/ui/Card";
import { NeighborhoodChip } from "../../components/ui/Chip";
import { SectionTitle } from "../../components/ui/SectionTitle";
import { StreakDots } from "../../components/ui/StreakDots";
import { StreetDivider } from "../../components/ui/StreetDivider";
import { COLORS } from "../../styles/localPremiumTokens";

export default function PremiumLocalHomePage() {
  return (
    <main className="space-y-6">
      <Card>
        <div className="flex flex-wrap gap-2" style={{ marginBottom: 10 }}>
          <NeighborhoodChip>🟢 Local Presence Active</NeighborhoodChip>
        </div>
        <SectionTitle>Good to see you</SectionTitle>
        <h1 className="text-xl font-semibold tracking-tight" style={{ marginTop: 8, color: COLORS.text }}>
          We're checking in together today.
        </h1>
        <p className="text-base leading-relaxed" style={{ marginTop: 8, color: COLORS.subtext }}>
          Good morning - our town feels steady today.
        </p>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <NeighborhoodChip>Our community is moving steadily.</NeighborhoodChip>
          <a href="/app/progress" className="no-underline">
            <StreakDots days={[true, true, true, false, false, true, true]} />
          </a>
        </div>
        <p className="text-base leading-relaxed" style={{ marginTop: 8, color: COLORS.subtext }}>
          We're showing up together today.
        </p>
      </Card>
      <a
        href="/app?runDaily=1"
        className="w-full py-6 text-xl rounded-2xl bg-[#1F4E79] text-white transition-all duration-150 ease-out hover:opacity-95 active:scale-[0.98] font-semibold no-underline inline-flex items-center justify-center"
      >
        Today's Plan
      </a>
      <a
        href="/app/camera"
        className="w-full py-6 text-xl rounded-2xl bg-[#1F4E79] text-white transition-all duration-150 ease-out hover:opacity-95 active:scale-[0.98] font-semibold no-underline inline-flex items-center justify-center"
      >
        <span className="inline-flex items-center gap-2">📷 Snap &amp; Share</span>
      </a>
      <a
        href="/app#how-it-went"
        className="w-full py-6 text-xl rounded-2xl border border-[#E6E7EB] bg-white text-[#0F172A] transition-all duration-150 ease-out hover:opacity-95 active:scale-[0.98] font-semibold no-underline inline-flex items-center justify-center"
      >
        How Did It Go?
      </a>
      <p className="text-base leading-relaxed" style={{ color: COLORS.subtext }}>
        Made for local owners. Built for real life.
      </p>

      <StreetDivider />
      <Card>
        <p className="text-base leading-relaxed" style={{ color: COLORS.subtext }}>
          Main Street test: easy to understand in one glance.
        </p>
        <p className="text-base leading-relaxed" style={{ color: COLORS.subtext, marginTop: 6 }}>
          Presence test: calm community feeling without extra noise.
        </p>
      </Card>
    </main>
  );
}
