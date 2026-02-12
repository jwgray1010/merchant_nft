type StreakDotsProps = {
  days: boolean[];
  className?: string;
};

function normalizeDays(days: boolean[]): boolean[] {
  const safe = [...days].slice(-7);
  while (safe.length < 7) {
    safe.unshift(false);
  }
  return safe;
}

export function StreakDots({ days, className = "" }: StreakDotsProps) {
  const normalized = normalizeDays(days);
  const shownUp = normalized.filter(Boolean).length;

  return (
    <details className={`inline-block ${className}`.trim()}>
      <summary
        className="list-none inline-flex items-center gap-1 cursor-pointer select-none"
        aria-label="Open weekly progress details"
      >
        {normalized.map((active, index) => (
          <span
            // eslint-disable-next-line react/no-array-index-key
            key={index}
            aria-hidden
            className={active ? "text-[#1F4E79]" : "text-[#C6CCD6]"}
            style={{ lineHeight: 1 }}
          >
            {active ? "●" : "○"}
          </span>
        ))}
      </summary>
      <p className="mt-2 text-sm text-[#6B7280]">{shownUp} of 7 days this week.</p>
    </details>
  );
}
