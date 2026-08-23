import { createHash, randomBytes } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { firstValue, serializeCommand, type TsCommand } from '../command/TsCommand.js';
import type { Ts3Crypt } from '../crypto/Ts3Crypt.js';
import type { Ts3Identity } from '../crypto/Ts3Identity.js';

/**
 * The crypto handshake (`../PROTOCOL.md` §4.2 / §5.3) — the command exchange that
 * runs *after* the low-level Init1 puzzle and turns the connection into an
 * authenticated, encrypted session. It emits `clientinitiv` (ridden out on Init1
 * packet 4), consumes the server's `initivexpand`, derives the shared secret into
 * {@link Ts3Crypt}, sends `clientinit`, and completes on the server's
 * `initserver` + `notifyclientinitfinished`.
 *
 * Only the **old protocol (<3.1)** path is implemented; `initivexpand2` (the ≥3.1
 * license/Curve25519 flow) reports an error until its crypto lands.
 *
 * This works purely on parsed {@link TsCommand}s and the crypto primitives — it
 * neither wraps packets nor touches the socket, so it is fully unit-testable
 * against a simulated server that owns its own {@link Ts3Identity}.
 */
export interface HandshakeConfig {
    nickname: string;
    /** Full client version string the server checks (with client_version_sign). */
    clientVersion: string;
    clientVersionSign: string;
    clientPlatform: string;
    /** The server address the client dialed (goes in the `ip=` field). */
    serverAddress: string;
    /** Raw server password (hashed to base64(SHA1) here); empty when none. */
    serverPassword?: string;
    /** Channel to land in (id or path) and its raw password; both optional. */
    defaultChannel?: string;
    defaultChannelPassword?: string;
    /** Hardware id string; a stable value keeps the bot recognizable. */
    hwid?: string;
}

/** What the caller should do after feeding a server command to the handshake. */
export type HandshakeStep =
    | { kind: 'send'; command: TsCommand }
    | { kind: 'complete' }
    | { kind: 'ignore' }
    | { kind: 'error'; message: string };

/** TS3 hashes passwords as `base64( SHA1(password) )`; empty → empty. */
export function hashPassword(password: string): string {
    if (password.length === 0) {
        return '';
    }
    return createHash('sha1').update(Buffer.from(password, 'utf8')).digest('base64');
}

export class CryptoHandshake {
    private readonly _identity: Ts3Identity;
    private readonly _crypt: Ts3Crypt;
    private readonly _config: HandshakeConfig;
    private readonly _random: (size: number) => Buffer;

    private _alpha: Buffer | null = null;
    private _clientId: number | null = null;
    private _complete: boolean = false;

    public constructor(
        identity: Ts3Identity,
        crypt: Ts3Crypt,
        config: HandshakeConfig,
        random: (size: number) => Buffer = randomBytes,
    ) {
        this._identity = identity;
        this._crypt = crypt;
        this._config = config;
        this._random = random;
    }

    /**
     * Build the `clientinitiv` command line (as bytes) to embed in Init1 packet 4.
     * Picks the client's random `alpha`; the omega is the identity's public key.
     */
    public buildClientInitIv(): Buffer {
        this._alpha = this._random(10);
        const command: TsCommand = {
            name: 'clientinitiv',
            records: [
                {
                    alpha: this._alpha.toString('base64'),
                    omega: this._identity.omega(),
                    ot: '1',
                    ip: this._config.serverAddress,
                },
            ],
        };
        return Buffer.from(serializeCommand(command), 'utf8');
    }

    /** Feed one parsed server command and get the next action. */
    public onCommand(command: TsCommand): HandshakeStep {
        switch (command.name) {
            case 'initivexpand':
                return this._onInitivExpand(command);
            case 'initivexpand2':
                return {
                    kind: 'error',
                    message: 'new-protocol (initivexpand2) handshake not implemented yet',
                };
            case 'initserver':
                this._clientId = this._parseClientId(command);
                return { kind: 'ignore' };
            case 'notifyclientinitfinished':
                this._complete = true;
                return { kind: 'complete' };
            case 'error':
                return this._onError(command);
            default:
                return { kind: 'ignore' };
        }
    }

    public get clientId(): number | null {
        return this._clientId;
    }

    public get complete(): boolean {
        return this._complete;
    }

    private _onInitivExpand(command: TsCommand): HandshakeStep {
        if (this._alpha === null) {
            return { kind: 'error', message: 'initivexpand before clientinitiv' };
        }
        const betaB64: string | undefined = firstValue(command, 'beta');
        const serverOmega: string | undefined = firstValue(command, 'omega');
        if (betaB64 === undefined || serverOmega === undefined) {
            return { kind: 'error', message: 'initivexpand missing beta/omega' };
        }
        const beta: Buffer = Buffer.from(betaB64, 'base64');
        const serverPublicDer: Buffer = Buffer.from(serverOmega, 'base64');
        const sharedX: Buffer = this._identity.sharedSecretX(serverPublicDer);
        this._crypt.setupSharedSecret(sharedX, this._alpha, beta);
        return { kind: 'send', command: this._buildClientInit() };
    }

    private _buildClientInit(): TsCommand {
        return {
            name: 'clientinit',
            records: [
                {
                    client_nickname: this._config.nickname,
                    client_version: this._config.clientVersion,
                    client_platform: this._config.clientPlatform,
                    client_input_hardware: '1',
                    client_output_hardware: '1',
                    client_default_channel: this._config.defaultChannel ?? '',
                    client_default_channel_password: hashPassword(
                        this._config.defaultChannelPassword ?? '',
                    ),
                    client_server_password: hashPassword(this._config.serverPassword ?? ''),
                    client_meta_data: '',
                    client_version_sign: this._config.clientVersionSign,
                    client_key_offset: String(this._identity.keyOffset),
                    client_nickname_phonetic: '',
                    client_default_token: '',
                    hwid: this._config.hwid ?? 'AudioMesh',
                },
            ],
        };
    }

    private _parseClientId(command: TsCommand): number | null {
        // initserver carries the assigned client id as `aclid` (or `clid`).
        const raw: string | undefined = firstValue(command, 'aclid') ?? firstValue(command, 'clid');
        if (raw === undefined) {
            return null;
        }
        const id: number = Number.parseInt(raw, 10);
        return Number.isFinite(id) ? id : null;
    }

    private _onError(command: TsCommand): HandshakeStep {
        const id: string | undefined = firstValue(command, 'id');
        if (id !== undefined && id !== '0') {
            const message: string = firstValue(command, 'msg') ?? 'unknown';
            return { kind: 'error', message: `server error ${id}: ${message}` };
        }
        return { kind: 'ignore' };
    }
}
