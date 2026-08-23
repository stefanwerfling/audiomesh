import { describe, expect, it } from 'vitest';
import { parseTeamSpeakConfig } from '../../../src/Platform/Adapters/TeamSpeak/TeamSpeakConfig.js';

describe('parseTeamSpeakConfig', () => {
    it('derives sensible defaults from just a host', () => {
        const c = parseTeamSpeakConfig({ host: 'ts.example.com' });
        expect(c.host).toBe('ts.example.com');
        expect(c.port).toBe(9987);
        expect(c.nickname).toBe('AudioMesh');
        expect(c.startMuted).toBe(true);
        expect(c.serverPassword).toBeUndefined();
        expect(c.defaultChannelId).toBeUndefined();
        expect(c.identity).toBeUndefined();
    });

    it('splits an inline host:port', () => {
        const c = parseTeamSpeakConfig({ host: 'ts.example.com:9988' });
        expect(c.host).toBe('ts.example.com');
        expect(c.port).toBe(9988);
    });

    it('strips a ts3server:// scheme and query', () => {
        const c = parseTeamSpeakConfig({ host: 'ts3server://ts.example.com?port=9987' });
        expect(c.host).toBe('ts.example.com');
        expect(c.port).toBe(9987);
    });

    it('prefers an explicit port field over the default', () => {
        const c = parseTeamSpeakConfig({ host: 'ts.example.com', port: 10001 });
        expect(c.port).toBe(10001);
    });

    it('honours explicit overrides and coerces string booleans', () => {
        const c = parseTeamSpeakConfig({
            host: 'ts.example.com',
            nickname: 'Recorder',
            serverPassword: 'secret',
            defaultChannelId: '42',
            channelPassword: 'chpw',
            identity: 'BASE64IDENTITY==',
            startMuted: 'false',
        });
        expect(c.nickname).toBe('Recorder');
        expect(c.serverPassword).toBe('secret');
        expect(c.defaultChannelId).toBe('42');
        expect(c.channelPassword).toBe('chpw');
        expect(c.identity).toBe('BASE64IDENTITY==');
        expect(c.startMuted).toBe(false);
    });

    it('falls back to the default voice port for a nonsense port', () => {
        const c = parseTeamSpeakConfig({ host: 'ts.example.com', port: -1 });
        expect(c.port).toBe(9987);
    });

    it('throws when the host is missing or blank', () => {
        expect(() => parseTeamSpeakConfig({})).toThrow(/host/);
        expect(() => parseTeamSpeakConfig({ host: '   ' })).toThrow(/host/);
    });
});
