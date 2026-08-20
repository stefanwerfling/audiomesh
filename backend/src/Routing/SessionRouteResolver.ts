import type { RouteNode } from '@audiomesh/schemas';
import { FanInAudioSource } from '../Audio/FanInAudioSource.js';
import { GainAudioProcessor } from '../Audio/GainAudioProcessor.js';
import type { IAudioProcessor, IAudioSink, IAudioSource } from '../Audio/IAudio.js';
import { NullAudioSink } from '../Audio/NullAudioSink.js';
import type { Participant } from '../Session/Participant.js';
import { VoiceSessionManager } from '../Session/VoiceSessionManager.js';
import type { IRouteNodeResolver } from './IRouteNodeResolver.js';

/**
 * The default {@link IRouteNodeResolver}, resolving nodes against live sessions:
 *
 *  - **source** `type:'session'`, `ref:<sessionId>` → a {@link FanInAudioSource}
 *    over that session's current participant sources (the session's mixed audio).
 *  - **sink** `type:'session'`, `ref:<sessionId>` → that session's adapter
 *    `sendAudio()` — how audio crosses into another platform. `type:'null'` → a
 *    counting {@link NullAudioSink}.
 *  - **processor** `type:'gain'`, `ref:<factor>` → {@link GainAudioProcessor};
 *    `type:'passthrough'` → null (skipped).
 *
 * A session source snapshots the participants present when the route starts;
 * restart the route to pick up later joiners (MVP scope).
 */
export class SessionRouteResolver implements IRouteNodeResolver {
    public resolveSource(node: RouteNode): IAudioSource {
        if (node.type === 'session') {
            const session = this._session(node.ref);
            const inputs: IAudioSource[] = session
                .getParticipants()
                .map((p: Participant): IAudioSource | null => p.getAudioSource())
                .filter((s: IAudioSource | null): s is IAudioSource => s !== null);
            return new FanInAudioSource(`route-src-${session.sessionId}`, inputs);
        }
        throw new Error(`route source: unsupported type '${node.type}'`);
    }

    public resolveProcessor(node: RouteNode): IAudioProcessor | null {
        if (node.type === 'passthrough') {
            return null;
        }
        if (node.type === 'gain') {
            return new GainAudioProcessor(node.id, Number(node.ref ?? '1'));
        }
        throw new Error(`route processor: unsupported type '${node.type}'`);
    }

    public resolveSink(node: RouteNode): IAudioSink {
        if (node.type === 'session') {
            return this._session(node.ref).getAdapter().sendAudio();
        }
        if (node.type === 'null') {
            return new NullAudioSink(`route-null-${node.id}`);
        }
        throw new Error(`route sink: unsupported type '${node.type}'`);
    }

    private _session(ref: string | undefined) {
        const session = VoiceSessionManager.getInstance().get(ref ?? '');
        if (session === null) {
            throw new Error(`route: unknown session '${ref ?? ''}'`);
        }
        return session;
    }
}
