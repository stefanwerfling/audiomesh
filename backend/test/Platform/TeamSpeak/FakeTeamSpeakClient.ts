import type {
    ITeamSpeakClient,
    TeamSpeakAudioData,
    TeamSpeakClientHandlers,
    TeamSpeakParticipant,
} from '../../../src/Platform/Adapters/TeamSpeak/ITeamSpeakClient.js';

/**
 * In-memory {@link ITeamSpeakClient} for testing the {@link TeamSpeakAdapter}
 * without a live TS3 server (and without the native protocol stack). The test
 * drives the server by calling `emit*` methods, which invoke the handlers the
 * adapter registered — exactly what the real client does off its UDP callbacks.
 */
export class FakeTeamSpeakClient implements ITeamSpeakClient {
    public handlers: TeamSpeakClientHandlers | null = null;
    public joinedChannel: string | null = null;
    public muted: boolean | null = null;
    /** Every outbound chunk the adapter pushed, for send-path assertions. */
    public readonly sent: { samples: Int16Array; sampleRate: number }[] = [];

    private _connected: boolean = false;
    private readonly _sendSampleRate: number;
    private readonly _channels: { id: string; name: string }[];
    private readonly _participants: Map<string, TeamSpeakParticipant> = new Map();

    public constructor(
        seed: TeamSpeakParticipant[] = [],
        channels: { id: string; name: string }[] = [],
        sendSampleRate: number = 48000,
    ) {
        this._sendSampleRate = sendSampleRate;
        this._channels = channels;
        for (const p of seed) {
            this._participants.set(p.id, p);
        }
    }

    public setHandlers(handlers: TeamSpeakClientHandlers): void {
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

    public async getChannels(): Promise<{ id: string; name: string }[]> {
        return this._channels;
    }

    public async joinChannel(channelId: string): Promise<void> {
        this.joinedChannel = channelId;
    }

    public getParticipants(): TeamSpeakParticipant[] {
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

    public emitJoin(participant: TeamSpeakParticipant): void {
        this._participants.set(participant.id, participant);
        this.handlers?.onParticipantJoined(participant);
    }

    public emitLeft(participantId: string): void {
        this._participants.delete(participantId);
        this.handlers?.onParticipantLeft(participantId);
    }

    public emitAudio(data: TeamSpeakAudioData): void {
        this.handlers?.onAudioData(data);
    }

    public emitSpeaking(participantId: string, speaking: boolean): void {
        this.handlers?.onSpeakingChanged(participantId, speaking);
    }

    public emitError(message: string): void {
        this.handlers?.onError(message);
    }
}
