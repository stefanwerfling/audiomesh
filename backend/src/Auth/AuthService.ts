import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthUser, LoginBody, UserRole } from '@audiomesh/schemas';
import { Logger } from 'figtree';

interface TokenPayload {
    username: string;
    role: UserRole;
    exp: number;
}

/**
 * Minimal local authentication for the MVP. A single admin account (credentials
 * from env, defaulting to `admin`/`admin` with a loud warning) plus HMAC-signed
 * bearer tokens. The role model (`admin`/`operator`/`viewer`) is already in the
 * token so RBAC can grow without a wire change — only `admin` exists today.
 *
 * Not a full IdP: no user store, no refresh tokens. Those are additive later; the
 * route-level check only needs `verify(token)`.
 */
export class AuthService {

    private static _instance: AuthService | null = null;

    public static getInstance(): AuthService {
        if (AuthService._instance === null) {
            AuthService._instance = new AuthService();
        }
        return AuthService._instance;
    }

    private static readonly TTL_MS: number = 12 * 60 * 60 * 1000;

    private readonly _username: string;
    private readonly _password: string;
    private readonly _secret: string;

    public constructor() {
        this._username = process.env['AUDIOMESH_ADMIN_USER'] ?? 'admin';
        this._password = process.env['AUDIOMESH_ADMIN_PASSWORD'] ?? 'admin';
        const envSecret: string | undefined = process.env['AUDIOMESH_JWT_SECRET'];
        this._secret = envSecret !== undefined && envSecret.length > 0
            ? envSecret
            : randomBytes(32).toString('hex');
        if (this._password === 'admin') {
            Logger.getLogger().warn(
                'AuthService: using default admin password — set AUDIOMESH_ADMIN_PASSWORD in production',
            );
        }
    }

    public login(body: LoginBody): string | null {
        const userOk: boolean = AuthService._safeEqual(body.username, this._username);
        const passOk: boolean = AuthService._safeEqual(body.password, this._password);
        if (!userOk || !passOk) {
            return null;
        }
        return this._sign({
            username: this._username,
            role: 'admin',
            exp: Date.now() + AuthService.TTL_MS,
        });
    }

    public verify(token: string): AuthUser | null {
        const dot: number = token.lastIndexOf('.');
        if (dot <= 0) {
            return null;
        }
        const body: string = token.slice(0, dot);
        const sig: string = token.slice(dot + 1);
        const expected: string = this._hmac(body);
        if (!AuthService._safeEqual(sig, expected)) {
            return null;
        }
        try {
            const payload: TokenPayload = JSON.parse(
                Buffer.from(body, 'base64url').toString('utf-8'),
            ) as TokenPayload;
            if (payload.exp < Date.now()) {
                return null;
            }
            return { username: payload.username, role: payload.role };
        } catch {
            return null;
        }
    }

    private _sign(payload: TokenPayload): string {
        const body: string = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
        return `${body}.${this._hmac(body)}`;
    }

    private _hmac(body: string): string {
        return createHmac('sha256', this._secret).update(body).digest('base64url');
    }

    private static _safeEqual(a: string, b: string): boolean {
        const bufferA: Buffer = Buffer.from(a, 'utf-8');
        const bufferB: Buffer = Buffer.from(b, 'utf-8');
        if (bufferA.length !== bufferB.length) {
            return false;
        }
        return timingSafeEqual(bufferA, bufferB);
    }

}
