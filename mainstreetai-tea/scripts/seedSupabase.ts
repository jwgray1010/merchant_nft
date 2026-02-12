import "dotenv/config";
import { brandProfileSchema } from "../src/schemas/brandSchema";
import { SupabaseAdapter } from "../src/storage/supabase/SupabaseAdapter";

function parseArg(flag: string): string | null {
  const index = process.argv.findIndex((entry) => entry === flag);
  if (index === -1) {
    return null;
  }
  const next = process.argv[index + 1];
  return next ? next.trim() : null;
}

async function run(): Promise<void> {
  const userId = parseArg("--user-id") ?? process.env.SUPABASE_SEED_USER_ID ?? "";
  if (!userId) {
    throw new Error(
      "Missing user id. Use --user-id <uuid> or set SUPABASE_SEED_USER_ID in your environment.",
    );
  }

  const adapter = new SupabaseAdapter();
  const seedBrand = brandProfileSchema.parse({
    brandId: "main-street-nutrition",
    businessName: "Main Street Nutrition",
    location: "Independence, KS",
    type: "loaded-tea",
    voice: "Friendly, local, and energetic without sounding salesy.",
    audiences: ["teachers", "parents", "teens", "gym"],
    productsOrServices: ["loaded teas", "protein shakes", "combo deals"],
    hours: "Mon-Fri 6:30am-6pm, Sat 8am-2pm, Sun closed",
    typicalRushTimes: "Before school, lunch, and after school pickup",
    slowHours: "1pm-3pm",
    offersWeCanUse: [
      "Teacher Tuesday add-on",
      "Afternoon combo",
      "Bring-a-friend sampler",
    ],
    constraints: {
      noHugeDiscounts: true,
      keepPromosSimple: true,
      avoidCorporateLanguage: true,
      avoidControversy: true,
    },
  });

  const created = await adapter.createBrand(userId, seedBrand);
  if (created) {
    console.log(`Seeded brand '${created.brandId}' for user ${userId}.`);
    return;
  }

  const updated = await adapter.updateBrand(userId, seedBrand.brandId, seedBrand);
  if (!updated) {
    throw new Error("Unable to seed brand. Create and update both failed.");
  }
  console.log(`Updated existing brand '${updated.brandId}' for user ${userId}.`);
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown seed error";
  console.error(`seed:supabase failed: ${message}`);
  process.exitCode = 1;
});
