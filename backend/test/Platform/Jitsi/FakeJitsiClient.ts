import type {
    IJitsiClient,
    JitsiAudioData,
    JitsiClientHandlers,
    JitsiParticipant,
} from '../../../src/Platform/Adapters/Jitsi/IJitsiClient.js';

/**
 * In-memory {@link IJitsiClient} for testing the {@link JitsiAdapter} without a
 * live Jitsi server. The test drives the conference by calling `emit*` methods,
 * which invoke the handlers the adapter registered — exactly what the real client
 * does off WebRTC callbacks.
 */
export class FakeJitsiClient implements IJitsiClient {
    public handlers: JitsiClientHandlers | null = null;
    public joinedRoom: string | null = null;
    public muted: boolean | null = null;
    /** Every outbound chunk the adapter pushed, for send-path assertions. */
    public readonly sent: { samples: Int16Array; sampleRate: number }[] = [];

    private _connected: boolean = false;
    private readonly _sendSampleRate: number;
    private readonly _participants: Map<string, JitsiParticipant> = new Map();

    public constructor(seed: JitsiParticipant[] = [], sendSampleRate: number = 48000) {
        this._sendSampleRate = sendSampleRate;
        for (const p of seed) {
            this._participants.set(p.id, p);
        }
    }

    public setHandlers(handlers: JitsiClientHandlers): void {
        this.handlers = handlers;
    }

    public async connect(): Promise<void> {
        this._connected = true;
    }

    public async disconnect(): Promise<void> {
        this._connected = false;
    }

    public isConnected(): boolean {
        return this._connected;
    }

    public async joinRoom(roomName: string): Promise<void> {
        this.joinedRoom = roomName;
    }

    public async leaveRoom(): Promise<void> {
        this.joinedRoom = null;
    }

    public getParticipants(): JitsiParticipant[] {
        return [...this._participants.values()];
    }

    public sendAudio(samples: Int16Array, sampleRate: number): void {
        this.sent.push({ samples: samples, sampleRate: sampleRate });
    }

    public getSendSampleRate(): number {
        return this._sendSampleRate;
    }

    public async setMuted(muted: boolean): Promise<void> {
        this.muted = muted;
    }

    // --- test drivers -------------------------------------------------------

    public emitJoin(participant: JitsiParticipant): void {
        this._participants.set(participant.id, participant);
        this.handlers?.onParticipantJoined(participant);
    }

    public emitLeft(participantId: string): void {
        this._participants.delete(participantId);
        this.handlers?.onParticipantLeft(participantId);
    }

    public emitAudio(data: JitsiAudioData): void {
        this.handlers?.onAudioData(data);
    }

    public emitDominantSpeaker(participantId: string | null): void {
        this.handlers?.onDominantSpeakerChanged(participantId);
    }

    public emitError(message: string): void {
        this.handlers?.onError(message);
    }
}
