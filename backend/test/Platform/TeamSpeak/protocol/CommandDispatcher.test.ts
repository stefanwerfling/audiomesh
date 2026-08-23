import { describe, expect, it } from 'vitest';
import { CommandDispatcher } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/command/CommandDispatcher.js';
import type { TsCommand } from '../../../../src/Platform/Adapters/TeamSpeak/protocol/command/TsCommand.js';

describe('CommandDispatcher', () => {
    it('routes a line to name-specific and catch-all listeners', () => {
        const d: CommandDispatcher = new CommandDispatcher();
        const named: TsCommand[] = [];
        const any: TsCommand[] = [];
        d.on('notifycliententerview', (c: TsCommand): void => {
            named.push(c);
        });
        d.onAny((c: TsCommand): void => {
            any.push(c);
        });

        d.dispatch('notifycliententerview clid=12 client_nickname=Alice');
        d.dispatch('notifyclientleftview clid=12');

        expect(named).toHaveLength(1);
        expect(named[0]?.records[0]).toEqual({ clid: '12', client_nickname: 'Alice' });
        expect(any.map((c) => c.name)).toEqual(['notifycliententerview', 'notifyclientleftview']);
    });

    it('stops delivering after off()', () => {
        const d: CommandDispatcher = new CommandDispatcher();
        let hits: number = 0;
        const listener = (): void => {
            hits += 1;
        };
        d.on('error', listener);
        d.dispatch('error id=0 msg=ok');
        d.off('error', listener);
        d.dispatch('error id=0 msg=ok');
        expect(hits).toBe(1);
    });

    it('isolates a throwing listener from the others', () => {
        const d: CommandDispatcher = new CommandDispatcher();
        let reached: boolean = false;
        d.on('x', (): void => {
            throw new Error('boom');
        });
        d.on('x', (): void => {
            reached = true;
        });
        expect(() => d.dispatch('x a=1')).not.toThrow();
        expect(reached).toBe(true);
    });
});
