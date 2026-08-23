import { describe, expect, it } from 'vitest';
import {
    escapeValue,
    unescapeValue,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/command/TsEscape.js';

describe('TsEscape', () => {
    it('escapes the TS3 special characters', () => {
        expect(escapeValue('Default Channel')).toBe('Default\\sChannel');
        expect(escapeValue('a/b')).toBe('a\\/b');
        expect(escapeValue('a|b')).toBe('a\\pb');
        expect(escapeValue('a\\b')).toBe('a\\\\b');
        expect(escapeValue('line1\nline2\ttab')).toBe('line1\\nline2\\ttab');
    });

    it('leaves ordinary characters untouched', () => {
        expect(escapeValue('AudioMesh-Bot_1')).toBe('AudioMesh-Bot_1');
    });

    it('unescapes back to the raw value', () => {
        expect(unescapeValue('Default\\sChannel')).toBe('Default Channel');
        expect(unescapeValue('a\\/b')).toBe('a/b');
        expect(unescapeValue('a\\pb')).toBe('a|b');
        expect(unescapeValue('a\\\\b')).toBe('a\\b');
    });

    it('resolves \\\\ last so a literal backslash survives a round-trip', () => {
        const raw: string = 'C:\\Program Files\\x | y / z';
        expect(unescapeValue(escapeValue(raw))).toBe(raw);
    });

    it('is tolerant of unknown escapes and a trailing backslash', () => {
        expect(unescapeValue('a\\xb')).toBe('axb'); // unknown → bare char
        expect(unescapeValue('abc\\')).toBe('abc'); // lone trailing backslash dropped
    });

    it('round-trips arbitrary control characters', () => {
        for (const raw of ['\r\n', '\t\v\f', 'mix\\ /|\ttab']) {
            expect(unescapeValue(escapeValue(raw))).toBe(raw);
        }
    });
});
