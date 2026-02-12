import { Card } from "../../components/ui/Card";
import { NeighborhoodChip } from "../../components/ui/Chip";
import { SectionTitle } from "../../components/ui/SectionTitle";
import { StreakDots } from "../../components/ui/StreakDots";
import { StreetDivider } from "../../components/ui/StreetDivider";
import { COLORS } from "../../styles/localPremiumTokens";

export default function ProgressPage() {
  const week = [true, true, true, false, false, true, true];
  const shownUp = week.filter(Boolean).length;

  return (
    <main className="space-y-6">
      <Card>
        <SectionTitle>Owner Progress</SectionTitle>
        <h1 className="text-xl font-semibold tracking-tight" style={{ color: COLORS.text }}>
          You've shown up {shownUp} days this week.
        </h1>
        <p className="text-base leading-relaxed" style={{ marginTop: 8, color: COLORS.subtext }}>
          Slow days happen - consistency wins.
        </p>
      </Card>

      <Card>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <NeighborhoodChip>Momentum: Steady</NeighborhoodChip>
          <StreakDots days={week} />
        </div>
        <p className="text-base leading-relaxed" style={{ marginTop: 10, color: COLORS.subtext }}>
          You don't need perfect days. Keep the next action simple and repeatable.
        </p>
      </Card>

      <StreetDivider />

      <Card>
        <h2 className="text-base font-semibold tracking-tight">Win moment</h2>
        <p className="text-base leading-relaxed" style={{ marginTop: 8, color: COLORS.text }}>
          Looks like your consistency is creating more steady traffic.
        </p>
      </Card>
    </main>
  );
}
