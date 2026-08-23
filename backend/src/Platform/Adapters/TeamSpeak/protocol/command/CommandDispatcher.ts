import { parseCommand, type TsCommand } from './TsCommand.js';

/** A handler for a parsed incoming command/notify. */
export type CommandListener = (command: TsCommand) => void;

/**
 * Routes incoming command/notify lines to registered handlers by name
 * (`../PROTOCOL.md` §5.3). The handshake and high-level client subscribe to the
 * events they care about — `initserver`, `notifycliententerview`,
 * `notifyclientleftview`, `notifytextmessage`, … — plus an optional catch-all for
 * logging/diagnostics. Parsing lives in {@link parseCommand}; this only fans out.
 */
export class CommandDispatcher {
    private readonly _byName: Map<string, Set<CommandListener>> = new Map();
    private readonly _any: Set<CommandListener> = new Set();

    /** Subscribe to a specific command/notify name. */
    public on(name: string, listener: CommandListener): void {
        let set: Set<CommandListener> | undefined = this._byName.get(name);
        if (set === undefined) {
            set = new Set<CommandListener>();
            this._byName.set(name, set);
        }
        set.add(listener);
    }

    /** Unsubscribe a previously-registered name listener. */
    public off(name: string, listener: CommandListener): void {
        this._byName.get(name)?.delete(listener);
    }

    /** Subscribe to every command (fires after the name-specific listeners). */
    public onAny(listener: CommandListener): void {
        this._any.add(listener);
    }

    public offAny(listener: CommandListener): void {
        this._any.delete(listener);
    }

    /**
     * Parse a raw command line and dispatch it to the matching listeners, then the
     * catch-all. Returns the parsed command. Listener exceptions are isolated so one
     * bad handler cannot drop the event for others.
     */
    public dispatch(line: string): TsCommand {
        const command: TsCommand = parseCommand(line);
        for (const listener of this._byName.get(command.name) ?? []) {
            this._safeInvoke(listener, command);
        }
        for (const listener of this._any) {
            this._safeInvoke(listener, command);
        }
        return command;
    }

    private _safeInvoke(listener: CommandListener, command: TsCommand): void {
        try {
            listener(command);
        } catch {
            // A handler must not break dispatch for the others; the client's error
            // path surfaces real failures via its own logging.
        }
    }
}
