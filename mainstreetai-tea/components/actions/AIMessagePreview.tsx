type AIMessagePreviewProps = {
  message: string;
  sendHref: string;
};

export function AIMessagePreview({ message, sendHref }: AIMessagePreviewProps) {
  return (
    <section
      className="rounded-2xl p-4 md:p-5 space-y-3"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <h2 className="text-lg font-semibold">AI message preview</h2>
      <p className="text-base leading-relaxed" style={{ color: "var(--text)" }}>
        {message}
      </p>
      <a
        href={sendHref}
        className="rounded-xl text-base font-medium px-4 py-3 inline-flex items-center justify-center no-underline"
        style={{ background: "var(--accent)", color: "#ffffff" }}
      >
        Send
      </a>
    </section>
  );
}
