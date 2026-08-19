import type { ConnectionState, SpeakingState } from '@audiomesh/schemas';

/**
 * Internal domain event names. These are the topics the {@link EventBus} carries.
 * The `WsEventBridge` maps the frontend-relevant subset onto the wire
 * `WsEventType` values from `@audiomesh/schemas` — the two lists are deliberately
 * separate so internal events (e.g. raw audio chunks) never leak to the browser.
 */
export const AudioMeshEvent = {
    VoiceSessionStarted: 'VoiceSessionStarted',
    VoiceSessionStopped: 'VoiceSessionStopped',
    SessionStateChanged: 'SessionStateChanged',
    ParticipantJoined: 'ParticipantJoined',
    ParticipantLeft: 'ParticipantLeft',
    AudioStarted: 'AudioStarted',
    AudioChunkReceived: 'AudioChunkReceived',
    SpeechStarted: 'SpeechStarted',
    SpeechStopped: 'SpeechStopped',
    TranscriptPartial: 'TranscriptPartial',
    TranscriptFinal: 'TranscriptFinal',
    SpeakerChanged: 'SpeakerChanged',
    AudioRouteStarted: 'AudioRouteStarted',
    AudioRouteStopped: 'AudioRouteStopped',
    AgentStarted: 'AgentStarted',
    AgentResponse: 'AgentResponse',
    ErrorOccurred: 'ErrorOccurred',
} as const;

export type AudioMeshEventName = (typeof AudioMeshEvent)[keyof typeof AudioMeshEvent];

/** Minimal participant shape carried on participant events (avoids importing the
 *  full session/participant classes into the event layer). */
export type ParticipantEventData = {
    participantId: string;
    platformUserId: string;
    displayName: string;
    speakingState: SpeakingState;
    muted: boolean;
};

export type TranscriptEventData = {
    speakerId: string;
    speakerName?: string;
    text: string;
    language?: string;
    confidence?: number;
    final: boolean;
    timestamp: number;
};

/**
 * Payload map: event name → payload type. Consumed by the typed {@link EventBus}
 * so `bus.emit('ParticipantJoined', payload)` is checked at compile time.
 */
export interface AudioMeshEventPayloads {
    [AudioMeshEvent.VoiceSessionStarted]: { sessionId: string };
    [AudioMeshEvent.VoiceSessionStopped]: { sessionId: string };
    [AudioMeshEvent.SessionStateChanged]: { sessionId: string; connectionState: ConnectionState };
    [AudioMeshEvent.ParticipantJoined]: { sessionId: string; participant: ParticipantEventData };
    [AudioMeshEvent.ParticipantLeft]: { sessionId: string; participant: ParticipantEventData };
    [AudioMeshEvent.AudioStarted]: { sessionId: string };
    [AudioMeshEvent.AudioChunkReceived]: { sessionId: string; speakerId: string; bytes: number };
    [AudioMeshEvent.SpeechStarted]: { sessionId: string; speakerId: string };
    [AudioMeshEvent.SpeechStopped]: { sessionId: string; speakerId: string };
    [AudioMeshEvent.TranscriptPartial]: { sessionId: string; line: TranscriptEventData };
    [AudioMeshEvent.TranscriptFinal]: { sessionId: string; line: TranscriptEventData };
    [AudioMeshEvent.SpeakerChanged]: { sessionId: string; speakerId: string };
    [AudioMeshEvent.AudioRouteStarted]: { routeId: string };
    [AudioMeshEvent.AudioRouteStopped]: { routeId: string };
    [AudioMeshEvent.AgentStarted]: { sessionId: string; agentId: string };
    [AudioMeshEvent.AgentResponse]: { sessionId: string; agentId: string; text: string };
    [AudioMeshEvent.ErrorOccurred]: { component: string; message: string; sessionId?: string };
}
