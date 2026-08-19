import type { PlatformKind } from '@audiomesh/schemas';
import { Logger } from 'figtree';
import type {
    AdapterConfig,
    IVoicePlatformAdapter,
    VoicePlatformAdapterFactory,
} from './IVoicePlatformAdapter.js';

/**
 * Maps a {@link PlatformKind} to the factory that builds its adapter. This is the
 * one place that knows which concrete adapters exist — the Core resolves an
 * adapter purely by kind. A new platform registers its factory here (or via
 * `register` at startup) and nothing else in the Core changes.
 */
export class PlatformRegistry {

    private static _instance: PlatformRegistry | null = null;

    public static getInstance(): PlatformRegistry {
        if (PlatformRegistry._instance === null) {
            PlatformRegistry._instance = new PlatformRegistry();
        }
        return PlatformRegistry._instance;
    }

    private readonly _factories: Map<PlatformKind, VoicePlatformAdapterFactory> = new Map();

    public register(kind: PlatformKind, factory: VoicePlatformAdapterFactory): void {
        this._factories.set(kind, factory);
        Logger.getLogger().info(`PlatformRegistry: registered adapter '${kind}'`);
    }

    public has(kind: PlatformKind): boolean {
        return this._factories.has(kind);
    }

    public listKinds(): PlatformKind[] {
        return [...this._factories.keys()];
    }

    public create(kind: PlatformKind, config: AdapterConfig): IVoicePlatformAdapter {
        const factory: VoicePlatformAdapterFactory | undefined = this._factories.get(kind);
        if (factory === undefined) {
            throw new Error(`PlatformRegistry: no adapter registered for kind '${kind}'`);
        }
        return factory(config);
    }

}
