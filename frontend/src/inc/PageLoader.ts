import { SidebarMenuItem, Wrapper } from 'bambooo';
import { WsClient } from './Net/WsClient.js';
import type { IPage } from './Pages/IPage.js';

export interface PageEntry {
    name: string;
    title: string;
    icon: string;
    factory: () => IPage;
    menuItem?: SidebarMenuItem;
}

/**
 * Owns the bambooo `Wrapper` (sidebar/navbar/content skeleton), wires the sidebar
 * menu, swaps the active page on click, and opens the shared live WebSocket. Each
 * page renders into the content container and cleans up in `unmount()`.
 */
export class PageLoader {

    private readonly _wrapper: Wrapper = new Wrapper();
    private readonly _entries: PageEntry[];
    private _current: IPage | null = null;

    public constructor(entries: PageEntry[]) {
        this._entries = entries;
        this._wrapper.getMainSidebar().getLogo().setTitle('AudioMesh');
    }

    public async start(initialName: string): Promise<void> {
        WsClient.getInstance().connect();

        const menu = this._wrapper.getMainSidebar().getSidebar().getMenu();
        for (const entry of this._entries) {
            const item: SidebarMenuItem = new SidebarMenuItem(menu);
            item.setName(entry.name);
            item.setTitle(entry.title);
            item.setIconClass(entry.icon);
            item.setClick(async (): Promise<void> => {
                await this._switchTo(entry);
                for (const other of this._entries) {
                    other.menuItem?.setActiv(other.name === entry.name);
                }
            });
            entry.menuItem = item;
        }
        menu.initTreeview();

        const start: PageEntry =
            this._entries.find((e: PageEntry): boolean => e.name === initialName) ??
            (this._entries[0] as PageEntry);
        await this._switchTo(start);
        start.menuItem?.setActiv(true);
    }

    private async _switchTo(entry: PageEntry): Promise<void> {
        if (this._current !== null) {
            this._current.unmount();
        }
        const content = this._wrapper.getContentWrapper().getContent();
        content.getElement().empty();
        this._wrapper.getContentWrapper().getContentHeader().setTitle(entry.title);
        const page: IPage = entry.factory();
        await page.mount(content.getElement());
        this._current = page;
    }

}
