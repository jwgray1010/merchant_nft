import type { ButtonHTMLAttributes } from "react";

type PrimaryButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function PrimaryButton({ className = "", ...props }: PrimaryButtonProps) {
  return (
    <button
      className={`w-full py-5 text-lg font-semibold rounded-xl bg-[#1F4E79] text-white transition-all duration-150 ease-out hover:opacity-95 active:scale-[0.98] ${className}`.trim()}
      {...props}
    />
  );
}
