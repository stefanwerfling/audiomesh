import { Vts, type ExtractSchemaResultType } from 'vts';
import type { ConnectionState } from './Common.js';
import type { Participant } from './Participant.js';
import type { Session, TranscriptLine } from './Session.js';

/**
 * WebSocket event type discriminators. The frontend subscribes to `/api/ws` and
 * switches on `type`; the backend `EventBus` bridge emits these exact strings.
 * Kept as a vts `or` so `WsEventType` is derived from one source of truth.
 */
export const WsEventTypeSchema = Vts.or([
    Vts.equal('session.connected' as const),
    Vts.equal('session.disconnected' as const),
    Vts.equal('session.state' as const),
    Vts.equal('participant.joined' as const),
    Vts.equal('participant.left' as const),
    Vts.equal('speech.started' as const),
    Vts.equal('speech.stopped' as const),
    Vts.equal('transcript.partial' as const),
    Vts.equal('transcript.final' as const),
    Vts.equal('audio.route.started' as const),
    Vts.equal('audio.route.stopped' as const),
    Vts.equal('agent.response' as const),
    Vts.equal('system.error' as const),
]);
export type WsEventType = ExtractSchemaResultType<typeof WsEventTypeSchema>;

/**
 * The events pushed to the frontend, as a proper discriminated union on `type`.
 * These are TS types (not runtime-validated vts schemas): the backend builds them
 * and `JSON.stringify`s them onto the socket; the client narrows on `type`.
 */

export interface WsEventBase {
    timestamp: number;
}

export interface SessionConnectedEvent extends WsEventBase {
    type: 'session.connected';
    session: Session;
}

export interface SessionDisconnectedEvent extends WsEventBase {
    type: 'session.disconnected';
    session: Session;
}

export interface SessionStateEvent extends WsEventBase {
    type: 'session.state';
    sessionId: string;
    connectionState: ConnectionState;
}

export interface ParticipantJoinedEvent extends WsEventBase {
    type: 'participant.joined';
    sessionId: string;
    participant: Participant;
}

export interface ParticipantLeftEvent extends WsEventBase {
    type: 'participant.left';
    sessionId: string;
    participant: Participant;
}

export interface SpeechStartedEvent extends WsEventBase {
    type: 'speech.started';
    sessionId: string;
    speakerId: string;
}

export interface SpeechStoppedEvent extends WsEventBase {
    type: 'speech.stopped';
    sessionId: string;
    speakerId: string;
}

export interface TranscriptPartialEvent extends WsEventBase {
    type: 'transcript.partial';
    sessionId: string;
    line: TranscriptLine;
}

export interface TranscriptFinalEvent extends WsEventBase {
    type: 'transcript.final';
    sessionId: string;
    line: TranscriptLine;
}

export interface AudioRouteStartedEvent extends WsEventBase {
    type: 'audio.route.started';
    routeId: string;
}

export interface AudioRouteStoppedEvent extends WsEventBase {
    type: 'audio.route.stopped';
    routeId: string;
}

export interface AgentResponseEvent extends WsEventBase {
    type: 'agent.response';
    sessionId: string;
    agentId: string;
    text: string;
}

export interface SystemErrorEvent extends WsEventBase {
    type: 'system.error';
    component: string;
    message: string;
    sessionId?: string;
}

/** Discriminated union of every event the backend pushes to the frontend. */
export type WsEvent =
    | SessionConnectedEvent
    | SessionDisconnectedEvent
    | SessionStateEvent
    | ParticipantJoinedEvent
    | ParticipantLeftEvent
    | SpeechStartedEvent
    | SpeechStoppedEvent
    | TranscriptPartialEvent
    | TranscriptFinalEvent
    | AudioRouteStartedEvent
    | AudioRouteStoppedEvent
    | AgentResponseEvent
    | SystemErrorEvent;
