/*
 * WebRTC / lib-jitsi-meet boundary. `any` is unavoidable here: lib-jitsi-meet
 * ships no first-class types and is written for the browser, so the whole file is
 * a thin, well-commented shim that emulates just enough browser environment to
 * run it under Node. Everything above this file (JitsiAdapter and up) is fully
 * typed and tested against the IJitsiClient seam.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from 'figtree';
import type { IJitsiClient, JitsiClientHandlers, JitsiParticipant } from './IJitsiClient.js';
import type { JitsiConfig } from './JitsiConfig.js';
import { loadJitsiRuntime } from './JitsiRuntime.js';

/**
 * The real {@link IJitsiClient}: a headless `lib-jitsi-meet` participant running
 * under Node via `jsdom` (DOM emulation) and `@roamhq/wrtc` (WebRTC + the
 * `RTCAudioSink` that exposes remote tracks as raw PCM inbound, and the
 * `RTCAudioSource` that turns pushed PCM into an outbound track for talkback).
 * The lib + browser-env shim are loaded by {@link JitsiRuntime} (our vendored
 * "own lib": the official lib-jitsi-meet build from `vendor/jitsi/` + a jsdom /
 * `@roamhq/wrtc` / `ws` shim). The npm `lib-jitsi-meet` is a dead end (deprecated
 * 1.0.6, crashes under Node) — hence vendoring the server's real build. This class
 * only maps that runtime onto {@link IJitsiClient}. Verified against a real
 * secure-domain deployment (guest/anonymous over BOSH) on 2026-08-20.
 */
export class LibJitsiClient implements IJitsiClient {
    /** Native track sample rate wrtc's RTCAudioSink emits (fixed at 48 kHz). */
    private static readonly WRTC_SAMPLE_RATE: number = 48000;

    private readonly _config: JitsiConfig;
    private _handlers: JitsiClientHandlers | null = null;

    private _JitsiMeetJS: any = null;
    private _wrtc: any = null;
    private _connection: any = null;
    private _conference: any = null;
    private _connected: boolean = false;

    private readonly _participants: Map<string, JitsiParticipant> = new Map();
    /** participantId → its RTCAudioSink, so we can dispose on leave. */
    private readonly _sinks: Map<string, any> = new Map();

    /** Outbound (talkback) local track state. */
    private _audioSource: any = null;
    private _localTrack: any = null;
    private _localJitsiTrack: any = null;
    private _localMuted: boolean = false;

    public constructor(config: JitsiConfig) {
        this._config = config;
    }

    public setHandlers(handlers: JitsiClientHandlers): void {
        this._handlers = handlers;
    }

    public isConnected(): boolean {
        return this._connected;
    }

    public getParticipants(): JitsiParticipant[] {
        return [...this._participants.values()];
    }

    public async connect(): Promise<void> {
        const runtime = await loadJitsiRuntime(this._config.domain);
        this._JitsiMeetJS = runtime.JitsiMeetJS;
        this._wrtc = runtime.wrtc;

        const JitsiMeetJS: any = this._JitsiMeetJS;
        if (typeof JitsiMeetJS.setLogLevel === 'function' && JitsiMeetJS.logLevels) {
            JitsiMeetJS.setLogLevel(JitsiMeetJS.logLevels.ERROR);
        }
        JitsiMeetJS.init({ disableAudioLevels: true });

        // serviceUrl is either XMPP-over-WebSocket or a BOSH http-bind URL (the
        // modern lib takes both here; the old `bosh` option is gone). anonymousdomain
        // lets the bot join secure-domain deployments as a guest, no password.
        const options: any = {
            hosts: {
                domain: this._config.domain,
                anonymousdomain: this._config.anonymousDomain,
                muc: this._config.mucDomain,
            },
            serviceUrl: this._config.websocket ?? this._config.bosh,
            clientNode: 'http://jitsi.org/jitsimeet',
        };

        await new Promise<void>((resolve, reject): void => {
            const connection: any = new JitsiMeetJS.JitsiConnection(null, null, options);
            this._connection = connection;
            const events: any = JitsiMeetJS.events.connection;
            connection.addEventListener(events.CONNECTION_ESTABLISHED, (): void => {
                this._connected = true;
                resolve();
            });
            connection.addEventListener(events.CONNECTION_FAILED, (): void => {
                reject(new Error('Jitsi connection failed'));
            });
            connection.addEventListener(events.CONNECTION_DISCONNECTED, (): void => {
                this._connected = false;
            });
            connection.connect(
                this._config.authUser !== undefined
                    ? { id: this._config.authUser, password: this._config.authPassword }
                    : undefined,
            );
        });
    }

    public async disconnect(): Promise<void> {
        try {
            for (const sink of this._sinks.values()) {
                this._safeStop(sink);
            }
            this._sinks.clear();
            this._disposeLocalTrack();
            if (this._connection !== null) {
                await this._connection.disconnect();
            }
        } finally {
            this._connected = false;
            this._connection = null;
            this._conference = null;
            this._participants.clear();
        }
    }

    public async joinRoom(roomName: string): Promise<void> {
        const JitsiMeetJS: any = this._JitsiMeetJS;
        if (this._connection === null) {
            throw new Error('LibJitsiClient: connect() must succeed before joinRoom()');
        }
        const conference: any = this._connection.initJitsiConference(roomName.toLowerCase(), {
            openBridgeChannel: true,
        });
        this._conference = conference;

        const ev: any = JitsiMeetJS.events.conference;
        conference.on(ev.TRACK_ADDED, (track: any): void => this._onRemoteTrack(track));
        conference.on(ev.USER_JOINED, (id: string, user: any): void => {
            const participant: JitsiParticipant = {
                id: id,
                displayName: this._nameOf(user, id),
            };
            this._participants.set(id, participant);
            this._handlers?.onParticipantJoined(participant);
        });
        conference.on(ev.USER_LEFT, (id: string): void => {
            this._participants.delete(id);
            const sink: any = this._sinks.get(id);
            if (sink !== undefined) {
                this._safeStop(sink);
                this._sinks.delete(id);
            }
            this._handlers?.onParticipantLeft(id);
        });
        conference.on(ev.DOMINANT_SPEAKER_CHANGED, (id: string | null): void => {
            this._handlers?.onDominantSpeakerChanged(id ?? null);
        });

        await new Promise<void>((resolve): void => {
            conference.on(ev.CONFERENCE_JOINED, (): void => resolve());
            conference.setDisplayName(this._config.displayName);
            conference.join();
        });
    }

    public async leaveRoom(): Promise<void> {
        if (this._conference !== null) {
            try {
                await this._conference.leave();
            } catch (error: unknown) {
                Logger.getLogger().warn(`LibJitsiClient: leave: ${(error as Error).message}`);
            }
            this._conference = null;
        }
    }

    public getSendSampleRate(): number {
        return LibJitsiClient.WRTC_SAMPLE_RATE;
    }

    public sendAudio(samples: Int16Array, sampleRate: number): void {
        if (this._localMuted) {
            return;
        }
        const source: any = this._ensureLocalTrack();
        if (source === null) {
            return;
        }
        try {
            // RTCAudioSource.onData wants one 10 ms frame of mono s16 PCM per call.
            source.onData({
                samples: samples,
                sampleRate: sampleRate,
                bitsPerSample: 16,
                channelCount: 1,
                numberOfFrames: samples.length,
            });
        } catch (error: unknown) {
            this._handlers?.onError(`send failed: ${(error as Error).message}`);
        }
    }

    public async setMuted(muted: boolean): Promise<void> {
        this._localMuted = muted;
        // Flip the raw WebRTC track so no frames leave even mid-utterance.
        if (this._localTrack !== null) {
            this._localTrack.enabled = !muted;
        }
        // And drive the lib-jitsi-meet mute so remote peers see the indicator.
        try {
            if (this._localJitsiTrack !== null) {
                await (muted ? this._localJitsiTrack.mute() : this._localJitsiTrack.unmute());
            }
        } catch (error: unknown) {
            Logger.getLogger().warn(`LibJitsiClient: setMuted: ${(error as Error).message}`);
        }
    }

    /**
     * Lazily create the bot's outbound track from a wrtc `RTCAudioSource` and
     * publish it into the conference. The RTCAudioSource + `onData` push is solid;
     * wrapping a raw MediaStreamTrack into a `JitsiLocalTrack` is the part that
     * varies across lib-jitsi-meet versions, so {@link _publishLocalTrack} degrades
     * gracefully. Returns the source (for `onData`) or null if wrtc is unavailable.
     */
    private _ensureLocalTrack(): any {
        if (this._audioSource !== null) {
            return this._audioSource;
        }
        const RTCAudioSource: any = this._wrtc?.nonstandard?.RTCAudioSource;
        if (RTCAudioSource === undefined) {
            return null;
        }
        try {
            this._audioSource = new RTCAudioSource();
            this._localTrack = this._audioSource.createTrack();
            this._localTrack.enabled = !this._localMuted;
            this._publishLocalTrack(this._localTrack);
            return this._audioSource;
        } catch (error: unknown) {
            this._handlers?.onError(`local track init failed: ${(error as Error).message}`);
            this._audioSource = null;
            this._localTrack = null;
            return null;
        }
    }

    private _publishLocalTrack(mediaStreamTrack: any): void {
        if (this._conference === null || this._JitsiMeetJS === null) {
            return;
        }
        try {
            const stream: any = new this._wrtc.MediaStream([mediaStreamTrack]);
            const jitsi: any = this._JitsiMeetJS;
            if (typeof jitsi.createLocalTracksFromMediaStreams === 'function') {
                const tracks: any = jitsi.createLocalTracksFromMediaStreams([
                    {
                        stream: stream,
                        track: mediaStreamTrack,
                        mediaType: 'audio',
                        videoType: null,
                    },
                ]);
                this._localJitsiTrack = Array.isArray(tracks) ? tracks[0] : tracks;
                if (this._localJitsiTrack !== undefined && this._localJitsiTrack !== null) {
                    this._conference.addTrack(this._localJitsiTrack);
                    return;
                }
            }
            Logger.getLogger().warn(
                'LibJitsiClient: could not publish a local track against this ' +
                    'lib-jitsi-meet version — outbound audio is generated but not attached. ' +
                    'Tune _publishLocalTrack for the installed version.',
            );
        } catch (error: unknown) {
            Logger.getLogger().warn(
                `LibJitsiClient: publish local track: ${(error as Error).message}`,
            );
        }
    }

    private _disposeLocalTrack(): void {
        try {
            if (this._localJitsiTrack !== null) {
                void this._localJitsiTrack.dispose?.();
            } else if (this._localTrack !== null) {
                this._localTrack.stop?.();
            }
        } catch {
            /* best effort */
        }
        this._audioSource = null;
        this._localTrack = null;
        this._localJitsiTrack = null;
    }

    private _onRemoteTrack(track: any): void {
        if (track.isLocal() || track.getType() !== 'audio') {
            return;
        }
        const participantId: string = track.getParticipantId();
        const RTCAudioSink: any = this._wrtc.nonstandard.RTCAudioSink;
        const mediaStreamTrack: any = track.getTrack();
        const sink: any = new RTCAudioSink(mediaStreamTrack);
        this._sinks.set(participantId, sink);

        sink.ondata = (data: any): void => {
            // data.samples: Int16Array; data.sampleRate: number (usually 48000).
            const samples: Int16Array = data.samples as Int16Array;
            this._handlers?.onAudioData({
                participantId: participantId,
                samples: samples,
                sampleRate: data.sampleRate ?? LibJitsiClient.WRTC_SAMPLE_RATE,
            });
        };
    }

    private _nameOf(user: any, fallback: string): string {
        try {
            const name: unknown = user?.getDisplayName?.();
            return typeof name === 'string' && name.length > 0 ? name : fallback;
        } catch {
            return fallback;
        }
    }

    private _safeStop(sink: any): void {
        try {
            sink.stop();
        } catch {
            /* already stopped */
        }
    }
}
