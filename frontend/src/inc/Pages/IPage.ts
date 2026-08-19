/**
 * Bare page contract used by {@link PageLoader}. A page renders into the jQuery
 * container the loader hands it and tears down its own timers/subscriptions in
 * `unmount()`.
 */
export interface IPage {
    mount(container: JQuery): Promise<void>;
    unmount(): void;
}
