export type AuthUser = {
  id: string;
  email: string | null;
  actorId?: string;
  brandRole?: "owner" | "admin" | "member";
};
