import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className = "", ...props }: CardProps) {
  return (
    <div
      className={`bg-white rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-5 ${className}`.trim()}
      {...props}
    />
  );
}
