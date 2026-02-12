import type { AuthUser } from "./auth";

declare global {
  namespace Express {
    interface BrandAccessContext {
      ownerId: string;
      brandId: string;
      brandRef?: string;
      role: "owner" | "admin" | "member";
    }

    interface Request {
      user?: AuthUser;
      brandAccess?: BrandAccessContext;
    }
  }
}

export {};
