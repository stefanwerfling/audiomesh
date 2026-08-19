import { Vts, type ExtractSchemaResultType } from 'vts';

/** Role model. Only `admin` is enforced in the MVP; the others are designed in
 *  so the RBAC layer can grow without a schema change. */
export const UserRoleSchema = Vts.or([
    Vts.equal('admin' as const),
    Vts.equal('operator' as const),
    Vts.equal('viewer' as const),
]);
export type UserRole = ExtractSchemaResultType<typeof UserRoleSchema>;

export const LoginBodySchema = Vts.object({
    username: Vts.string(),
    password: Vts.string(),
});
export type LoginBody = ExtractSchemaResultType<typeof LoginBodySchema>;

export const AuthUserSchema = Vts.object({
    username: Vts.string(),
    role: UserRoleSchema,
});
export type AuthUser = ExtractSchemaResultType<typeof AuthUserSchema>;

/** Login response. The token is a signed JWT; the frontend stores it and sends
 *  it as a Bearer header on subsequent requests. */
export const LoginResultSchema = Vts.object({
    ok: Vts.boolean(),
    token: Vts.optional(Vts.string()),
    user: Vts.optional(AuthUserSchema),
    message: Vts.optional(Vts.string()),
});
export type LoginResult = ExtractSchemaResultType<typeof LoginResultSchema>;

/** Current-session probe for `GET /api/v1/auth/me`. */
export const AuthStateSchema = Vts.object({
    authenticated: Vts.boolean(),
    user: Vts.optional(AuthUserSchema),
});
export type AuthState = ExtractSchemaResultType<typeof AuthStateSchema>;
