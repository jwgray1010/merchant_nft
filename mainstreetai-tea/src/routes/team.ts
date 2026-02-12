import { Router } from "express";
import { z } from "zod";
import { FEATURES } from "../config/featureFlags";
import { getStorageMode } from "../storage/getAdapter";
import { getSupabaseAdminClient } from "../supabase/supabaseAdmin";
import { teamInviteRequestSchema, teamRoleSchema } from "../schemas/teamSchema";

const router = Router();

const brandIdSchema = z.string().min(1);

function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:3001").trim().replace(/\/+$/, "");
}

function ensureEnabled() {
  if (!FEATURES.teams) {
    throw new Error("Teams feature is disabled");
  }
  if (getStorageMode() === "local") {
    throw new Error("Teams are only available in supabase storage mode");
  }
}

function parseBrandId(raw: unknown): string | null {
  const parsed = brandIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

router.get("/", async (req, res, next) => {
  const brandAccess = req.brandAccess;
  if (!brandAccess) {
    return res.status(400).json({ error: "Missing brandId query parameter" });
  }
  if (brandAccess.role !== "owner" && brandAccess.role !== "admin") {
    return res.status(403).json({ error: "Insufficient role permissions" });
  }
  try {
    ensureEnabled();
    if (!brandAccess.brandRef) {
      return res.status(400).json({ error: "Unable to resolve brand reference" });
    }
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("team_members")
      .select("id, owner_id, user_id, role, created_at")
      .eq("owner_id", brandAccess.ownerId)
      .eq("brand_ref", brandAccess.brandRef ?? "");
    if (error) {
      throw error;
    }

    const rows = (data ?? []) as Array<{
      id: string;
      owner_id: string;
      user_id: string;
      role: string;
      created_at: string;
    }>;

    const usersWithEmail = await Promise.all(
      rows.map(async (row) => {
        const user = await supabase.auth.admin.getUserById(row.user_id);
        return {
          id: row.id,
          ownerId: row.owner_id,
          brandId: brandAccess.brandId,
          userId: row.user_id,
          role: teamRoleSchema.safeParse(row.role).success
            ? (row.role as "owner" | "admin" | "member")
            : "member",
          email: user.data.user?.email ?? undefined,
          createdAt: row.created_at,
        };
      }),
    );

    const ownerEmail =
      req.user?.actorId && req.user.actorId === brandAccess.ownerId ? req.user.email ?? undefined : undefined;
    return res.json([
      {
        id: `owner-${brandAccess.ownerId}`,
        ownerId: brandAccess.ownerId,
        brandId: brandAccess.brandId,
        userId: brandAccess.ownerId,
        role: "owner",
        email: ownerEmail,
        createdAt: new Date().toISOString(),
      },
      ...usersWithEmail.filter((entry) => entry.userId !== brandAccess.ownerId),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("feature is disabled") || message.includes("only available")) {
      return res.status(400).json({ error: message });
    }
    return next(error);
  }
});

router.post("/invite", async (req, res, next) => {
  const brandAccess = req.brandAccess;
  if (!brandAccess) {
    return res.status(400).json({ error: "Missing brandId query parameter" });
  }
  if (brandAccess.role !== "owner") {
    return res.status(403).json({ error: "Only owners can invite team members" });
  }
  const parsedBody = teamInviteRequestSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid invite payload",
      details: parsedBody.error.flatten(),
    });
  }

  try {
    ensureEnabled();
    if (!brandAccess.brandRef) {
      return res.status(400).json({ error: "Unable to resolve brand reference" });
    }
    const supabase = getSupabaseAdminClient();
    const invite = await supabase.auth.admin.inviteUserByEmail(parsedBody.data.email, {
      redirectTo: `${appBaseUrl()}/admin/welcome`,
    });
    if (invite.error || !invite.data.user?.id) {
      return res.status(400).json({
        error: invite.error?.message ?? "Failed to invite team member",
      });
    }

    const { data, error } = await supabase
      .from("team_members")
      .upsert(
        {
          owner_id: brandAccess.ownerId,
          brand_ref: brandAccess.brandRef,
          user_id: invite.data.user.id,
          role: parsedBody.data.role,
        },
        {
          onConflict: "owner_id,brand_ref,user_id",
        },
      )
      .select("id, owner_id, user_id, role, created_at")
      .single();
    if (error) {
      throw error;
    }

    return res.status(201).json({
      id: data.id,
      ownerId: data.owner_id,
      brandId: brandAccess.brandId,
      userId: data.user_id,
      role: data.role,
      email: parsedBody.data.email,
      createdAt: data.created_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("feature is disabled") || message.includes("only available")) {
      return res.status(400).json({ error: message });
    }
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  const brandAccess = req.brandAccess;
  if (!brandAccess) {
    return res.status(400).json({ error: "Missing brandId query parameter" });
  }
  if (brandAccess.role !== "owner") {
    return res.status(403).json({ error: "Only owners can remove team members" });
  }
  const memberId = req.params.id?.trim();
  if (!memberId) {
    return res.status(400).json({ error: "Missing team member id route parameter" });
  }

  try {
    ensureEnabled();
    if (!brandAccess.brandRef) {
      return res.status(400).json({ error: "Unable to resolve brand reference" });
    }
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase
      .from("team_members")
      .delete()
      .eq("id", memberId)
      .eq("owner_id", brandAccess.ownerId)
      .eq("brand_ref", brandAccess.brandRef ?? "")
      .select("id")
      .maybeSingle();
    if (error) {
      throw error;
    }
    if (!data) {
      return res.status(404).json({ error: "Team member not found" });
    }
    return res.status(204).send();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("feature is disabled") || message.includes("only available")) {
      return res.status(400).json({ error: message });
    }
    return next(error);
  }
});

export default router;
