import { describe, expect, it } from 'vitest';
import {
    firstValue,
    parseCommand,
    serializeCommand,
    type TsCommand,
} from '../../../../src/Platform/Adapters/TeamSpeak/protocol/command/TsCommand.js';

describe('parseCommand', () => {
    it('parses a notify line with escaped values', () => {
        const cmd: TsCommand = parseCommand(
            'notifytextmessage targetmode=1 msg=Hello\\sWorld invokerid=5 invokername=Bob',
        );
        expect(cmd.name).toBe('notifytextmessage');
        expect(cmd.records).toHaveLength(1);
        expect(cmd.records[0]).toEqual({
            targetmode: '1',
            msg: 'Hello World',
            invokerid: '5',
            invokername: 'Bob',
        });
        expect(firstValue(cmd, 'msg')).toBe('Hello World');
    });

    it('parses a bulk command into one record per pipe group', () => {
        const cmd: TsCommand = parseCommand(
            'channellist cid=1 channel_name=Lobby|cid=2 channel_name=Meeting\\sRoom',
        );
        expect(cmd.name).toBe('channellist');
        expect(cmd.records).toEqual([
            { cid: '1', channel_name: 'Lobby' },
            { cid: '2', channel_name: 'Meeting Room' },
        ]);
    });

    it('does not confuse an unescaped pipe boundary with a value space', () => {
        // order=0|cid=2 must split on the pipe, not the spaces.
        const cmd: TsCommand = parseCommand('clientmove cid=1 order=0|cid=2 order=1');
        expect(cmd.records).toEqual([
            { cid: '1', order: '0' },
            { cid: '2', order: '1' },
        ]);
    });

    it('treats a bare key as a flag with an empty value', () => {
        const cmd: TsCommand = parseCommand('channelsubscribeall');
        expect(cmd.name).toBe('channelsubscribeall');
        expect(cmd.records).toEqual([]);
        const flag: TsCommand = parseCommand('somecmd flag key=v');
        expect(flag.records[0]).toEqual({ flag: '', key: 'v' });
    });

    it('parses an error response line', () => {
        const cmd: TsCommand = parseCommand('error id=0 msg=ok');
        expect(cmd.name).toBe('error');
        expect(firstValue(cmd, 'id')).toBe('0');
        expect(firstValue(cmd, 'msg')).toBe('ok');
    });
});

describe('serializeCommand', () => {
    it('serializes name + escaped values', () => {
        expect(
            serializeCommand({
                name: 'clientinit',
                records: [{ client_nickname: 'Audio Mesh', client_version: '3.1' }],
            }),
        ).toBe('clientinit client_nickname=Audio\\sMesh client_version=3.1');
    });

    it('joins bulk records with a pipe', () => {
        expect(
            serializeCommand({
                name: 'clientmove',
                records: [
                    { cid: '1', order: '0' },
                    { cid: '2', order: '1' },
                ],
            }),
        ).toBe('clientmove cid=1 order=0|cid=2 order=1');
    });

    it('emits a bare key for an empty value and a name-only command', () => {
        expect(serializeCommand({ name: 'x', records: [{ flag: '', key: 'v' }] })).toBe(
            'x flag key=v',
        );
        expect(serializeCommand({ name: 'channelsubscribeall', records: [] })).toBe(
            'channelsubscribeall',
        );
    });

    it('round-trips parse → serialize → parse', () => {
        const line: string = 'notifytextmessage targetmode=2 msg=a\\sb\\p\\/c invokerid=7';
        const once: TsCommand = parseCommand(line);
        const twice: TsCommand = parseCommand(serializeCommand(once));
        expect(twice).toEqual(once);
    });
});
