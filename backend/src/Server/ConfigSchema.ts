import { Config, ConfigBackend } from 'figtree';
import { SchemaConfigBackendOptions } from 'figtree-schemas';
import { Vts, type ExtractSchemaResultType } from 'vts';

/**
 * SQLite database connection. `file` is an absolute or cwd-relative path. This is
 * the ONLY piece of AudioMesh configuration that lives outside the web frontend —
 * you need a database before the app (and its settings UI) can run. Everything
 * else (OpenAI, platforms, agents, routes, privacy) is edited in the dashboard
 * and persisted in the `ConfigStore`.
 */
export const SchemaSqliteDatabase = Vts.object({
    kind: Vts.equal('sqlite' as const),
    file: Vts.string(),
});

/** MariaDB/MySQL connection — selectable now, wired via the same TypeORM path
 *  later for multi-instance setups. */
export const SchemaMariaDbDatabase = Vts.object({
    kind: Vts.equal('mariadb' as const),
    host: Vts.string(),
    port: Vts.number(),
    database: Vts.string(),
    username: Vts.string(),
    password: Vts.string(),
});

export const SchemaDatabase = Vts.or([SchemaSqliteDatabase, SchemaMariaDbDatabase]);
export type DatabaseConfig = ExtractSchemaResultType<typeof SchemaDatabase>;

/**
 * AudioMesh backend config = figtree's `ConfigBackendOptions` (httpserver, db,
 * logging, cluster) plus:
 *  - `dataDir` — root for app working data (the `ConfigStore` JSON + the SQLite
 *    file when `database.kind === 'sqlite'`).
 *  - `database` — TypeORM connection.
 */
export const SchemaAudioMeshConfig = SchemaConfigBackendOptions.extend({
    dataDir: Vts.string(),
    database: SchemaDatabase,
});
export type AudioMeshConfig = ExtractSchemaResultType<typeof SchemaAudioMeshConfig>;

/**
 * Layer environment variables over the loaded config. Only the database + dataDir
 * are env-overridable (deploy-time infra). App settings are never env-driven —
 * they belong to the frontend.
 */
export function applyEnvOverrides(config: AudioMeshConfig): AudioMeshConfig {
    const env: NodeJS.ProcessEnv = process.env;
    const dataDir: string | undefined = env['AUDIOMESH_DATA_DIR'];
    if (dataDir !== undefined && dataDir.length > 0) {
        config.dataDir = dataDir;
    }
    const dbKind: string | undefined = env['AUDIOMESH_DATABASE_KIND'];
    if (dbKind === 'sqlite') {
        const file: string | undefined = env['AUDIOMESH_DATABASE_FILE'];
        if (file !== undefined && file.length > 0) {
            config.database = { kind: 'sqlite', file: file };
        }
    } else if (dbKind === 'mariadb') {
        const host: string | undefined = env['AUDIOMESH_DATABASE_HOST'];
        const portRaw: string | undefined = env['AUDIOMESH_DATABASE_PORT'];
        const database: string | undefined = env['AUDIOMESH_DATABASE_NAME'];
        const username: string | undefined = env['AUDIOMESH_DATABASE_USER'];
        const password: string | undefined = env['AUDIOMESH_DATABASE_PASSWORD'];
        if (
            host !== undefined && host.length > 0
            && portRaw !== undefined && portRaw.length > 0
            && database !== undefined && database.length > 0
            && username !== undefined
        ) {
            config.database = {
                kind: 'mariadb',
                host: host,
                port: Number(portRaw),
                database: database,
                username: username,
                password: password ?? '',
            };
        }
    }
    return config;
}

/**
 * `ConfigBackend` bound to {@link SchemaAudioMeshConfig}. `install()` plants it as
 * the process-wide `Config` singleton so figtree's `HttpService` sees the same
 * loaded config (mirrors the house pattern from headbangbear).
 */
export class AudioMeshConfigBackend extends ConfigBackend<AudioMeshConfig> {

    public constructor() {
        super(SchemaAudioMeshConfig);
    }

    public static install(): AudioMeshConfigBackend {
        const inst: AudioMeshConfigBackend = new AudioMeshConfigBackend();
        const configClass: { _instance: Config | null } = Config as unknown as {
            _instance: Config | null;
        };
        configClass._instance = inst;
        return inst;
    }

}
