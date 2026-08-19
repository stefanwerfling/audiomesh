import 'reflect-metadata';
import { bootstrap, type BootstrapResult } from 'figtree';
import { AudioMeshApp } from './Server/AudioMeshApp.js';

const main: () => Promise<void> = async (): Promise<void> => {
    const result: BootstrapResult = await bootstrap((): AudioMeshApp => new AudioMeshApp());
    await result.start();
};

void main().catch((err: unknown): void => {
    console.error('Fatal error during bootstrap:', err);
    process.exit(1);
});
