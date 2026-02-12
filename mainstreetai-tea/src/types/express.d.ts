import type { AuthUser } from "./auth";

declare global {
  namespace Express {
    interface BrandAccessContext {
      ownerId: string;
      brandId: string;
      brandRef?: string;
      role: "owner" | "admin" | "member";
    }

    interface TenantContext {
      id: string;
      ownerId: string;
      name?: string;
      domain?: string;
      logoUrl?: string;
      primaryColor?: string;
      supportEmail?: string;
      appName: string;
      tagline?: string;
      hideMainstreetaiBranding: boolean;
    }

    interface Request {
      user?: AuthUser;
      brandAccess?: BrandAccessContext;
      tenant?: TenantContext;
    }
  }
}

export {};
