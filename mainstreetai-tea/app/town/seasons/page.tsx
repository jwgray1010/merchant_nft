export default function TownSeasonsPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px", fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ marginBottom: 8 }}>Town Seasons</h1>
      <p style={{ color: "#4b5563", marginTop: 0 }}>
        Seasonal context for local routes: school cycles, holidays, sports windows, and local festivals.
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
        <h2 style={{ marginTop: 0 }}>Season overrides</h2>
        <p style={{ margin: "8px 0" }}>
          Open <code>/app/town/seasons</code> in Easy Mode to toggle season tags and add local notes for your town.
        </p>
        <p style={{ color: "#4b5563", marginBottom: 0 }}>
          Suggestions remain category-level and privacy-safe.
        </p>
      </section>
    </main>
  );
}
