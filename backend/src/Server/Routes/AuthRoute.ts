import { Router } from 'express';
import { DefaultRoute } from 'figtree';
import {
    AuthStateSchema,
    LoginBodySchema,
    LoginResultSchema,
    type AuthState,
    type LoginBody,
    type LoginResult,
} from '@audiomesh/schemas';
import { AuthService } from '../../Auth/AuthService.js';

/**
 * Local authentication API for the MVP:
 *  - `POST /api/v1/auth/login` (body: { username, password }) → signed token.
 *  - `GET  /api/v1/auth/me` — validates the `Authorization: Bearer <token>`
 *    header and reports the current user.
 *
 * Route-level enforcement across the rest of the API is additive (the token check
 * is already here); wiring `checkUserLogin` on every route is the remaining step.
 */
export class AuthRoute extends DefaultRoute {

    public constructor() {
        super();
        this._uriBase = '/api/';
    }

    public override getExpressRouter(): Router {
        this._post(
            this._getUrl('v1', 'auth', 'login'),
            false,
            async (req, _res, _data): Promise<LoginResult> => {
                const body: LoginBody = req.body as LoginBody;
                const token: string | null = AuthService.getInstance().login(body);
                if (token === null) {
                    return { ok: false, message: 'invalid credentials' };
                }
                return { ok: true, token: token, user: { username: body.username, role: 'admin' } };
            },
            {
                description: 'Authenticate and receive a bearer token.',
                tags: ['auth'],
                bodySchema: LoginBodySchema,
                responseBodySchema: LoginResultSchema,
            },
        );
        this._get(
            this._getUrl('v1', 'auth', 'me'),
            false,
            async (req, _res, _data): Promise<AuthState> => {
                const header: string = (req.headers['authorization'] as string | undefined) ?? '';
                const token: string = header.startsWith('Bearer ') ? header.slice(7) : '';
                const user = token.length > 0 ? AuthService.getInstance().verify(token) : null;
                if (user === null) {
                    return { authenticated: false };
                }
                return { authenticated: true, user: user };
            },
            {
                description: 'Report the currently authenticated user.',
                tags: ['auth'],
                responseBodySchema: AuthStateSchema,
            },
        );
        return super.getExpressRouter();
    }

}
