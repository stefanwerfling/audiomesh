import { Vts, type ExtractSchemaResultType } from 'vts';
import { SpeakingStateSchema } from './Common.js';

/**
 * A participant in a voice session, as exposed to the frontend. `audioSource`
 * on the backend is per-participant (enables future speaker diarization); the
 * wire DTO only carries the identity + live speaking/mute state.
 */
export const ParticipantSchema = Vts.object({
    participantId: Vts.string(),
    platformUserId: Vts.string(),
    displayName: Vts.string(),
    speakingState: SpeakingStateSchema,
    muted: Vts.boolean(),
});
export type Participant = ExtractSchemaResultType<typeof ParticipantSchema>;
