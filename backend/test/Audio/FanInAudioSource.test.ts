import { describe, expect, it } from 'vitest';
import { INTERNAL_AUDIO_FORMAT, type IAudioFrame } from '../../src/Audio/AudioFormat.js';
import { FanInAudioSource } from '../../src/Audio/FanInAudioSource.js';
import { PushAudioSource } from '../../src/Audio/PushAudioSource.js';

function frame(tag: number): IAudioFrame {
    return {
        data: Buffer.alloc(2, tag),
        timestamp: tag,
        sampleRate: INTERNAL_AUDIO_FORMAT.sampleRate,
        channels: INTERNAL_AUDIO_FORMAT.channels,
    };
}

describe('FanInAudioSource', () => {
    it('re-emits frames from every input', () => {
        const a: PushAudioSource = new PushAudioSource('a');
        const b: PushAudioSource = new PushAudioSource('b');
        const fan: FanInAudioSource = new FanInAudioSource('fan', [a, b]);
        const seen: number[] = [];
        fan.onFrame((f: IAudioFrame): void => {
            seen.push(f.timestamp);
        });
        a.push(frame(1));
        b.push(frame(2));
        a.push(frame(3));
        expect(seen).toEqual([1, 2, 3]);
    });

    it('unsubscribes from inputs on close without closing them', () => {
        const a: PushAudioSource = new PushAudioSource('a');
        const fan: FanInAudioSource = new FanInAudioSource('fan', [a]);
        let count: number = 0;
        fan.onFrame((): void => {
            count++;
        });
        a.push(frame(1));
        fan.close();
        a.push(frame(2)); // no longer tapped
        expect(count).toBe(1);
        expect(a.isClosed()).toBe(false); // inputs are not owned by the fan-in
    });
});
