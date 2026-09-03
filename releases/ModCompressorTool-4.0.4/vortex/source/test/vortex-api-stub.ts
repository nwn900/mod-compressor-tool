export const selectors = {
  activeGameId: (state: any): string | undefined => state?.settings?.gameMode?.id,
  activeProfile: (state: any): any => state?.settings?.profiles?.activeProfile,
};

export const util = {
  getVortexPath: (name: string): string => {
    const appData = process.env.APPDATA ?? process.cwd();
    return name === 'base' ? appData : appData;
  },
  getApplication: (): { name: string } => ({ name: 'Vortex' }),
};
