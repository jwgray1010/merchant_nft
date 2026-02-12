export default function TownGraphPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px", fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ marginBottom: 8 }}>Town Graph</h1>
      <p style={{ color: "#4b5563", marginTop: 0 }}>
        Category-level local flow intelligence for towns. No private metrics, no rankings.
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
        <h2 style={{ marginTop: 0 }}>Common local flow</h2>
        <p style={{ margin: "8px 0" }}>Coffee / Cafe → Fitness → Salon / Beauty → Retail</p>
        <p style={{ color: "#4b5563", marginBottom: 0 }}>
          Open <code>/app/town/graph</code> in Easy Mode to view flow suggestions for your selected town.
        </p>
      </section>
    </main>
  );
}
