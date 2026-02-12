import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className = "", ...props }: CardProps) {
  return <div className={`rounded-2xl p-5 shadow-sm bg-white ${className}`.trim()} {...props} />;
}
