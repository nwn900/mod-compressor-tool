export enum TargetType {
  ALL = 'all',
  TEXTURES = 'textures',
  MESHES = 'meshes',
  SOUNDS = 'sounds',
  LOD = 'lod',
  ANIMATIONS = 'animations',
}

export const TARGET_NAMES: Record<TargetType, string> = {
  [TargetType.ALL]: 'Entire mod',
  [TargetType.TEXTURES]: 'Textures',
  [TargetType.MESHES]: 'Meshes',
  [TargetType.SOUNDS]: 'Sounds',
  [TargetType.LOD]: 'LOD/DynDOLOD',
  [TargetType.ANIMATIONS]: 'Animations',
};

export interface ModInfo {
  fileCount: number;
  totalSize: number;
  diskSize: number;
  ratio: number;
  compressed: boolean;
  algorithm: string;
  compressedAt: string;
  scannedAt: string;
  skippedFiles: number;
  textureSize: number;
  meshSize: number;
  soundSize: number;
  lodSize: number;
  animationSize: number;
  otherSize: number;
  compressedByAttr: number;
  compressedBySize: number;
  compressedByWof: number;
}

export interface ModWorkload {
  root: string;
  operationItems: string[];
  scanFiles: string[];
  isForeign: boolean;
}

export interface ResolvedMod {
  id: string;
  name: string;
  enabled: boolean;
  installationPath: string;
}

export interface CompressionProgress {
  done: number;
  total: number;
  modName: string;
}

export enum CompressionAlgorithm {
  XPRESS4K = 'xpress4k',
  XPRESS8K = 'xpress8k',
  XPRESS16K = 'xpress16k',
  LZX = 'lzx',
}

export const COMPRESSION_ALGORITHMS: Record<CompressionAlgorithm, string> = {
  [CompressionAlgorithm.XPRESS4K]: 'XPRESS4K',
  [CompressionAlgorithm.XPRESS8K]: 'XPRESS8K',
  [CompressionAlgorithm.XPRESS16K]: 'XPRESS16K',
  [CompressionAlgorithm.LZX]: 'LZX',
};

export const DEFAULT_ALGORITHM = CompressionAlgorithm.XPRESS8K;

export function modInfoFromDict(dict: Partial<ModInfo> | undefined): ModInfo {
  return {
    fileCount: dict?.fileCount ?? 0,
    totalSize: dict?.totalSize ?? 0,
    diskSize: dict?.diskSize ?? 0,
    ratio: dict?.ratio ?? 0,
    compressed: dict?.compressed ?? false,
    algorithm: dict?.algorithm ?? '',
    compressedAt: dict?.compressedAt ?? '',
    scannedAt: dict?.scannedAt ?? '',
    skippedFiles: dict?.skippedFiles ?? 0,
    textureSize: dict?.textureSize ?? 0,
    meshSize: dict?.meshSize ?? 0,
    soundSize: dict?.soundSize ?? 0,
    lodSize: dict?.lodSize ?? 0,
    animationSize: dict?.animationSize ?? 0,
    otherSize: dict?.otherSize ?? 0,
    compressedByAttr: dict?.compressedByAttr ?? 0,
    compressedBySize: dict?.compressedBySize ?? 0,
    compressedByWof: dict?.compressedByWof ?? 0,
  };
}

export function modInfoToDict(info: ModInfo): Record<string, unknown> {
  return { ...info };
}
