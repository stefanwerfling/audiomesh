import { describe, expect, it } from 'vitest';
import { INTERNAL_AUDIO_FORMAT, type IAudioFrame } from '../../src/Audio/AudioFormat.js';
import { AudioPipeline } from '../../src/Audio/AudioPipeline.js';
import type { IAudioProcessor } from '../../src/Audio/IAudio.js';
import { NullAudioSink } from '../../src/Audio/NullAudioSink.js';
import { PushAudioSource } from '../../src/Audio/PushAudioSource.js';

function frame(): IAudioFrame {
    return {
        data: Buffer.alloc(320),
        timestamp: 0,
        sampleRate: INTERNAL_AUDIO_FORMAT.sampleRate,
        channels: 1,
    };
}

describe('AudioPipeline', () => {

    it('streams frames source → sink while running', () => {
        const source: PushAudioSource = new PushAudioSource('src');
        const sink: NullAudioSink = new NullAudioSink('sink');
        const pipeline: AudioPipeline = new AudioPipeline(source, [], sink);
        pipeline.start();
        source.push(frame());
        source.push(frame());
        expect(sink.getCount()).toBe(2);
    });

    it('lets a processor drop a frame by returning null', () => {
        const source: PushAudioSource = new PushAudioSource('src');
        const sink: NullAudioSink = new NullAudioSink('sink');
        const dropAll: IAudioProcessor = { id: 'gate', process: (): IAudioFrame | null => null };
        const pipeline: AudioPipeline = new AudioPipeline(source, [dropAll], sink);
        pipeline.start();
        source.push(frame());
        expect(sink.getCount()).toBe(0);
    });

    it('stops delivering after stop()', () => {
        const source: PushAudioSource = new PushAudioSource('src');
        const sink: NullAudioSink = new NullAudioSink('sink');
        const pipeline: AudioPipeline = new AudioPipeline(source, [], sink);
        pipeline.start();
        pipeline.stop();
        source.push(frame());
        expect(sink.getCount()).toBe(0);
    });

});
