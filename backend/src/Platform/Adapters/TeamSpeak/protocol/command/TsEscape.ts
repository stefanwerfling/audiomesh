/**
 * TS3 command-value escaping (`../PROTOCOL.md` §5.2, TSLib `TsString.cs`). Command
 * values may not contain raw spaces, pipes, slashes or control characters — each
 * maps to a backslash escape. Encoding walks the raw string character by character
 * (so backslashes we emit are never re-escaped) and decoding is a single pass (so
 * `\\` resolves last, correctly). TSLib's table has no `\a`/`\b`; neither do we.
 */

/** Map of raw character → its escape sequence (without the leading backslash). */
const ESCAPES: ReadonlyArray<[string, string]> = [
    ['\\', '\\'],
    ['/', '/'],
    [' ', 's'],
    ['|', 'p'],
    ['\x07', 'a'], // bell — TSLib omits, but decode tolerates unknowns anyway
    ['\b', 'b'],
    ['\f', 'f'],
    ['\n', 'n'],
    ['\r', 'r'],
    ['\t', 't'],
    ['\v', 'v'],
];

/** raw char → escape letter, for the characters TS3 actually escapes on the wire. */
const ENCODE: ReadonlyMap<string, string> = new Map([
    ['\\', '\\'],
    ['/', '/'],
    [' ', 's'],
    ['|', 'p'],
    ['\f', 'f'],
    ['\n', 'n'],
    ['\r', 'r'],
    ['\t', 't'],
    ['\v', 'v'],
]);

/** escape letter → raw char, for decoding. Superset of ENCODE (tolerant on read). */
const DECODE: ReadonlyMap<string, string> = new Map(
    ESCAPES.map(([raw, letter]): [string, string] => [letter, raw]),
);

/** Escape a raw command value for the wire. */
export function escapeValue(value: string): string {
    let out: string = '';
    for (const char of value) {
        const letter: string | undefined = ENCODE.get(char);
        out += letter === undefined ? char : `\\${letter}`;
    }
    return out;
}

/**
 * Unescape a wire command value. A backslash consumes the next character and maps
 * it back; an unknown escape (`\x`) resolves to the bare character `x`, and a
 * trailing lone backslash is dropped — matching TSLib's lenient decoder.
 */
export function unescapeValue(value: string): string {
    let out: string = '';
    for (let i: number = 0; i < value.length; i++) {
        const char: string = value[i] as string;
        if (char !== '\\') {
            out += char;
            continue;
        }
        if (i + 1 >= value.length) {
            break; // trailing lone backslash
        }
        i += 1;
        const letter: string = value[i] as string;
        out += DECODE.get(letter) ?? letter;
    }
    return out;
}
