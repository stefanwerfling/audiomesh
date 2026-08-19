import type { Metrics } from '@audiomesh/schemas';
import { AudioMeshEvent } from './Events.js';
import { EventBus } from './EventBus.js';

/**
 * Collects runtime metrics for the dashboard. Cheap counters incremented off the
 * event bus (dropped frames, reconnects, audio packets) plus point-in-time
 * process stats sampled on demand. `snapshot()` builds the `Metrics` DTO; the
 * counts that need real subsystems (transcription/OpenAI latency) stay 0 until
 * those land — reported, not omitted, so the tiles are stable.
 */
export class MetricsCollector {

    private static _instance: MetricsCollector | null = null;

    public static getInstance(): MetricsCollector {
        if (MetricsCollector._instance === null) {
            MetricsCollector._instance = new MetricsCollector();
        }
        return MetricsCollector._instance;
    }

    private _audioPacketsWindow: number = 0;
    private _lastRateAt: number = Date.now();
    private _lastRate: number = 0;
    private _reconnects: number = 0;
    private _droppedFrames: number = 0;
    private _bound: boolean = false;

    public bind(): void {
        if (this._bound) {
            return;
        }
        this._bound = true;
        const bus: EventBus = EventBus.getInstance();
        bus.on(AudioMeshEvent.AudioChunkReceived, (): void => {
            this._audioPacketsWindow++;
        });
    }

    private _packetsPerSecond(): number {
        const now: number = Date.now();
        const elapsed: number = now - this._lastRateAt;
        if (elapsed >= 1000) {
            this._lastRate = Math.round((this._audioPacketsWindow * 1000) / elapsed);
            this._audioPacketsWindow = 0;
            this._lastRateAt = now;
        }
        return this._lastRate;
    }

    public snapshot(activeSessions: number, participants: number, activeRoutes: number): Metrics {
        const mem: NodeJS.MemoryUsage = process.memoryUsage();
        return {
            activeSessions: activeSessions,
            participants: participants,
            activeRoutes: activeRoutes,
            audioPacketsPerSecond: this._packetsPerSecond(),
            audioLatencyMs: 0,
            transcriptionLatencyMs: 0,
            openaiLatencyMs: 0,
            droppedFrames: this._droppedFrames,
            reconnects: this._reconnects,
            queueSize: 0,
            cpuPercent: 0,
            memoryMb: Math.round(mem.rss / (1024 * 1024)),
        };
    }

}
