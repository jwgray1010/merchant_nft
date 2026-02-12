import type { HTMLAttributes } from "react";

type ChipProps = HTMLAttributes<HTMLSpanElement>;

export function NeighborhoodChip({ className = "", ...props }: ChipProps) {
  return (
    <span
      className={`px-3 py-1 rounded-full bg-[#E9F3FF] text-sm text-[#1F4E79] ${className}`.trim()}
      {...props}
    />
  );
}
