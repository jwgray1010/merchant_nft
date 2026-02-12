import { Building2, HeartHandshake, Store } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { NeighborhoodChip } from "../../components/ui/Chip";
import { SectionTitle } from "../../components/ui/SectionTitle";
import { StreetDivider } from "../../components/ui/StreetDivider";
import { COLORS } from "../../styles/localPremiumTokens";

const CATEGORIES = ["Food & Drink", "Fitness", "Retail", "Services"] as const;

export default function LocalNetworkPage() {
  return (
    <main className="min-h-screen flex justify-center" style={{ background: COLORS.background }}>
      <div className="w-full max-w-md px-4 py-6 space-y-4">
        <Card>
          <NeighborhoodChip>Local Network Member</NeighborhoodChip>
          <h1 className="text-xl font-semibold tracking-tight" style={{ marginTop: 12, color: COLORS.text }}>
            What is the Local Network?
          </h1>
          <p className="text-base leading-relaxed" style={{ marginTop: 10, color: COLORS.subtext }}>
            The Local Network is a simple community identity for local businesses that choose to support Main Street
            momentum together.
          </p>
        </Card>

        <Card>
          <SectionTitle>Why support these businesses?</SectionTitle>
          <div className="space-y-3" style={{ color: COLORS.text }}>
            <p className="text-base leading-relaxed inline-flex items-start gap-2">
              <HeartHandshake size={16} strokeWidth={1.5} color={COLORS.subtext} style={{ marginTop: 4 }} />
              Local spending helps keep neighborhood jobs, services, and daily life strong.
            </p>
            <p className="text-base leading-relaxed inline-flex items-start gap-2">
              <Store size={16} strokeWidth={1.5} color={COLORS.subtext} style={{ marginTop: 4 }} />
              Members use calm, community-first messaging and practical offers.
            </p>
            <p className="text-base leading-relaxed inline-flex items-start gap-2">
              <Building2 size={16} strokeWidth={1.5} color={COLORS.subtext} style={{ marginTop: 4 }} />
              This is about trust and identity, not rankings or competition.
            </p>
          </div>
        </Card>

        <StreetDivider />

        <Card>
          <SectionTitle>Participating categories</SectionTitle>
          <div className="flex flex-wrap gap-2" style={{ marginTop: 8 }}>
            {CATEGORIES.map((category) => (
              <NeighborhoodChip key={category}>{category}</NeighborhoodChip>
            ))}
          </div>
          <p className="text-sm" style={{ marginTop: 10, color: COLORS.subtext }}>
            Categories are listed for discovery only. No rankings are shown.
          </p>
        </Card>
      </div>
    </main>
  );
}
