import type { HTMLAttributes } from "react";

type SectionTitleProps = HTMLAttributes<HTMLParagraphElement>;

export function SectionTitle({ className = "", ...props }: SectionTitleProps) {
  return <p className={`text-xs uppercase tracking-wider text-[#6B7280] ${className}`.trim()} {...props} />;
}
