import { INTERNAL_AUDIO_FORMAT, type IAudioFrame } from '../../../Audio/AudioFormat.js';
import type { IAudioSink } from '../../../Audio/IAudio.js';
import { Int16Chunker } from '../../../Audio/Int16Chunker.js';
import { int16FromPcmBuffer } from '../../../Audio/PcmConvert.js';
import { PcmResampler } from '../../../Audio/PcmResampler.js';

/** WebRTC's RTCAudioSource wants exactly one 10 ms frame per push. */
const SEND_FRAME_MS: number = 10;

/**
 * Outbound audio path for the Jitsi bot — the mesh-facing {@link IAudioSink} that
 * `JitsiAdapter.sendAudio()` returns. Frames written here (internal format:
 * s16le, mono, 16 kHz — e.g. agent TTS or a cross-platform route) are upsampled
 * to the client's native send rate and regularised into transport-sized chunks,
 * then handed to the client's local track.
 *
 * Muting is enforced *here*, at the sink: while muted the frames are dropped
 * before conversion, so a muted bot spends no cycles resampling audio nobody will
 * hear. The client's own `setMuted` still runs in parallel so remote peers see
 * the mute indicator.
 */
export class JitsiSendSink implements IAudioSink {
    public readonly id: string = 'jitsi-out';

    private readonly _isMuted: () => boolean;
    private readonly _forward: (samples: Int16Array, sampleRate: number) => void;
    private readonly _sendRate: number;
    private readonly _resampler: PcmResampler;
    private readonly _chunker: Int16Chunker;

    public constructor(
        sendRate: number,
        isMuted: () => boolean,
        forward: (samples: Int16Array, sampleRate: number) => void,
    ) {
        this._sendRate = sendRate;
        this._isMuted = isMuted;
        this._forward = forward;
        this._resampler = new PcmResampler(INTERNAL_AUDIO_FORMAT.sampleRate, sendRate);
        this._chunker = new Int16Chunker((sendRate * SEND_FRAME_MS) / 1000);
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
