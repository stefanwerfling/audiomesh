import { escapeValue, unescapeValue } from './TsEscape.js';

/**
 * TS3 command (de)serialization (`../PROTOCOL.md` §5.1). A command line is
 * `name key=value key2=value2 ...`, with `|` separating **bulk records** that each
 * carry their own key/value set (e.g. one channel per record in a channel list).
 * Server events use the same grammar with a `notify…` name. Values are escaped
 * (`./TsEscape.ts`); a bare key (no `=`) is a flag with an empty value.
 *
 * Parsing splits on `|` **before** spaces: an unescaped `|` is a record boundary
 * (literal pipes in values are `\p`) and an unescaped space is a key boundary
 * (literal spaces are `\s`), so the two never collide.
 */

/** One bulk record: key → unescaped value ("" for a bare flag key). */
export type CommandRecord = Readonly<Record<string, string>>;

export interface TsCommand {
    /** Command / notify name (empty for a nameless parameter line). */
    name: string;
    /** One entry per bulk record; empty when the line carried no parameters. */
    records: CommandRecord[];
}

/** Convenience: the value of `key` in the first record, or undefined. */
export function firstValue(command: TsCommand, key: string): string | undefined {
    return command.records[0]?.[key];
}

/** Serialize one record's `key=value` pairs (bare key when the value is empty). */
function serializeRecord(record: CommandRecord): string {
    return Object.entries(record)
        .map(([key, value]: [string, string]): string =>
            value === '' ? key : `${key}=${escapeValue(value)}`,
        )
        .join(' ');
}

/**
 * Serialize a {@link TsCommand} to its wire line. Records join with `|`; a command
 * with no records is just its name.
 */
export function serializeCommand(command: TsCommand): string {
    if (command.records.length === 0) {
        return command.name;
    }
    const body: string = command.records
        .map((record: CommandRecord): string => serializeRecord(record))
        .join('|');
    return command.name.length > 0 ? `${command.name} ${body}` : body;
}

/** Parse one bulk record ("k1=v1 k2=v2 flag") into a {@link CommandRecord}. */
function parseRecord(group: string): CommandRecord {
    const record: Record<string, string> = {};
    for (const token of group.split(' ')) {
        if (token.length === 0) {
            continue;
        }
        const eq: number = token.indexOf('=');
        if (eq < 0) {
            record[token] = '';
        } else {
            record[token.slice(0, eq)] = unescapeValue(token.slice(eq + 1));
        }
    }
    return record;
}

/**
 * Parse a wire command line into a {@link TsCommand}. The leading token is taken as
 * the name unless it looks like a `key=value` pair (then the line is treated as
 * nameless parameters). An empty line yields an empty name with no records.
 */
export function parseCommand(line: string): TsCommand {
    if (line.length === 0) {
        return { name: '', records: [] };
    }
    const firstSpace: number = line.indexOf(' ');
    const head: string = firstSpace < 0 ? line : line.slice(0, firstSpace);
    let name: string = '';
    let rest: string = line;
    if (!head.includes('=')) {
        name = head;
        rest = firstSpace < 0 ? '' : line.slice(firstSpace + 1);
    }
    if (rest.length === 0) {
        return { name: name, records: [] };
    }
    const records: CommandRecord[] = rest
        .split('|')
        .map((group: string): CommandRecord => parseRecord(group));
    return { name: name, records: records };
}
