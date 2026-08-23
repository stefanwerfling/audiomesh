/**
 * Ping/Pong keepalive + connection-timeout bookkeeping (`../PROTOCOL.md` §7). The
 * client sends a Ping about once a second and treats the connection as dead after
 * ~30 s without a valid packet. Like {@link AckQueue}, this owns no timers — the
 * run-loop drives it with the current clock — so it is deterministic and testable.
 */
export class KeepAlive {
    private readonly _pingIntervalMs: number;
    private readonly _timeoutMs: number;

    private _lastPingAt: number = 0;
    private _lastReceivedAt: number = 0;
    private _started: boolean = false;

    public constructor(pingIntervalMs: number = 1_000, timeoutMs: number = 30_000) {
        this._pingIntervalMs = pingIntervalMs;
        this._timeoutMs = timeoutMs;
    }

    /** Begin tracking from `nowMs` (call once the handshake completes). */
    public start(nowMs: number): void {
        this._started = true;
        this._lastPingAt = nowMs;
        this._lastReceivedAt = nowMs;
    }

    /** Note that a valid packet arrived — resets the timeout window. */
    public onPacketReceived(nowMs: number): void {
        this._lastReceivedAt = nowMs;
    }

    /** True once a Ping is due (interval elapsed since the last one). */
    public shouldPing(nowMs: number): boolean {
        return this._started && nowMs - this._lastPingAt >= this._pingIntervalMs;
    }

    /** Record that a Ping was just sent. */
    public markPinged(nowMs: number): void {
        this._lastPingAt = nowMs;
    }

    /** True once no valid packet has arrived within the timeout window. */
    public isTimedOut(nowMs: number): boolean {
        return this._started && nowMs - this._lastReceivedAt >= this._timeoutMs;
    }

    public reset(): void {
        this._started = false;
        this._lastPingAt = 0;
        this._lastReceivedAt = 0;
    }
}
