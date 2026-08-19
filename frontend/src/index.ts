import { PageLoader } from './inc/PageLoader.js';
import { Agents } from './inc/Pages/Agents.js';
import { AudioRoutes } from './inc/Pages/AudioRoutes.js';
import { Dashboard } from './inc/Pages/Dashboard.js';
import { Platforms } from './inc/Pages/Platforms.js';
import { Sessions } from './inc/Pages/Sessions.js';
import { Settings } from './inc/Pages/Settings.js';
import { System } from './inc/Pages/System.js';
import { Transcripts } from './inc/Pages/Transcripts.js';

(async (): Promise<void> => {
    const loader: PageLoader = new PageLoader([
        { name: 'dashboard', title: 'Dashboard', icon: 'nav-icon fas fa-gauge-high', factory: (): Dashboard => new Dashboard() },
        { name: 'sessions', title: 'Sessions', icon: 'nav-icon fas fa-satellite-dish', factory: (): Sessions => new Sessions() },
        { name: 'platforms', title: 'Platforms', icon: 'nav-icon fas fa-plug', factory: (): Platforms => new Platforms() },
        { name: 'routes', title: 'Audio Routes', icon: 'nav-icon fas fa-diagram-project', factory: (): AudioRoutes => new AudioRoutes() },
        { name: 'agents', title: 'Agents', icon: 'nav-icon fas fa-robot', factory: (): Agents => new Agents() },
        { name: 'transcripts', title: 'Transcripts', icon: 'nav-icon fas fa-closed-captioning', factory: (): Transcripts => new Transcripts() },
        { name: 'settings', title: 'Settings', icon: 'nav-icon fas fa-cog', factory: (): Settings => new Settings() },
        { name: 'system', title: 'System', icon: 'nav-icon fas fa-microchip', factory: (): System => new System() },
    ]);
    await loader.start('dashboard');
})();
