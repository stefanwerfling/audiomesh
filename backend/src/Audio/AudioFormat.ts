/**
 * Canonical internal audio format for the whole mesh. Every adapter converts its
 * platform-native format into this on the way in, and out of it on the way out,
 * so the Core, pipeline, routing and transcription only ever deal with one shape.
 *
 * PCM, signed 16-bit little-endian, mono, 16 kHz — the sweet spot for speech: it
 * is exactly what the OpenAI transcription/realtime path expects and keeps DSP
 * (VAD, resample) cheap.
 */
export const INTERNAL_AUDIO_FORMAT = {
    encoding: 'pcm_s16le',
    sampleRate: 16000,
    channels: 1,
    bytesPerSample: 2,
} as const;

export type AudioEncoding = typeof INTERNAL_AUDIO_FORMAT.encoding;

/**
 * A single chunk of audio flowing through the mesh. `data` is raw PCM in the
 * internal format; `timestamp` is capture time (Unix epoch ms). `speakerId` is
 * set when the frame is attributable to a specific participant (per-participant
 * sources), which is what later enables speaker-tagged transcription.
 */
export interface IAudioFrame {
    data: Buffer;
    timestamp: number;
    sampleRate: number;
    channels: number;
    speakerId?: string;
}

/** Number of PCM samples in a frame's buffer (per channel). */
export function frameSampleCount(frame: IAudioFrame): number {
    return frame.data.length / INTERNAL_AUDIO_FORMAT.bytesPerSample / frame.channels;
}
