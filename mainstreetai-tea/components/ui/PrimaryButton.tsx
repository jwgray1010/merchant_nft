import type { ButtonHTMLAttributes } from "react";

type PrimaryButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

export function PrimaryButton({ className = "", ...props }: PrimaryButtonProps) {
  return (
    <button
      className={`w-full py-4 text-lg font-semibold rounded-xl text-white bg-[#1F7AE0] hover:opacity-95 transition-all duration-150 ease-out active:scale-[0.98] ${className}`.trim()}
      {...props}
    />
  );
}
