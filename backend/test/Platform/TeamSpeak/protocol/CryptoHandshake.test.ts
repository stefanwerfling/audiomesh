import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
    CryptoHandshake,
    hashPassword,
    type HandshakeConfig,
    type HandshakeStep,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/handshake/CryptoHandshake.js';
import { Ts3Crypt } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/crypto/Ts3Crypt.js';
import { Ts3Identity } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/crypto/Ts3Identity.js';
import {
    firstValue,
    parseCommand,
    type TsCommand,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/command/TsCommand.js';

const CONFIG: HandshakeConfig = {
    nickname: 'AudioMesh Bot',
    clientVersion: '3.5.0 [Build: 1]',
    clientVersionSign: 'signature==',
    clientPlatform: 'Linux',
    serverAddress: 'ts.example.com',
    serverPassword: 'hunter2',
};

const ALPHA: Buffer = Buffer.alloc(10, 0xaa);
const BETA: Buffer = Buffer.alloc(10, 0xbb);
const fixedRandom = (size: number): Buffer => Buffer.alloc(size, 0xaa);

describe('hashPassword', () => {
    it('is base64(SHA1(password)) and empty for an empty password', () => {
        expect(hashPassword('')).toBe('');
        expect(hashPassword('hunter2')).toBe(
            createHash('sha1').update(Buffer.from('hunter2', 'utf8')).digest('base64'),
        );
    });
});

describe('CryptoHandshake (old protocol, against a simulated server)', () => {
    it('derives the same shared secret as the server and sends clientinit', () => {
        const clientId: Ts3Identity = Ts3Identity.generate();
        const serverId: Ts3Identity = Ts3Identity.generate();
        const clientCrypt: Ts3Crypt = new Ts3Crypt();
        const hs: CryptoHandshake = new CryptoHandshake(clientId, clientCrypt, CONFIG, fixedRandom);

        // 1. clientinitiv (rides on Init1 packet 4).
        const iv: TsCommand = parseCommand(hs.buildClientInitIv().toString('utf8'));
        expect(iv.name).toBe('clientinitiv');
        expect(firstValue(iv, 'alpha')).toBe(ALPHA.toString('base64'));
        expect(firstValue(iv, 'omega')).toBe(clientId.omega());
        expect(firstValue(iv, 'ot')).toBe('1');

        // 2. Server side: derive its own shared secret from the client's omega.
        const clientOmegaDer: Buffer = Buffer.from(firstValue(iv, 'omega') as string, 'base64');
        const serverX: Buffer = serverId.sharedSecretX(clientOmegaDer);
        const serverCrypt: Ts3Crypt = new Ts3Crypt();
        serverCrypt.setupSharedSecret(serverX, ALPHA, BETA);

        // 3. Server replies initivexpand; the client derives its secret.
        const initivexpand: TsCommand = {
            name: 'initivexpand',
            records: [
                {
                    alpha: ALPHA.toString('base64'),
                    beta: BETA.toString('base64'),
                    omega: serverId.omega(),
                },
            ],
        };
        const step: HandshakeStep = hs.onCommand(initivexpand);

        // Both sides must have arrived at the same ivStruct (→ same fake signature).
        expect(clientCrypt.cryptoInitComplete).toBe(true);
        expect(clientCrypt.fakeSignature.equals(serverCrypt.fakeSignature)).toBe(true);

        // 4. The handshake asks to send clientinit with our fields.
        expect(step.kind).toBe('send');
        if (step.kind !== 'send') {
            throw new Error('expected send');
        }
        expect(step.command.name).toBe('clientinit');
        expect(firstValue(step.command, 'client_nickname')).toBe('AudioMesh Bot');
        expect(firstValue(step.command, 'client_key_offset')).toBe(String(clientId.keyOffset));
        expect(firstValue(step.command, 'client_server_password')).toBe(hashPassword('hunter2'));
    });

    it('captures the client id from initserver and completes on notifyclientinitfinished', () => {
        const hs: CryptoHandshake = new CryptoHandshake(
            Ts3Identity.generate(),
            new Ts3Crypt(),
            CONFIG,
            fixedRandom,
        );
        expect(hs.onCommand(parseCommand('initserver virtualserver_name=Test aclid=42')).kind).toBe(
            'ignore',
        );
        expect(hs.clientId).toBe(42);
        expect(hs.complete).toBe(false);
        expect(hs.onCommand({ name: 'notifyclientinitfinished', records: [] }).kind).toBe(
            'complete',
        );
        expect(hs.complete).toBe(true);
    });

    it('rejects the ≥3.1 new-protocol path and surfaces server errors', () => {
        const hs: CryptoHandshake = new CryptoHandshake(
            Ts3Identity.generate(),
            new Ts3Crypt(),
            CONFIG,
            fixedRandom,
        );
        expect(hs.onCommand({ name: 'initivexpand2', records: [{ l: 'x' }] }).kind).toBe('error');

        const err: HandshakeStep = hs.onCommand(
            parseCommand('error id=3329 msg=connection\\sfailed'),
        );
        expect(err.kind).toBe('error');
        if (err.kind === 'error') {
            expect(err.message).toContain('3329');
        }
        // An error with id=0 is a success ack and is ignored.
        expect(hs.onCommand(parseCommand('error id=0 msg=ok')).kind).toBe('ignore');
    });

    it('errors if initivexpand arrives before clientinitiv', () => {
        const hs: CryptoHandshake = new CryptoHandshake(
            Ts3Identity.generate(),
            new Ts3Crypt(),
            CONFIG,
            fixedRandom,
        );
        expect(
            hs.onCommand({ name: 'initivexpand', records: [{ beta: 'x', omega: 'y' }] }).kind,
        ).toBe('error');
    });
});
