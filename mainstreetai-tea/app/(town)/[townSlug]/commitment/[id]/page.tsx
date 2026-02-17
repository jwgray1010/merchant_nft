type CommitmentPageProps = {
  params: {
    townSlug: string;
    id: string;
  };
};

function demoTxHash(id: string): string {
  const compact = id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) || "commitment";
  return `0x${compact.padEnd(12, "0")}`;
}

export default function CommitmentConfirmationPage({ params }: CommitmentPageProps) {
  const txHash = demoTxHash(params.id);

  return (
    <section className="space-y-6">
      <article
        className="rounded-2xl p-4 md:p-5 space-y-3"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Commitment Confirmation
        </p>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Thank you — your support is confirmed.</h1>
        <p className="text-base leading-relaxed">
          Your message has been prepared and this opportunity is now marked as supported.
        </p>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          tx: <span className="font-mono">{txHash}</span>
        </p>
      </article>

      <article
        className="rounded-2xl p-4 md:p-5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        <p className="text-base leading-relaxed">We’re building this town together.</p>
      </article>

      <a
        href={`/${params.townSlug}`}
        className="rounded-xl text-base font-medium px-4 py-3 inline-flex items-center justify-center no-underline"
        style={{ border: "1px solid var(--border)", color: "var(--text)", background: "var(--surface)" }}
      >
        Back to Home
      </a>
    </section>
  );
}
