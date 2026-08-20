import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AudioRoute, RouteNode } from '@audiomesh/schemas';
import { INTERNAL_AUDIO_FORMAT, type IAudioFrame } from '../../src/Audio/AudioFormat.js';
import type { IAudioProcessor, IAudioSink, IAudioSource } from '../../src/Audio/IAudio.js';
import { PushAudioSource } from '../../src/Audio/PushAudioSource.js';
import { EventBus } from '../../src/Core/EventBus.js';
import { AudioMeshEvent } from '../../src/Core/Events.js';
import { AudioRouter } from '../../src/Routing/AudioRouter.js';
import type { IRouteNodeResolver } from '../../src/Routing/IRouteNodeResolver.js';

class CollectingSink implements IAudioSink {
    public readonly id: string = 'collect';
    public readonly frames: IAudioFrame[] = [];
    public closed: boolean = false;
    public write(frame: IAudioFrame): void {
        this.frames.push(frame);
    }
    public close(): void {
        this.closed = true;
    }
}

/** Resolver returning caller-provided objects, so a test drives the pipeline. */
class FakeResolver implements IRouteNodeResolver {
    public constructor(
        private readonly _source: IAudioSource,
        private readonly _sink: IAudioSink,
        private readonly _processors: Map<string, IAudioProcessor | null> = new Map(),
    ) {}
    public resolveSource(): IAudioSource {
        return this._source;
    }
    public resolveProcessor(node: RouteNode): IAudioProcessor | null {
        return this._processors.get(node.id) ?? null;
    }
    public resolveSink(): IAudioSink {
        return this._sink;
    }
}

function route(nodes: RouteNode[]): AudioRoute {
    return { id: 'r1', name: 'R', enabled: true, state: 'stopped', nodes: nodes };
}

const SOURCE_NODE: RouteNode = { id: 's', kind: 'source', type: 'session', ref: 'a' };
const SINK_NODE: RouteNode = { id: 'k', kind: 'sink', type: 'session', ref: 'b' };

function frame(tag: number): IAudioFrame {
    return {
        data: Buffer.alloc(2, tag),
        timestamp: tag,
        sampleRate: INTERNAL_AUDIO_FORMAT.sampleRate,
        channels: INTERNAL_AUDIO_FORMAT.channels,
    };
}

describe('AudioRouter', () => {
    let source: PushAudioSource;
    let sink: CollectingSink;

    beforeEach(() => {
        source = new PushAudioSource('src');
        sink = new CollectingSink();
        AudioRouter.getInstance().setResolver(new FakeResolver(source, sink));
    });

    afterEach(() => {
        AudioRouter.getInstance().stop('r1');
    });

    it('moves frames from source to sink while running', () => {
        const ok: boolean = AudioRouter.getInstance().start(route([SOURCE_NODE, SINK_NODE]));
        expect(ok).toBe(true);
        expect(AudioRouter.getInstance().isRunning('r1')).toBe(true);
        expect(AudioRouter.getInstance().getState('r1')).toBe('running');

        source.push(frame(1));
        source.push(frame(2));
        expect(sink.frames.map((f) => f.timestamp)).toEqual([1, 2]);
    });

    it('stops moving frames and releases the source on stop', () => {
        AudioRouter.getInstance().start(route([SOURCE_NODE, SINK_NODE]));
        source.push(frame(1));
        AudioRouter.getInstance().stop('r1');
        source.push(frame(2)); // pipeline detached
        expect(sink.frames).toHaveLength(1);
        expect(source.isClosed()).toBe(true);
        expect(AudioRouter.getInstance().getState('r1')).toBe('stopped');
    });

    it('applies a resolved processor in the chain', () => {
        const doubler: IAudioProcessor = {
            id: 'p',
            process: (f: IAudioFrame): IAudioFrame => ({ ...f, timestamp: f.timestamp * 2 }),
        };
        AudioRouter.getInstance().setResolver(
            new FakeResolver(source, sink, new Map([['p', doubler]])),
        );
        AudioRouter.getInstance().start(
            route([SOURCE_NODE, { id: 'p', kind: 'processor', type: 'x' }, SINK_NODE]),
        );
        source.push(frame(5));
        expect(sink.frames[0]!.timestamp).toBe(10);
    });

    it('fails a route without a source or sink node and emits an error', () => {
        const errors: string[] = [];
        const handler = (p: { component: string }): void => {
            errors.push(p.component);
        };
        EventBus.getInstance().on(AudioMeshEvent.ErrorOccurred, handler);
        try {
            const ok: boolean = AudioRouter.getInstance().start(route([SOURCE_NODE]));
            expect(ok).toBe(false);
            expect(AudioRouter.getInstance().isRunning('r1')).toBe(false);
            expect(AudioRouter.getInstance().getState('r1')).toBe('failed');
            expect(errors).toContain('AudioRouter');
        } finally {
            EventBus.getInstance().off(AudioMeshEvent.ErrorOccurred, handler);
        }
    });
});
