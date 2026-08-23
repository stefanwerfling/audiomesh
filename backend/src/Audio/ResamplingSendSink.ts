import { INTERNAL_AUDIO_FORMAT, type IAudioFrame } from './AudioFormat.js';
import type { IAudioSink } from './IAudio.js';
import { Int16Chunker } from './Int16Chunker.js';
import { int16FromPcmBuffer } from './PcmConvert.js';
import { PcmResampler } from './PcmResampler.js';

/** Most voice transports want a small fixed frame; 10 ms is the common floor. */
const SEND_FRAME_MS: number = 10;

/**
 * Codec-agnostic outbound audio path shared by platform adapters: the mesh-facing
 * {@link IAudioSink} an adapter's `sendAudio()` returns. Frames written here
 * (internal format: s16le, mono, 16 kHz — e.g. agent TTS or a cross-platform
 * route) are upsampled to the transport's native send rate and regularised into
 * fixed-size chunks, then handed to the client via `forward`.
 *
 * Muting is enforced *here*, at the sink: while muted, frames are dropped before
 * conversion, so a muted bot spends no cycles resampling audio nobody will hear.
 * The client's own `setMuted` still runs in parallel so remote peers see the mute
 * indicator.
 *
 * This is the platform-neutral generalisation of the original Jitsi send sink; a
 * `frameMs` knob lets a transport that wants a different frame size (e.g. 20 ms)
 * override the 10 ms default.
 */
export class ResamplingSendSink implements IAudioSink {
    public readonly id: string;

    private readonly _isMuted: () => boolean;
    private readonly _forward: (samples: Int16Array, sampleRate: number) => void;
    private readonly _sendRate: number;
    private readonly _resampler: PcmResampler;
    private readonly _chunker: Int16Chunker;

    public constructor(
        id: string,
        sendRate: number,
        isMuted: () => boolean,
        forward: (samples: Int16Array, sampleRate: number) => void,
        frameMs: number = SEND_FRAME_MS,
    ) {
        this.id = id;
        this._sendRate = sendRate;
        this._isMuted = isMuted;
        this._forward = forward;
        this._resampler = new PcmResampler(INTERNAL_AUDIO_FORMAT.sampleRate, sendRate);
        this._chunker = new Int16Chunker((sendRate * frameMs) / 1000);
    }

    public write(frame: IAudioFrame): void {
        if (this._isMuted()) {
            return;
        }
        const samples: Int16Array = int16FromPcmBuffer(frame.data);
        const upsampled: Int16Array = this._resampler.process(samples);
        for (const chunk of this._chunker.push(upsampled)) {
            this._forward(chunk, this._sendRate);
        }
    }

    public close(): void {
        const tail: Int16Array | null = this._chunker.flush();
        if (tail !== null && !this._isMuted()) {
            this._forward(tail, this._sendRate);
        }
    }
}
