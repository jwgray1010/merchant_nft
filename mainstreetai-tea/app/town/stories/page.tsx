export default function TownStoriesPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px", fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ marginBottom: 8 }}>Town Stories</h1>
      <p style={{ color: "#4b5563", marginTop: 0 }}>
        A warm, shared local narrative. No rankings, no metrics, no private data.
      </p>
      <section
        style={{
          marginTop: 16,
          border: "1px solid #e5e7eb",
          borderRadius: 12,
          padding: 16,
          background: "#ffffff",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Latest story</h2>
        <p style={{ margin: "8px 0" }}>
          Open <code>/app/town/stories</code> in Easy Mode to view the latest generated town story for your selected
          business.
        </p>
        <p style={{ color: "#4b5563", marginBottom: 0 }}>How locals are supporting each other this week...</p>
      </section>
    </main>
  );
}
