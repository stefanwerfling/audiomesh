import { join } from 'node:path';
import { BackendApp, ConfigBackend, HttpService, Logger } from 'figtree';
import type { DefaultArgs } from 'figtree-schemas';
import { MetricsCollector } from '../Core/MetricsCollector.js';
import { JitsiAdapter } from '../Platform/Adapters/Jitsi/JitsiAdapter.js';
import { LibJitsiClient } from '../Platform/Adapters/Jitsi/LibJitsiClient.js';
import type { JitsiConfig } from '../Platform/Adapters/Jitsi/JitsiConfig.js';
import type { IJitsiClient } from '../Platform/Adapters/Jitsi/IJitsiClient.js';
import { MockVoiceAdapter } from '../Platform/Adapters/MockVoiceAdapter.js';
import { TeamSpeakAdapter } from '../Platform/Adapters/TeamSpeak/TeamSpeakAdapter.js';
import type { TeamSpeakConfig } from '../Platform/Adapters/TeamSpeak/TeamSpeakConfig.js';
import type { ITeamSpeakClient } from '../Platform/Adapters/TeamSpeak/ITeamSpeakClient.js';
import { Ts3ProtocolClient } from '../Platform/Adapters/TeamSpeak/protocol/Ts3ProtocolClient.js';
import { PlatformRegistry } from '../Platform/PlatformRegistry.js';
import type { AdapterConfig } from '../Platform/IVoicePlatformAdapter.js';
import { ConfigStore } from '../Store/ConfigStore.js';
import { AudioMeshConfigBackend, applyEnvOverrides, type AudioMeshConfig } from './ConfigSchema.js';
import { AudioMeshRouteLoader } from './AudioMeshRouteLoader.js';
import { WsEndpointLoader } from './Ws/WsEndpointLoader.js';
import { WsEventBridge } from './Ws/WsEventBridge.js';

/**
 * The AudioMesh backend application. Boots figtree's `HttpService` (REST under
 * `/api/v1` + the `/api/ws` live event stream + static frontend), after wiring
 * the Core singletons: the platform registry (MockVoiceAdapter registered now,
 * real adapters in later phases), the JSON `ConfigStore` (everything except the
 * database is configured from the frontend), the metrics collector and the
 * EventBus → WebSocket bridge.
 */
export class AudioMeshApp extends BackendApp<DefaultArgs, AudioMeshConfig> {
    private readonly _configInstance: AudioMeshConfigBackend;

    public constructor() {
        super('audiomesh');
        this._configInstance = AudioMeshConfigBackend.install();
    }

    protected override _getConfigInstance(): ConfigBackend {
        return this._configInstance;
    }

    protected override async _initServices(): Promise<void> {
        const raw: AudioMeshConfig | null = this._configInstance.get();
        if (raw === null) {
            throw new Error('AudioMeshApp: configuration not loaded');
        }
        const config: AudioMeshConfig = applyEnvOverrides(raw);

        // Persisted app config (platforms, agents, routes, settings) lives next to
        // the DB under dataDir. The database itself is the only thing configured
        // outside the frontend.
        ConfigStore.install(join(config.dataDir, 'audiomesh-store.json'));

        // Register available platform adapters. Adding a platform later is a single
        // register() call — the Core never changes.
        PlatformRegistry.getInstance().register(
            'mock',
            (adapterConfig: AdapterConfig): MockVoiceAdapter => new MockVoiceAdapter(adapterConfig),
        );
        PlatformRegistry.getInstance().register(
            'jitsi',
            (adapterConfig: AdapterConfig): JitsiAdapter =>
                new JitsiAdapter(
                    adapterConfig,
                    (jitsiConfig: JitsiConfig): IJitsiClient => new LibJitsiClient(jitsiConfig),
                ),
        );
        PlatformRegistry.getInstance().register(
            'teamspeak',
            (adapterConfig: AdapterConfig): TeamSpeakAdapter =>
                new TeamSpeakAdapter(
                    adapterConfig,
                    (tsConfig: TeamSpeakConfig): ITeamSpeakClient => new Ts3ProtocolClient(tsConfig),
                ),
        );

        // Wire the event fan-out + metrics before the HTTP layer accepts clients.
        MetricsCollector.getInstance().bind();
        WsEventBridge.getInstance().bind();

        this._serviceManager.add(
            new HttpService(AudioMeshRouteLoader, 'http', [], { loader: WsEndpointLoader }),
        );

        Logger.getLogger().info('AudioMeshApp: services initialised');
    }
}
