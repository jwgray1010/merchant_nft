type TownHeaderProps = {
  displayName: string;
  poweredByLine: string;
  logoUrl?: string;
};

export function TownHeader({ displayName, poweredByLine, logoUrl }: TownHeaderProps) {
  return (
    <header className="space-y-2">
      <div className="flex items-center gap-3">
        {logoUrl ? (
          <img src={logoUrl} alt={`${displayName} logo`} className="h-8 w-8 rounded-md object-cover" />
        ) : (
          <div
            className="h-8 w-8 rounded-md flex items-center justify-center text-sm font-semibold"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            🏛️
          </div>
        )}
        <div>
          <p className="text-lg font-semibold">{displayName}</p>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {poweredByLine}
          </p>
        </div>
      </div>
    </header>
  );
}
