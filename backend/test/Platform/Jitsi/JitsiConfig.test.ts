import { describe, expect, it } from 'vitest';
import { parseJitsiConfig } from '../../../src/Platform/Adapters/Jitsi/JitsiConfig.js';

describe('parseJitsiConfig', () => {
    it('derives muc + bosh defaults from the domain', () => {
        const c = parseJitsiConfig({ domain: 'meet.example.com' });
        expect(c.domain).toBe('meet.example.com');
        expect(c.mucDomain).toBe('conference.meet.example.com');
        expect(c.anonymousDomain).toBe('guest.meet.example.com');
        expect(c.bosh).toBe('https://meet.example.com/http-bind');
        expect(c.displayName).toBe('AudioMesh');
        expect(c.startMuted).toBe(true);
        expect(c.websocket).toBeUndefined();
    });

    it('strips scheme and trailing slash from the domain', () => {
        const c = parseJitsiConfig({ domain: 'https://jitsi.local/' });
        expect(c.domain).toBe('jitsi.local');
        expect(c.mucDomain).toBe('conference.jitsi.local');
    });

    it('reduces a full pasted meeting URL to just its host', () => {
        const c = parseJitsiConfig({ domain: 'https://konferenz.pegenau.de/pegenau5' });
        expect(c.domain).toBe('konferenz.pegenau.de');
        expect(c.mucDomain).toBe('conference.konferenz.pegenau.de');
        expect(c.bosh).toBe('https://konferenz.pegenau.de/http-bind');
    });

    it('honours explicit overrides and coerces string booleans', () => {
        const c = parseJitsiConfig({
            domain: 'meet.example.com',
            mucDomain: 'muc.example.com',
            anonymousDomain: 'anon.example.com',
            websocket: 'wss://meet.example.com/xmpp-websocket',
            displayName: 'Bot',
            authUser: 'recorder',
            authPassword: 'secret',
            startMuted: 'false',
        });
        expect(c.mucDomain).toBe('muc.example.com');
        expect(c.anonymousDomain).toBe('anon.example.com');
        expect(c.websocket).toBe('wss://meet.example.com/xmpp-websocket');
        expect(c.displayName).toBe('Bot');
        expect(c.authUser).toBe('recorder');
        expect(c.authPassword).toBe('secret');
        expect(c.startMuted).toBe(false);
    });

    it('throws when the domain is missing or blank', () => {
        expect(() => parseJitsiConfig({})).toThrow(/domain/);
        expect(() => parseJitsiConfig({ domain: '   ' })).toThrow(/domain/);
    });
});
