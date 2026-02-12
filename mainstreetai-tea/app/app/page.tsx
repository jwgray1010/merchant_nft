import { Camera, Clock, MapPin, Sparkles, TrendingUp } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { SectionTitle } from "../../components/ui/SectionTitle";
import { COLORS } from "../../styles/designTokens";

export default function PremiumLocalHomePage() {
  return (
    <main className="space-y-4">
      <Card>
        <SectionTitle>Good to see you</SectionTitle>
        <h1 className="text-xl font-semibold tracking-tight text-[#111827]" style={{ marginTop: 8 }}>
          Ready for your daily local move?
        </h1>
        <p className="text-[#6B7280]" style={{ marginTop: 8 }}>
          One tap creates your special, caption, and sign with calm, neighborhood-friendly copy.
        </p>
      </Card>

      <button
        className="w-full py-6 text-xl rounded-2xl bg-[#1F7AE0] text-white font-semibold transition-all duration-150 ease-out active:scale-[0.98]"
        type="button"
      >
        <span className="inline-flex items-center gap-2">
          <Sparkles size={20} />
          Make Me Money Today
        </span>
      </button>

      <section className="grid grid-cols-2 gap-3">
        <Card>
          <a className="block text-[#111827] no-underline" href="/app/media">
            <Camera size={16} color={COLORS.subtext} />
            <h2 className="text-base font-semibold tracking-tight" style={{ marginTop: 10 }}>
              Media
            </h2>
            <p className="text-[#6B7280]" style={{ marginTop: 6 }}>
              Improve photo captions.
            </p>
          </a>
        </Card>
        <Card>
          <a className="block text-[#111827] no-underline" href="/app/post-now">
            <Clock size={16} color={COLORS.subtext} />
            <h2 className="text-base font-semibold tracking-tight" style={{ marginTop: 10 }}>
              Post Now
            </h2>
            <p className="text-[#6B7280]" style={{ marginTop: 6 }}>
              Check best timing now.
            </p>
          </a>
        </Card>
        <Card>
          <a className="block text-[#111827] no-underline" href="/app/town">
            <MapPin size={16} color={COLORS.subtext} />
            <h2 className="text-base font-semibold tracking-tight" style={{ marginTop: 10 }}>
              Town
            </h2>
            <p className="text-[#6B7280]" style={{ marginTop: 6 }}>
              View local network flow.
            </p>
          </a>
        </Card>
        <Card>
          <a className="block text-[#111827] no-underline" href="/app/insights">
            <TrendingUp size={16} color={COLORS.subtext} />
            <h2 className="text-base font-semibold tracking-tight" style={{ marginTop: 10 }}>
              Insights
            </h2>
            <p className="text-[#6B7280]" style={{ marginTop: 6 }}>
              See what to repeat.
            </p>
          </a>
        </Card>
      </section>
    </main>
  );
}
