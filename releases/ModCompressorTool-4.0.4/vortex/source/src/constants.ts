import { TargetType } from './types';

/**
 * File extensions eligible for compression.
 * These are the same extensions as the MO2 mod_compressor_tool.py uses.
 */
export const COMPRESSIBLE_EXTENSIONS = new Set([
  '.dds', '.tga', '.bmp',
  '.nif', '.btr', '.bto', '.tri',
  '.wav', '.xwm',
  '.hkx', '.kf',
  '.lst', '.btd',
  '.lod',
]);

/**
 * File extensions that should never be compressed.
 * Archives, scripts, configs, executables, libraries, text files.
 */
export const IGNORE_EXTENSIONS = new Set([
  '.bsa', '.ba2',
  '.zip', '.7z', '.rar',
  '.esp', '.esm', '.esl',
  '.exe', '.dll',
  '.txt', '.ini', '.xml', '.json',
  '.py', '.pex', '.psc',
  '.hlsl', '.fx', '.lut',
  '.html', '.bat', '.jar',
  '.omod', '.fomod',
  '.pdf',
  '.jpg', '.jpeg', '.png', '.gif',
]);

/**
 * Minimum logical file size to consider for compression (bytes).
 */
export const MIN_FILE_SIZE = 256;

/**
 * Minimum file size for which compression is worthwhile (bytes).
 */
export const MIN_COMPRESS_SIZE = 1024;

/**
 * Compression ratio threshold above which a mod is considered compressed.
 */
export const COMPRESSED_RATIO_THRESHOLD = 1.10;

/**
 * Target directories per content category.
 * These paths are matched case-insensitively within a mod's root.
 */
export const TARGET_DIRS: Record<TargetType, string[]> = {
  [TargetType.TEXTURES]: ['textures'],
  [TargetType.MESHES]: ['meshes', 'meshes2', '_1stperson', '_1stpersonmeshes'],
  [TargetType.SOUNDS]: ['sound', 'music', 'voice'],
  [TargetType.LOD]: [
    'dyndolod', 'xlodgen', 'texgen',
    'lodsettings', 'occlusion',
    'grass', 'billboards',
  ],
  [TargetType.ANIMATIONS]: [
    'animations',
    '_1stperson/animations',
    'meshes/actors',
    'nemesis_engine', 'pandora_engine',
    'dar', 'oar',
  ],
  [TargetType.ALL]: [],
};

/**
 * LOD nested paths that are checked within a mod's subdirectories.
 * These are specifically for LOD/DynDOLOD content that lives in non-obvious locations.
 */
export const LOD_NESTED_PATHS = [
  'textures/terrain',
  'textures/lod',
  'textures/actors',
  'meshes/terrain',
  'meshes/lod',
  'lodsettings',
  'grass',
  'billboards',
];

/**
 * LOD path indicator substrings used to classify files as LOD content.
 */
export const LOD_PATH_INDICATORS = [
  '/lod/',
  '\\lod\\',
  '/dyndolod/',
  '\\dyndolod\\',
  '/terrain/',
  '\\terrain\\',
  '/grass/',
  '\\grass\\',
  '/xlodgen/',
  '\\xlodgen\\',
  '/texgen/',
  '\\texgen\\',
  '/billboards/',
  '\\billboards\\',
  '/occlusion/',
  '\\occlusion\\',
  '/lodsettings/',
  '\\lodsettings\\',
];

/**
 * Regex patterns for LOD filenames.
 * DynDOLOD/xLODGen produce files like "tamriel.4.0.0.dds" or "tree_lod.nif".
 */
export const LOD_FILENAME_PATTERNS = [
  /^\w+\.\d+\.\-?\d+\.\-?\d+\./,
  /_lod\d*\./,
  /_far\./,
  /\.lod$/,
];

/**
 * Bethesda game IDs as recognized by Vortex.
 */
export const BETHESDA_GAME_IDS = new Set([
  'skyrim',
  'skyrimse',
  'skyrimspecialedition',
  'skyrimvr',
  'fallout3',
  'fallout4',
  'fallout4vr',
  'newvegas',
  'oblivion',
  'morrowind',
  'starfield',
  'enderal',
  'enderalse',
]);

/**
 * File size categories for content tag display (bytes).
 */
export const TEXTURE_TAG_THRESHOLD = 1024 * 1024;       // 1MB
export const MESH_TAG_THRESHOLD = 512 * 1024;           // 512KB
export const LOD_TAG_THRESHOLD = 256 * 1024;            // 256KB
