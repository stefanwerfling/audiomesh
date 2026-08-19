import type { Participant as ParticipantDto } from '@audiomesh/schemas';
import { EventBus } from '../../Core/EventBus.js';
import { AudioMeshEvent, type ParticipantEventData, type TranscriptEventData } from '../../Core/Events.js';
import { VoiceSessionManager } from '../../Session/VoiceSessionManager.js';
import { WsHub } from './WsHub.js';

/**
 * Subscribes to the internal {@link EventBus} and forwards the frontend-relevant
 * subset to every connected browser via the {@link WsHub}, translated into the
 * wire `WsEvent` DTOs from `@audiomesh/schemas`. This is the ONLY path from
 * internal events to the client — raw audio-chunk events, for instance, never
 * cross it. Bind once at startup.
 */
export class WsEventBridge {

    private static _instance: WsEventBridge | null = null;

    public static getInstance(): WsEventBridge {
        if (WsEventBridge._instance === null) {
            WsEventBridge._instance = new WsEventBridge();
        }
        return WsEventBridge._instance;
    }

    private _bound: boolean = false;

    public bind(): void {
        if (this._bound) {
            return;
        }
        this._bound = true;
        const bus: EventBus = EventBus.getInstance();
        const hub: WsHub = WsHub.getInstance();

        bus.on(AudioMeshEvent.SessionStateChanged, (p): void => {
            hub.broadcast({
                type: 'session.state',
                timestamp: Date.now(),
                sessionId: p.sessionId,
                connectionState: p.connectionState,
            });
            if (p.connectionState === 'connected' || p.connectionState === 'disconnected') {
                const session = VoiceSessionManager.getInstance().get(p.sessionId);
                if (session !== null) {
                    hub.broadcast({
                        type: p.connectionState === 'connected'
                            ? 'session.connected'
                            : 'session.disconnected',
                        timestamp: Date.now(),
                        session: session.toDto(),
                    });
                }
            }
        });

        bus.on(AudioMeshEvent.ParticipantJoined, (p): void => {
            hub.broadcast({
                type: 'participant.joined',
                timestamp: Date.now(),
                sessionId: p.sessionId,
                participant: WsEventBridge._participantDto(p.participant),
            });
        });

        bus.on(AudioMeshEvent.ParticipantLeft, (p): void => {
            hub.broadcast({
                type: 'participant.left',
                timestamp: Date.now(),
                sessionId: p.sessionId,
                participant: WsEventBridge._participantDto(p.participant),
            });
        });

        bus.on(AudioMeshEvent.SpeechStarted, (p): void => {
            hub.broadcast({
                type: 'speech.started',
                timestamp: Date.now(),
                sessionId: p.sessionId,
                speakerId: p.speakerId,
            });
        });

        bus.on(AudioMeshEvent.SpeechStopped, (p): void => {
            hub.broadcast({
                type: 'speech.stopped',
                timestamp: Date.now(),
                sessionId: p.sessionId,
                speakerId: p.speakerId,
            });
        });

        bus.on(AudioMeshEvent.TranscriptPartial, (p): void => {
            hub.broadcast({
                type: 'transcript.partial',
                timestamp: Date.now(),
                sessionId: p.sessionId,
                line: WsEventBridge._transcriptLine(p.line),
            });
        });

        bus.on(AudioMeshEvent.TranscriptFinal, (p): void => {
            hub.broadcast({
                type: 'transcript.final',
                timestamp: Date.now(),
                sessionId: p.sessionId,
                line: WsEventBridge._transcriptLine(p.line),
            });
        });

        bus.on(AudioMeshEvent.AudioRouteStarted, (p): void => {
            hub.broadcast({
                type: 'audio.route.started',
                timestamp: Date.now(),
                routeId: p.routeId,
            });
        });

        bus.on(AudioMeshEvent.AudioRouteStopped, (p): void => {
            hub.broadcast({
                type: 'audio.route.stopped',
                timestamp: Date.now(),
                routeId: p.routeId,
            });
        });

        bus.on(AudioMeshEvent.AgentResponse, (p): void => {
            hub.broadcast({
                type: 'agent.response',
                timestamp: Date.now(),
                sessionId: p.sessionId,
                agentId: p.agentId,
                text: p.text,
            });
        });

        bus.on(AudioMeshEvent.ErrorOccurred, (p): void => {
            hub.broadcast({
                type: 'system.error',
                timestamp: Date.now(),
                component: p.component,
                message: p.message,
                ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
            });
        });
    }

    private static _participantDto(data: ParticipantEventData): ParticipantDto {
        return {
            participantId: data.participantId,
            platformUserId: data.platformUserId,
            displayName: data.displayName,
            speakingState: data.speakingState,
            muted: data.muted,
        };
    }

    private static _transcriptLine(data: TranscriptEventData): TranscriptEventData {
        return data;
    }

}
