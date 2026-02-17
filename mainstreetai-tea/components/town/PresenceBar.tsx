type PresenceBarProps = {
  line: string;
};

export function PresenceBar({ line }: PresenceBarProps) {
  return (
    <div
      className="rounded-full px-3 py-1 text-sm inline-flex items-center gap-2"
      style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
    >
      <span aria-hidden="true">🟢</span>
      <span>{`Town Presence Active — ${line}`}</span>
    </div>
  );
}
