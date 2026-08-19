import { HttpRouteLoader, type IDefaultRoute } from 'figtree';
import { AgentsRoute } from './Routes/AgentsRoute.js';
import { AuthRoute } from './Routes/AuthRoute.js';
import { HealthRoute } from './Routes/HealthRoute.js';
import { PlatformsRoute } from './Routes/PlatformsRoute.js';
import { RoutesRoute } from './Routes/RoutesRoute.js';
import { SessionsRoute } from './Routes/SessionsRoute.js';
import { SettingsRoute } from './Routes/SettingsRoute.js';
import { SystemRoute } from './Routes/SystemRoute.js';

/**
 * Registers every REST route with figtree's `HttpService`. All routes live under
 * `/api/v1/...`. Order is irrelevant — each route owns a distinct URL space.
 */
export class AudioMeshRouteLoader extends HttpRouteLoader {

    public static override async loadRoutes(): Promise<IDefaultRoute[]> {
        return [
            new HealthRoute(),
            new SystemRoute(),
            new AuthRoute(),
            new SessionsRoute(),
            new PlatformsRoute(),
            new RoutesRoute(),
            new AgentsRoute(),
            new SettingsRoute(),
        ];
    }

}
