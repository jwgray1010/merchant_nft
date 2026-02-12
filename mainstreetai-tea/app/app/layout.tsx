import "../globals.css";
import type { ReactNode } from "react";
import { Camera, Clock, MapPin, Sparkles, TrendingUp } from "lucide-react";
import { COLORS } from "../../styles/localPremiumTokens";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex justify-center" style={{ background: COLORS.background }}>
      <div className="w-full max-w-md px-4 pt-4 pb-24">{children}</div>
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md px-4 pb-4">
        <div
          className="rounded-2xl bg-white border shadow-sm px-3 py-2 flex items-center justify-between"
          style={{ borderColor: COLORS.border }}
        >
          <a className="text-xs flex flex-col items-center gap-1 transition-all duration-150 ease-out hover:opacity-95 active:scale-[0.98]" style={{ color: COLORS.subtext }} href="/app/app">
            <Sparkles size={16} strokeWidth={1.5} color={COLORS.subtext} />
            Home
          </a>
          <a className="text-xs flex flex-col items-center gap-1 transition-all duration-150 ease-out hover:opacity-95 active:scale-[0.98]" style={{ color: COLORS.subtext }} href="/app/media">
            <Camera size={16} strokeWidth={1.5} color={COLORS.subtext} />
            Media
          </a>
          <a className="text-xs flex flex-col items-center gap-1 transition-all duration-150 ease-out hover:opacity-95 active:scale-[0.98]" style={{ color: COLORS.subtext }} href="/app/post-now">
            <Clock size={16} strokeWidth={1.5} color={COLORS.subtext} />
            Post
          </a>
          <a className="text-xs flex flex-col items-center gap-1 transition-all duration-150 ease-out hover:opacity-95 active:scale-[0.98]" style={{ color: COLORS.subtext }} href="/app/town">
            <MapPin size={16} strokeWidth={1.5} color={COLORS.subtext} />
            Town
          </a>
          <a className="text-xs flex flex-col items-center gap-1 transition-all duration-150 ease-out hover:opacity-95 active:scale-[0.98]" style={{ color: COLORS.subtext }} href="/app/insights">
            <TrendingUp size={16} strokeWidth={1.5} color={COLORS.subtext} />
            Insights
          </a>
        </div>
      </nav>
    </div>
  );
}
