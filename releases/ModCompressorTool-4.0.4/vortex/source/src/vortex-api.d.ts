declare module 'vortex-api' {
  export const selectors: {
    activeGameId: (state: any) => string | undefined;
    activeProfile: (state: any) => any;
  };
  export const util: {
    getVortexPath: (name: string) => string;
    getApplication: () => { name: string };
  };
  export interface IMainPageOptions {
    id?: string;
    group?: 'dashboard' | 'global' | 'per-game' | 'support' | 'hidden';
    hotkey?: string;
    hotkeyRaw?: string;
    priority?: number;
    badge?: any;
    activity?: any;
    visible?: () => boolean;
    props?: () => any;
    onReset?: () => void;
  }
  export type NotificationType = 'info' | 'warning' | 'success' | 'error';

  export interface INotification {
    type: NotificationType;
    message: string;
    title?: string;
    actions?: Array<{ title: string; action: (dismiss: () => void) => void }>;
  }

  export interface IExtensionApi {
    getState(): any;
    events: any;
    store: any;
    sendNotification(notification: INotification): void;
    showDialog?(type: string, title: string, content: string | any[], options: any): Promise<any>;
    dismissNotification?(id: string): void;
    lookupModName?(gameId: string, modId: string): string;
    lookupModPath?(gameId: string, modId: string): string;
    lookupMods?(gameId: string): Array<{ id: string; name: string; enabled: boolean; installationPath: string }>;
    renderMainPage?: any;
  }

  export interface ITableAttribute {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    customRenderer?: (value: any, mod: any, t: any) => any;
    calc?: (mod: any) => any;
    placement?: string;
    isToggle?: boolean;
    toggleAction?: (modId: string) => any;
    isSortable?: boolean;
    filter?: (value: any) => boolean;
  }

  export interface IExtensionContext {
    api: IExtensionApi;
    once(fn: () => void): void;
    registerAction(
      container: string,
      group: number,
      icon: string,
      title: string,
      callback: (modIds: string[]) => void,
      options?: { condition?: () => boolean; active?: () => boolean; tooltip?: string },
    ): void;
    registerMainPage?(icon: string, title: string, component: any, options?: IMainPageOptions): void;
    registerSettings?(
      title: string,
      component: any,
      options?: { icon?: string },
    ): void;
    registerTableAttribute?(attribute: ITableAttribute): void;
    registerReducer?(name: string, reducer: (state: any, action: any) => any): void;
    onAsync?(event: string, handler: (...args: any[]) => Promise<any>): void;
  }
}
