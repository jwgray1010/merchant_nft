import "../globals.css";
import type { ReactNode } from "react";
import { Camera, Clock, MapPin, Sparkles, TrendingUp } from "lucide-react";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F8F9FB] flex justify-center">
      <div className="w-full max-w-md px-4 pt-4 pb-24">{children}</div>
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md px-4 pb-4">
        <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-sm px-3 py-2 flex items-center justify-between">
          <a className="text-[#6B7280] text-xs flex flex-col items-center gap-1" href="/app/app">
            <Sparkles size={16} />
            Home
          </a>
          <a className="text-[#6B7280] text-xs flex flex-col items-center gap-1" href="/app/media">
            <Camera size={16} />
            Media
          </a>
          <a className="text-[#6B7280] text-xs flex flex-col items-center gap-1" href="/app/post-now">
            <Clock size={16} />
            Post
          </a>
          <a className="text-[#6B7280] text-xs flex flex-col items-center gap-1" href="/app/town">
            <MapPin size={16} />
            Town
          </a>
          <a className="text-[#6B7280] text-xs flex flex-col items-center gap-1" href="/app/insights">
            <TrendingUp size={16} />
            Insights
          </a>
        </div>
      </nav>
    </div>
  );
}
