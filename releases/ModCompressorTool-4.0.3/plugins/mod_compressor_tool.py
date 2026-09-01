# -*- coding: utf-8 -*-
"""
Mod Compressor Tool for MO2 2.5.x (Qt6) - Multi-Game
Version 4.0.3 - Game-agnostic Bethesda mod compression plugin
"""

import os
import sys
import json
import time
import copy
import subprocess
import platform
import re
import datetime as dt
import math
from typing import Optional, Tuple, List, Dict, Any, Set, Callable
from dataclasses import dataclass, field
from enum import IntEnum, auto


def _prime_windows_dll_search_path():
    """
    Help embedded Python builds find optional runtime DLLs such as libffi.
    This is a no-op on older Python versions or non-Windows platforms.
    """
    if os.name != "nt" or not hasattr(os, "add_dll_directory"):
        return []

    module = sys.modules.get(__name__)
    module_file = globals().get("__file__", "") or getattr(module, "__file__", "")
    module_spec = globals().get("__spec__", None)
    module_origin = getattr(module_spec, "origin", "") if module_spec is not None else ""

    seeds = [
        module_file,
        module_origin,
        getattr(sys, "executable", ""),
        getattr(sys, "_base_executable", ""),
        getattr(sys, "prefix", ""),
        getattr(sys, "base_prefix", ""),
        getattr(sys, "exec_prefix", ""),
    ]

    handles = []
    seen = set()
    suffixes = (
        "",
        "DLLs",
        "dlls",
        "Python",
        os.path.join("Python", "DLLs"),
        "python",
        os.path.join("python", "DLLs"),
    )

    for seed in seeds:
        seed = str(seed or "").strip()
        if not seed:
            continue

        seed_dir = seed if os.path.isdir(seed) else os.path.dirname(seed)
        if not seed_dir:
            continue

        for suffix in suffixes:
            candidate = os.path.normpath(os.path.join(seed_dir, suffix))
            key = candidate.casefold()
            if key in seen or not os.path.isdir(candidate):
                continue

            seen.add(key)
            try:
                handles.append(os.add_dll_directory(candidate))
            except (FileNotFoundError, OSError):
                pass

    return handles


_DLL_DIRECTORY_HANDLES = _prime_windows_dll_search_path()

CTYPES_IMPORT_ERROR = ""
try:
    import ctypes
    from ctypes import wintypes
except ImportError as exc:
    ctypes = None
    wintypes = None
    CTYPES_IMPORT_ERROR = str(exc)

import mobase

# ---- Qt6 (MO2 2.5.x) ----
QT6 = False
try:
    from PyQt6 import QtCore, QtGui, QtWidgets
    from PyQt6.QtCore import Qt
    QT6 = True
except ImportError:
    from PyQt5 import QtCore, QtGui, QtWidgets
    from PyQt5.QtCore import Qt


# ---- Qt compatibility ----
if QT6:
    CHECKED = Qt.CheckState.Checked
    UNCHECKED = Qt.CheckState.Unchecked
    SELECT_ROWS = QtWidgets.QAbstractItemView.SelectionBehavior.SelectRows
    NO_EDIT = QtWidgets.QAbstractItemView.EditTrigger.NoEditTriggers
    INTERACTIVE = QtWidgets.QHeaderView.ResizeMode.Interactive
    RESIZE_TO_CONTENTS = QtWidgets.QHeaderView.ResizeMode.ResizeToContents
    STRETCH = QtWidgets.QHeaderView.ResizeMode.Stretch
    YES_BTN = QtWidgets.QMessageBox.StandardButton.Yes
    QUEUED_CONNECTION = Qt.ConnectionType.QueuedConnection
    USER_ROLE = Qt.ItemDataRole.UserRole
    ALIGN_CENTER = Qt.AlignmentFlag.AlignCenter
    ALIGN_RIGHT = Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter
else:
    CHECKED = Qt.Checked
    UNCHECKED = Qt.Unchecked
    SELECT_ROWS = QtWidgets.QAbstractItemView.SelectRows
    NO_EDIT = QtWidgets.QAbstractItemView.NoEditTriggers
    INTERACTIVE = QtWidgets.QHeaderView.Interactive
    RESIZE_TO_CONTENTS = QtWidgets.QHeaderView.ResizeToContents
    STRETCH = QtWidgets.QHeaderView.Stretch
    YES_BTN = QtWidgets.QMessageBox.Yes
    QUEUED_CONNECTION = Qt.QueuedConnection
    USER_ROLE = Qt.UserRole
    ALIGN_CENTER = Qt.AlignCenter
    ALIGN_RIGHT = Qt.AlignRight | Qt.AlignVCenter

MOD_NAME_ROLE = int(USER_ROLE)
SORT_ROLE = MOD_NAME_ROLE + 1


# ---- ModState check ----
def _get_mod_state_active_flag() -> int:
    for attr in ("ACTIVE", "Active", "active"):
        try:
            return getattr(mobase.ModState, attr)
        except AttributeError:
            continue
    return 0x2

MOD_STATE_ACTIVE = _get_mod_state_active_flag()


# ---- Constants ----
class TargetType(IntEnum):
    TEXTURES = auto()
    MESHES = auto()
    SOUNDS = auto()
    LOD = auto()
    ANIMATIONS = auto()
    ALL = auto()


TARGET_NAMES = {
    TargetType.TEXTURES: "Textures",
    TargetType.MESHES: "Meshes",
    TargetType.SOUNDS: "Sounds",
    TargetType.LOD: "LOD/DynDOLOD",
    TargetType.ANIMATIONS: "Animations",
    TargetType.ALL: "Entire mod",
}

# Directories to search for each target type
# Case-insensitive matching will be used
TARGET_DIRS = {
    TargetType.TEXTURES: [
        "textures",
    ],
    TargetType.MESHES: [
        "meshes",
    ],
    TargetType.SOUNDS: [
        "sound",
        "sounds",
        "music",
    ],
    TargetType.LOD: [
        "dyndolod",
        "lod",
        "terrain",
        "grass",
        "xlodgen",
        "texgen",
        "texgen_output",
        "dyndolod_output",
        "lodgen",
        "lodgen_output",
        "occlusion",
        "billboards",
    ],
    TargetType.ANIMATIONS: [
        "animations",
        "meshes/actors",
        "skse/plugins/oar",
        "skse/plugins/dar",
        "nemesis_engine",
        "pandora_output",
    ],
}

LOD_NESTED_PATHS = [
    "textures/terrain",
    "textures/lod",
    "textures/actors",
    "meshes/terrain",
    "meshes/lod",
    "lodsettings",
    "grass",
    "billboards",
]

# Extensions to ignore (already compressed or not worth compressing)
IGNORE_EXTENSIONS: Set[str] = {
    # Archives (already compressed)
    ".bsa", ".ba2", ".zip", ".7z", ".rar", ".gz", ".xz", ".bz2",
    # Plugin files (small, critical)
    ".esp", ".esm", ".esl",
    # MO2 metadata
    ".fomod", ".meta", ".mohidden",
    # Config and docs
    ".txt", ".json", ".ini", ".cfg", ".xml", ".yaml", ".yml",
    ".md", ".log", ".pdf", ".doc", ".docx", ".rtf",
    # Images (already compressed)
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    # Executables (usually already compressed)
    ".exe", ".dll",
    # Source code
    ".psc", ".py", ".lua", ".js",
}

# Extensions that compress well
COMPRESSIBLE_EXTENSIONS: Set[str] = {
    # Textures
    ".dds", ".tga", ".bmp",
    # Meshes
    ".nif", ".btr", ".bto", ".tri",
    # LOD
    ".lod", ".lst", ".btd", ".fuz",
    # Audio (uncompressed)
    ".wav", ".xwm", ".lip",
    # Animations
    ".hkx", ".kf",
    # Other
    ".pex", ".seq", ".swf",
}

# Minimum file size for scanning (bytes)
# Reduced for LOD files which can be small
MIN_FILE_SIZE = 256

# Minimum file size for compression consideration
MIN_COMPRESS_SIZE = 1024

# Checkpoint granularity for long explicit-path operations.  The native helper
# still parallelizes each request internally; splitting only when progress is
# requested gives the UI observable milestones without changing the default
# single-request behavior used by callers that do not need progress.
OPERATION_BATCH_SIZE = 32

# Version for the on-disk state wrapper.  StateManager still exposes the
# historical mod-name mapping internally so worker/UI callers remain stable.
STATE_SCHEMA_VERSION = 2

# WinAPI constants
BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
INVALID_FILE_SIZE = 0xFFFFFFFF
FILE_ATTRIBUTE_COMPRESSED = 0x800
FILE_ATTRIBUTE_REPARSE_POINT = 0x400
FILE_ATTRIBUTE_SPARSE_FILE = 0x200
INVALID_FILE_ATTRIBUTES = 0xFFFFFFFF
IO_REPARSE_TAG_WOF = 0x80000017

COMPRESSION_ALGORITHMS = {
    "xpress4k": "XPRESS4K (fastest, ~1.5-2x)",
    "xpress8k": "XPRESS8K (balanced, ~2-2.5x)",
    "xpress16k": "XPRESS16K (better, ~2.5-3x)",
    "lzx": "LZX (maximum, ~3-4x)",
}

UNMANAGED_PREFIX = "Unmanaged: "

# ---- Game Detection ----
SUPPORTED_GAME_TOKENS = [
    "skyrimse", "skyrimspecialedition", "skyrimvr",
    "fallout4", "fallout4vr",
    "fallout3", "fallout3vr",
    "falloutnv", "falloutnewvegas",
    "oblivion",
    "starfield",
    "enderal",
    "enderalse",
    "nehrimese",
]

LOD_PATH_INDICATORS = [
    '/lod/', '\\lod\\',
    '/dyndolod/', '\\dyndolod\\',
    '/terrain/', '\\terrain\\',
    '/grass/', '\\grass\\',
    '/xlodgen/', '\\xlodgen\\',
    '/texgen/', '\\texgen\\',
    '/billboards/', '\\billboards\\',
    '/occlusion/', '\\occlusion\\',
    '/lodsettings/', '\\lodsettings\\',
    '/visinfo/', '\\visinfo\\',
    '/vis/', '\\vis\\',
]

_current_game_token: str = ""


def _normalize_token(token: str) -> str:
    return token.replace("-", "").replace("_", "").replace(" ", "").lower()


def _detect_game(organizer) -> str:
    global _current_game_token
    try:
        game_name = str(organizer.managedGame().gameName()).lower()
        game_short = str(organizer.managedGame().gameShortName()).lower()
    except Exception:
        game_name = ""
        game_short = ""

    for token in SUPPORTED_GAME_TOKENS:
        nt = _normalize_token(token)
        if nt in _normalize_token(game_name) or nt in _normalize_token(game_short):
            _current_game_token = token
            return token

    _current_game_token = "generic"
    return "generic"


def _get_game_name(organizer) -> str:
    try:
        return str(organizer.managedGame().gameName())
    except Exception:
        return "Game"

# ---- WinAPI ----
kernel32 = None
GetCompressedFileSizeW = None
GetFileAttributesW = None

if ctypes is not None and wintypes is not None:
    try:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

        GetCompressedFileSizeW = kernel32.GetCompressedFileSizeW
        GetCompressedFileSizeW.argtypes = [
            wintypes.LPCWSTR,
            ctypes.POINTER(wintypes.DWORD),
        ]
        GetCompressedFileSizeW.restype = wintypes.DWORD

        GetFileAttributesW = kernel32.GetFileAttributesW
        GetFileAttributesW.argtypes = [wintypes.LPCWSTR]
        GetFileAttributesW.restype = wintypes.DWORD
    except Exception as exc:
        CTYPES_IMPORT_ERROR = CTYPES_IMPORT_ERROR or f"{type(exc).__name__}: {exc}"
        kernel32 = None
        GetCompressedFileSizeW = None
        GetFileAttributesW = None


# ---- Data Classes ----
def _coerce_int(value: Any, default: int = 0, minimum: Optional[int] = 0) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError, OverflowError):
        return default
    return max(minimum, parsed) if minimum is not None else parsed


def _coerce_float(value: Any, default: float = 1.0, minimum: Optional[float] = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return default
    if not math.isfinite(parsed) or (minimum is not None and parsed < minimum):
        return default
    return parsed


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().casefold() in {"1", "true", "yes", "on"}
    return default


@dataclass
class ModInfo:
    file_count: int = 0
    total_size: int = 0
    disk_size: int = 0
    last_mtime: float = 0.0
    compressed: bool = False
    ratio: float = 1.0
    algorithm: str = ""
    compressed_at: str = ""
    scanned_at: str = ""
    # Last resolved MO2 path; useful for stale-entry/rename diagnosis.
    source_path: str = ""
    # Breakdown by type
    texture_size: int = 0
    mesh_size: int = 0
    sound_size: int = 0
    lod_size: int = 0
    animation_size: int = 0
    other_size: int = 0
    # Debug info
    compressed_by_attr: int = 0
    compressed_by_size: int = 0
    compressed_by_wof: int = 0
    skipped_files: int = 0
    
    def to_dict(self) -> dict:
        return {
            "file_count": self.file_count,
            "total_size": self.total_size,
            "disk_size": self.disk_size,
            "last_mtime": self.last_mtime,
            "compressed": self.compressed,
            "ratio": self.ratio,
            "algorithm": self.algorithm,
            "compressed_at": self.compressed_at,
            "scanned_at": self.scanned_at,
            "source_path": self.source_path,
            "texture_size": self.texture_size,
            "mesh_size": self.mesh_size,
            "sound_size": self.sound_size,
            "lod_size": self.lod_size,
            "animation_size": self.animation_size,
            "other_size": self.other_size,
            "compressed_by_attr": self.compressed_by_attr,
            "compressed_by_size": self.compressed_by_size,
            "compressed_by_wof": self.compressed_by_wof,
            "skipped_files": self.skipped_files,
        }
    
    @classmethod
    def from_dict(cls, d: dict) -> 'ModInfo':
        if not isinstance(d, dict):
            return cls()
        info = cls(
            file_count=_coerce_int(d.get("file_count", 0)),
            total_size=_coerce_int(d.get("total_size", 0)),
            disk_size=_coerce_int(d.get("disk_size", 0)),
            last_mtime=_coerce_float(d.get("last_mtime", 0.0), 0.0),
            compressed=_coerce_bool(d.get("compressed", False)),
            ratio=_coerce_float(d.get("ratio", 1.0), 1.0),
            algorithm=str(d.get("algorithm", "") or ""),
            compressed_at=str(d.get("compressed_at", "") or ""),
            scanned_at=str(d.get("scanned_at", "") or ""),
            source_path=str(d.get("source_path", "") or ""),
            texture_size=_coerce_int(d.get("texture_size", 0)),
            mesh_size=_coerce_int(d.get("mesh_size", 0)),
            sound_size=_coerce_int(d.get("sound_size", 0)),
            lod_size=_coerce_int(d.get("lod_size", 0)),
            animation_size=_coerce_int(d.get("animation_size", 0)),
            other_size=_coerce_int(d.get("other_size", 0)),
        )
        info.compressed_by_attr = _coerce_int(d.get("compressed_by_attr", 0))
        info.compressed_by_size = _coerce_int(d.get("compressed_by_size", 0))
        info.compressed_by_wof = _coerce_int(d.get("compressed_by_wof", 0))
        info.skipped_files = _coerce_int(d.get("skipped_files", 0))
        return info


@dataclass
class ModWorkload:
    root: str = ""
    operation_items: List[str] = field(default_factory=list)
    scan_files: List[str] = field(default_factory=list)
    is_foreign: bool = False


class SortableTableWidgetItem(QtWidgets.QTableWidgetItem):
    def __lt__(self, other):
        if not isinstance(other, QtWidgets.QTableWidgetItem):
            return super().__lt__(other)

        left = self.data(SORT_ROLE)
        right = other.data(SORT_ROLE)
        if left is None or right is None:
            return self.text().casefold() < other.text().casefold()

        try:
            return left < right
        except TypeError:
            return str(left).casefold() < str(right).casefold()


# ---- Helper Functions ----
def _now_iso() -> str:
    return (
        dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _format_size(size: int) -> str:
    if size < 0:
        return "—"
    for unit in ('B', 'KB', 'MB', 'GB'):
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def _check_windows() -> Tuple[bool, str]:
    if platform.system() != "Windows":
        return False, "Windows required"
    try:
        major = int(platform.version().split('.')[0])
        if major < 10:
            return False, "Windows 10+ required"
    except:
        pass
    return True, ""


def _filetree_continue():
    try:
        return mobase.IFileTree.WalkReturn.CONTINUE
    except AttributeError:
        return mobase.IFileTree.CONTINUE


def _normalize_tree_rel_path(rel_path: str) -> str:
    path = str(rel_path).replace("\\", "/").strip()
    while path.startswith("./"):
        path = path[2:]
    path = path.lstrip("/")
    if path.lower().startswith("data/"):
        path = path[5:]
    return path


def _iter_mod_lookup_names(name: str) -> List[str]:
    names = [name]
    if name.startswith(UNMANAGED_PREFIX):
        stripped = name[len(UNMANAGED_PREFIX):].strip()
        if stripped and stripped not in names:
            names.append(stripped)
    return names


def _resolve_mod(organizer, name: str):
    mod_list = None
    try:
        mod_list = organizer.modList()
    except:
        pass

    for candidate in _iter_mod_lookup_names(name):
        if mod_list and hasattr(mod_list, "getMod"):
            try:
                mod = mod_list.getMod(candidate)
                if mod:
                    return mod
            except:
                pass

        if hasattr(organizer, "getMod"):
            try:
                mod = organizer.getMod(candidate)
                if mod:
                    return mod
            except:
                pass

    return None


def _get_game_data_path(organizer) -> str:
    try:
        game = organizer.managedGame()
    except:
        return ""

    if not game or not hasattr(game, "dataDirectory"):
        return ""

    try:
        data_dir = game.dataDirectory()
    except:
        return ""

    for attr in ("absolutePath", "path"):
        if not hasattr(data_dir, attr):
            continue
        try:
            path = getattr(data_dir, attr)()
        except TypeError:
            path = getattr(data_dir, attr)
        except:
            continue

        if path:
            return os.path.normpath(str(path))

    return ""


def _is_foreign_mod(mod, name: str) -> bool:
    if name.startswith(UNMANAGED_PREFIX):
        return True

    if mod and hasattr(mod, "isForeign"):
        try:
            return bool(mod.isForeign())
        except:
            pass

    return False


def _get_mod_path_from_organizer(organizer, name: str) -> str:
    mod = _resolve_mod(organizer, name)
    if not mod:
        return ""

    for attr in ("absolutePath", "path"):
        if not hasattr(mod, attr):
            continue
        try:
            p = getattr(mod, attr)()
        except TypeError:
            p = getattr(mod, attr)
        except:
            continue

        if p:
            return os.path.normpath(str(p))

    if _is_foreign_mod(mod, name):
        return _get_game_data_path(organizer)

    return ""


def _normalize_origin_name(name: str) -> str:
    text = str(name).strip()
    if text.startswith(UNMANAGED_PREFIX):
        text = text[len(UNMANAGED_PREFIX):].strip()
    return text.casefold()


def _get_file_origins(organizer, rel_path: str) -> List[str]:
    if not hasattr(organizer, "getFileOrigins"):
        return []

    try:
        origins = organizer.getFileOrigins(_normalize_tree_rel_path(rel_path))
    except:
        return []

    if origins is None:
        return []

    try:
        return [str(origin) for origin in origins if origin is not None]
    except TypeError:
        return [str(origins)] if origins else []


def _origin_matches_mod(origins: List[str], mod_name: str) -> bool:
    if not origins:
        return False

    wanted = {
        _normalize_origin_name(candidate)
        for candidate in _iter_mod_lookup_names(mod_name)
    }
    wanted.discard("")
    if not wanted:
        return False

    for origin in origins:
        if _normalize_origin_name(origin) in wanted:
            return True

    return False


def _get_foreign_scan_roots(base_root: str, targets: List[TargetType]) -> List[str]:
    if TargetType.ALL in targets:
        return [base_root]

    roots: List[str] = []
    seen: Set[str] = set()
    rel_roots: List[str] = []

    for target in targets:
        rel_roots.extend(TARGET_DIRS.get(target, []))

    if TargetType.LOD in targets:
        rel_roots.extend(LOD_NESTED_PATHS)

    for rel_root in rel_roots:
        full_root = os.path.normpath(os.path.join(base_root, rel_root))
        key = full_root.casefold()
        if key in seen or not os.path.isdir(full_root):
            continue
        seen.add(key)
        roots.append(full_root)

    return roots


def _collect_foreign_mod_file_paths(
    organizer, mod_name: str, base_root: str, targets: List[TargetType]
) -> List[str]:
    if not base_root or not os.path.isdir(base_root):
        return []

    files: List[str] = []
    seen: Set[str] = set()
    scan_roots = _get_foreign_scan_roots(base_root, targets)
    if not scan_roots:
        return []

    for scan_root in scan_roots:
        try:
            for root, dirs, filenames in os.walk(scan_root, followlinks=False):
                dirs[:] = [
                    d for d in dirs
                    if not d.startswith('.') and not _is_symlink_or_junction(os.path.join(root, d))
                ]

                for filename in filenames:
                    full_path = os.path.join(root, filename)
                    key = full_path.casefold()
                    if key in seen or not os.path.isfile(full_path):
                        continue

                    try:
                        rel_path = os.path.relpath(full_path, base_root)
                    except ValueError:
                        continue

                    origins = _get_file_origins(organizer, rel_path)
                    if not _origin_matches_mod(origins, mod_name):
                        continue

                    seen.add(key)
                    files.append(full_path)
        except PermissionError:
            continue

    return files


def _matches_target_path(rel_path: str, targets: List[TargetType]) -> bool:
    rel_norm = _normalize_tree_rel_path(rel_path).casefold()
    if not rel_norm:
        return False

    if TargetType.ALL in targets:
        return True

    prefixes = set()
    for target in targets:
        for target_dir in TARGET_DIRS.get(target, []):
            prefixes.add(target_dir.casefold().strip("/"))

    if TargetType.LOD in targets:
        for nested_path in LOD_NESTED_PATHS:
            prefixes.add(nested_path.casefold().strip("/"))

    for prefix in prefixes:
        if rel_norm == prefix or rel_norm.startswith(prefix + "/"):
            return True

    return False


def _filter_file_paths_for_targets(
    file_paths: List[str], base_root: str, targets: List[TargetType]
) -> List[str]:
    if TargetType.ALL in targets:
        return list(file_paths)

    result: List[str] = []
    seen: Set[str] = set()

    for full_path in file_paths:
        try:
            rel_path = os.path.relpath(full_path, base_root)
        except ValueError:
            rel_path = os.path.basename(full_path)

        if not _matches_target_path(rel_path, targets):
            continue

        key = full_path.casefold()
        if key not in seen:
            seen.add(key)
            result.append(full_path)

    return result


def _resolve_mod_workload(
    organizer, name: str, targets: Optional[List[TargetType]] = None
) -> ModWorkload:
    targets = list(targets) if targets else [TargetType.ALL]
    mod = _resolve_mod(organizer, name)
    root = _get_mod_path_from_organizer(organizer, name)
    if not mod or not root:
        return ModWorkload(root=root)

    is_foreign = _is_foreign_mod(mod, name)
    if not is_foreign:
        return ModWorkload(
            root=root,
            operation_items=_find_target_dirs(root, targets),
            is_foreign=False,
        )

    data_root = _get_game_data_path(organizer) or root
    scan_files = _collect_foreign_mod_file_paths(organizer, name, data_root, [TargetType.ALL])
    return ModWorkload(
        root=data_root,
        operation_items=_collect_foreign_mod_file_paths(organizer, name, data_root, targets),
        scan_files=scan_files,
        is_foreign=True,
    )


def _collect_workload_file_paths(
    workload: ModWorkload, for_compression: bool = False
) -> List[str]:
    """Expand a resolved workload into the exact files an operation may touch.

    Managed workloads contain target directories; foreign workloads already
    contain origin-verified files.  Keeping this expansion outside both
    backends makes native and compact execution receive the same safe paths.
    """
    result: List[str] = []
    seen: Set[str] = set()

    def add_file(filepath: str) -> None:
        normalized = os.path.abspath(os.path.normpath(str(filepath)))
        key = normalized.casefold()
        if key in seen or not os.path.isfile(normalized) or os.path.islink(normalized):
            return
        if for_compression:
            ext = os.path.splitext(normalized)[1].lower()
            if ext not in COMPRESSIBLE_EXTENSIONS:
                return
            try:
                if os.path.getsize(normalized) < MIN_COMPRESS_SIZE:
                    return
            except OSError:
                return
        seen.add(key)
        result.append(normalized)

    for item in workload.operation_items:
        item = os.path.abspath(os.path.normpath(str(item)))
        if os.path.isfile(item):
            add_file(item)
            continue
        if not os.path.isdir(item) or _is_symlink_or_junction(item):
            continue

        for root, dirs, filenames in os.walk(item, followlinks=False):
            dirs[:] = [
                directory
                for directory in dirs
                if not directory.startswith(".")
                and not _is_symlink_or_junction(os.path.join(root, directory))
            ]
            for filename in filenames:
                add_file(os.path.join(root, filename))

    return result


def _describe_work_item(path: str, root: str) -> str:
    try:
        rel = os.path.relpath(path, root)
    except ValueError:
        rel = os.path.basename(path)

    if rel == ".":
        return "(entire mod)"
    return rel


def _has_winapi_physical_size() -> bool:
    return (
        ctypes is not None and
        wintypes is not None and
        GetCompressedFileSizeW is not None
    )


def _extract_stat_file_attributes(stat_info) -> int:
    try:
        return int(getattr(stat_info, "st_file_attributes"))
    except (AttributeError, TypeError, ValueError):
        return INVALID_FILE_ATTRIBUTES


def _extract_stat_reparse_tag(stat_info) -> int:
    try:
        return int(getattr(stat_info, "st_reparse_tag", 0))
    except (TypeError, ValueError):
        return 0


def _stat_no_follow(path: str):
    try:
        return os.stat(path, follow_symlinks=False)
    except TypeError:
        try:
            return os.lstat(path)
        except (AttributeError, OSError):
            return os.stat(path)
    except OSError:
        return None


def _get_physical_size(filepath: str) -> int:
    """Get physical (on-disk) file size"""
    if not _has_winapi_physical_size():
        return -1

    try:
        high = wintypes.DWORD(0)
        low = GetCompressedFileSizeW(filepath, ctypes.byref(high))
        if low == INVALID_FILE_SIZE and ctypes.get_last_error() != 0:
            return -1
        return (high.value << 32) | low
    except:
        return -1


def _has_ntfs_compressed_attr(filepath: str, stat_info=None) -> bool:
    """Check if file has NTFS compressed attribute"""
    attrs = _extract_stat_file_attributes(stat_info)
    if attrs != INVALID_FILE_ATTRIBUTES:
        return bool(attrs & FILE_ATTRIBUTE_COMPRESSED)

    try:
        stat_info = os.stat(filepath)
        attrs = _extract_stat_file_attributes(stat_info)
        if attrs != INVALID_FILE_ATTRIBUTES:
            return bool(attrs & FILE_ATTRIBUTE_COMPRESSED)
    except:
        pass

    if GetFileAttributesW is None:
        return False

    try:
        attr = GetFileAttributesW(filepath)
        if attr == INVALID_FILE_ATTRIBUTES:
            return False
        return bool(attr & FILE_ATTRIBUTE_COMPRESSED)
    except:
        return False


def _is_wof_compressed(filepath: str, stat_info=None, physical_size: int = -1) -> bool:
    """Check if file has WOF compression (Reparse Point) or ghost compression"""
    try:
        if stat_info is None:
            stat_info = os.stat(filepath)

        # Check if it is a reparse point
        attrs = _extract_stat_file_attributes(stat_info)
        if attrs != INVALID_FILE_ATTRIBUTES:
            if attrs & FILE_ATTRIBUTE_REPARSE_POINT:
                tag = _extract_stat_reparse_tag(stat_info)
                if tag == IO_REPARSE_TAG_WOF:
                    return True

            # Skip if NTFS compressed or sparse
            if attrs & (FILE_ATTRIBUTE_COMPRESSED | FILE_ATTRIBUTE_SPARSE_FILE):
                return False

        # Fallback: Check physical vs logical size
        logical = stat_info.st_size
        if logical > 1024:
            if physical_size == -1:
                physical_size = _get_physical_size(filepath)

            if physical_size != -1 and physical_size < logical * 0.9:
                return True

    except:
        pass
    return False


def _is_symlink_or_junction(path: str) -> bool:
    """Check if path is a symlink or junction point"""
    try:
        if os.path.islink(path):
            return True
        if hasattr(os.path, "isjunction") and os.path.isjunction(path):
            return True

        stat_info = _stat_no_follow(path)
        attrs = _extract_stat_file_attributes(stat_info)
        if attrs != INVALID_FILE_ATTRIBUTES:
            return bool(attrs & FILE_ATTRIBUTE_REPARSE_POINT)

        if GetFileAttributesW is not None:
            attr = GetFileAttributesW(path)
            if attr != INVALID_FILE_ATTRIBUTES:
                return bool(attr & FILE_ATTRIBUTE_REPARSE_POINT)
    except:
        pass
    return False


def _get_file_category(filepath: str, ext: str) -> str:
    """Determine file category based on path and extension"""
    path_lower = filepath.lower()
    filename = os.path.basename(filepath).lower()

    # Check for LOD indicators in path (game-aware)
    for indicator in LOD_PATH_INDICATORS:
        if indicator in path_lower:
            return "lod"

    # Check for LOD filename patterns
    # DynDOLOD/xLODGen: tamriel.4.0.0.dds, tamriel.32.0.0.dds
    # Pattern: worldspace.level.x.y.extension
    lod_filename_patterns = [
        r'^\w+\.\d+\.\-?\d+\.\-?\d+\.',  # tamriel.4.0.0.dds
        r'_lod\d*\.',                      # tree_lod.nif, tree_lod0.dds
        r'_far\.',                         # mesh_far.nif
        r'\.lod$',                         # something.lod
    ]

    import re
    for pattern in lod_filename_patterns:
        if re.search(pattern, filename):
            return "lod"

    path_parts = path_lower.replace("\\", "/").split("/")
    if any(part in {"sound", "sounds", "music", "voice", "voices"} for part in path_parts):
        return "sound"
    if any(
        part in {"animations", "oar", "dar", "nemesis_engine", "pandora_output"}
        for part in path_parts
    ):
        return "animation"

    # Check extension
    if ext in {'.dds', '.tga', '.bmp'}:
        return "texture"
    elif ext in {'.nif', '.btr', '.bto', '.tri'}:
        return "mesh"
    elif ext in {'.lod', '.lst', '.btd', '.uvd'}:
        return "lod"
    elif ext in {'.wav', '.xwm', '.lip', '.fuz'}:
        return "sound"
    elif ext in {'.hkx', '.kf'}:
        return "animation"

    return "other"


def _decode_compact_output(data: bytes) -> str:
    for enc in ("cp866", "cp1251", "utf-8"):
        try:
            return data.decode(enc)
        except:
            pass
    return data.decode("utf-8", errors="replace")


def _parse_compact_ratio(output: str) -> float:
    ratio_patterns = [
        r'(\d+[.,]\d+)\s*(?:to|:|\s)\s*1',
        r'(\d+[.,]\d+)\s*Đş\s*1',
    ]

    for pattern in ratio_patterns:
        match = re.search(pattern, output, re.IGNORECASE)
        if match:
            try:
                return float(match.group(1).replace(',', '.'))
            except:
                pass

    return 1.0


def _parse_compact_storage_sizes(output: str) -> Tuple[int, int]:
    best_pair = (0, 0)
    best_sum = 0

    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if "ratio" in line.casefold():
            continue

        numbers = []
        for token in re.findall(r"\d[\d\s\u00A0.,]*\d|\d", line):
            digits = re.sub(r"\D", "", token)
            if not digits:
                continue
            try:
                numbers.append(int(digits))
            except ValueError:
                continue

        if len(numbers) < 2:
            continue

        for idx in range(len(numbers) - 1):
            left = numbers[idx]
            right = numbers[idx + 1]
            pair_sum = left + right
            if pair_sum > best_sum:
                best_sum = pair_sum
                best_pair = (left, right)

    logical = max(best_pair)
    physical = min(best_pair)
    if logical <= 0 or physical <= 0:
        return 0, 0
    return logical, physical


def _run_compact_query_legacy(path: str) -> Tuple[bool, float, str]:
    """Run compact.exe to check compression status"""
    try:
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = 0
        
        flags = 0
        if hasattr(subprocess, "CREATE_NO_WINDOW"):
            flags |= subprocess.CREATE_NO_WINDOW
        
        args = ["compact.exe", "/q"]
        if os.path.isdir(path):
            args.append(f"/s:{path}")
        else:
            args.append(path)
        
        p = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            startupinfo=si,
            creationflags=flags
        )
        stdout, stderr = p.communicate(timeout=60)
        
        out = _decode_compact_output(stdout)
        
        if p.returncode != 0:
            return False, 1.0, out
        
        ratio = 1.0
        is_compressed = False
        
        ratio_patterns = [
            r'(\d+[.,]\d+)\s*(?:to|:|\s)\s*1',
            r'(\d+[.,]\d+)\s*к\s*1',
        ]
        
        for pattern in ratio_patterns:
            match = re.search(pattern, out, re.IGNORECASE)
            if match:
                try:
                    ratio_str = match.group(1).replace(',', '.')
                    ratio = float(ratio_str)
                    if ratio > 1.0:
                        is_compressed = True
                    break
                except:
                    pass
        
        compressed_lines = len(re.findall(r'^\s*C\s+', out, re.MULTILINE))
        if compressed_lines > 0:
            is_compressed = True
        
        return is_compressed, ratio, out
        
    except Exception as e:
        return False, 1.0, str(e)


def _iter_compact_query_batches(
    file_paths: List[str], max_files: Optional[int] = None
):
    max_chars = 28000
    base_chars = len("compact.exe /q")
    file_limit = max(1, int(max_files)) if max_files else None
    batch: List[str] = []
    total_chars = base_chars

    for path in file_paths:
        if not path:
            continue

        path = os.path.normpath(path)
        path_chars = len(path) + 3

        if batch and (
            total_chars + path_chars > max_chars
            or (file_limit is not None and len(batch) >= file_limit)
        ):
            yield batch
            batch = [path]
            total_chars = base_chars + path_chars
            continue

        batch.append(path)
        total_chars += path_chars

    if batch:
        yield batch


def _run_compact_query_files(file_paths: List[str]) -> Tuple[bool, float, int, int]:
    total_logical = 0
    total_physical = 0
    any_compressed = False
    best_ratio = 1.0

    for batch in _iter_compact_query_batches(file_paths):
        try:
            si = subprocess.STARTUPINFO()
            si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            si.wShowWindow = 0

            flags = 0
            if hasattr(subprocess, "CREATE_NO_WINDOW"):
                flags |= subprocess.CREATE_NO_WINDOW

            p = subprocess.Popen(
                ["compact.exe", "/q", *batch],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                startupinfo=si,
                creationflags=flags,
            )
            stdout, stderr = p.communicate(timeout=120)
            out = _decode_compact_output(stdout)
            if p.returncode != 0:
                continue

            ratio = _parse_compact_ratio(out)
            compressed = ratio > 1.0 or bool(re.findall(r'^\s*C\s+', out, re.MULTILINE))
            any_compressed = any_compressed or compressed
            best_ratio = max(best_ratio, ratio)

            logical, physical = _parse_compact_storage_sizes(out)
            if logical > 0 and physical > 0:
                total_logical += logical
                total_physical += physical
        except Exception:
            continue

    if total_logical > 0 and total_physical > 0:
        best_ratio = total_logical / total_physical
        any_compressed = any_compressed or best_ratio > 1.0

    return any_compressed, best_ratio, total_logical, total_physical


def _run_compact_query(path: str) -> Tuple[bool, float, str]:
    """Run compact.exe to check compression status"""
    try:
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = 0

        flags = 0
        if hasattr(subprocess, "CREATE_NO_WINDOW"):
            flags |= subprocess.CREATE_NO_WINDOW

        args = ["compact.exe", "/q"]
        if os.path.isdir(path):
            args.append(f"/s:{path}")
        else:
            args.append(path)

        p = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            startupinfo=si,
            creationflags=flags
        )
        stdout, stderr = p.communicate(timeout=60)

        out = _decode_compact_output(stdout)

        if p.returncode != 0:
            return False, 1.0, out

        ratio = _parse_compact_ratio(out)
        is_compressed = ratio > 1.0

        compressed_lines = len(re.findall(r'^\s*C\s+', out, re.MULTILINE))
        if compressed_lines > 0:
            is_compressed = True

        return is_compressed, ratio, out

    except Exception as e:
        return False, 1.0, str(e)


def _iter_mod_scan_files(mod_root: str):
    """Yield every visible file the scanner will examine."""
    try:
        for root, dirs, files in os.walk(mod_root, followlinks=False):
            dirs[:] = [
                d for d in dirs
                if not d.startswith('.')
                and not _is_symlink_or_junction(os.path.join(root, d))
            ]
            for filename in files:
                yield os.path.join(root, filename)
    except PermissionError:
        return


def _count_mod_scan_files(mod_root: str) -> int:
    return sum(1 for _ in _iter_mod_scan_files(mod_root))


def _report_progress(callback: Optional[Callable[[int, int, str], None]],
                     done: int, total: int, label: str) -> None:
    if callback is None:
        return
    try:
        callback(done, total, label)
    except Exception:
        # Progress is diagnostic/UI feedback and must never abort a scan or
        # operation if a host callback has gone away during shutdown.
        pass


def _scan_file_paths(
    file_paths: List[str],
    use_compact_check: bool = False,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
    progress_total: Optional[int] = None,
) -> ModInfo:
    info = ModInfo()

    collect_compact_query_files = use_compact_check or not _has_winapi_physical_size()
    compressed_by_attr = 0
    compressed_by_size = 0
    compressed_by_wof = 0
    compact_query_files: List[str] = []
    skipped = 0

    finalization_units = 1 if collect_compact_query_files else 0
    default_total = len(file_paths) + finalization_units
    scan_total = max(
        default_total,
        max(0, int(progress_total)) if progress_total is not None else 0,
    ) if progress_callback else 0
    for scan_done, filepath in enumerate(file_paths, 1):
        try:
            ext = os.path.splitext(filepath)[1].lower()

            if ext in IGNORE_EXTENSIONS:
                skipped += 1
                continue

            if os.path.islink(filepath):
                skipped += 1
                continue

            stat = os.stat(filepath)
            logical_size = stat.st_size

            if logical_size < MIN_FILE_SIZE:
                skipped += 1
                continue

            info.file_count += 1
            info.total_size += logical_size
            info.last_mtime = max(info.last_mtime, stat.st_mtime)
            if collect_compact_query_files:
                compact_query_files.append(filepath)

            category = _get_file_category(filepath, ext)
            if category == "texture":
                info.texture_size += logical_size
            elif category == "mesh":
                info.mesh_size += logical_size
            elif category == "sound":
                info.sound_size += logical_size
            elif category == "lod":
                info.lod_size += logical_size
            elif category == "animation":
                info.animation_size += logical_size
            else:
                info.other_size += logical_size

            physical = _get_physical_size(filepath)

            if _has_ntfs_compressed_attr(filepath, stat):
                compressed_by_attr += 1

            if _is_wof_compressed(filepath, stat, physical):
                compressed_by_wof += 1

            if physical > 0:
                info.disk_size += physical
                if physical < logical_size * 0.90:
                    compressed_by_size += 1
            else:
                info.disk_size += logical_size

        except (OSError, PermissionError):
            skipped += 1
        finally:
            _report_progress(progress_callback, scan_done, scan_total, filepath)

    info.compressed_by_attr = compressed_by_attr
    info.compressed_by_size = compressed_by_size
    info.compressed_by_wof = compressed_by_wof
    info.skipped_files = skipped

    if info.total_size > 0 and info.disk_size > 0:
        info.ratio = info.total_size / info.disk_size
    else:
        info.ratio = 1.0

    has_ntfs_compression = compressed_by_attr > 0
    has_wof_compression = compressed_by_wof > 0
    min_threshold = max(1, info.file_count // 10)
    has_size_compression = (
        info.ratio > 1.10 and
        compressed_by_size >= min_threshold
    )

    compact_says_compressed = False
    if compact_query_files and (
        not _has_winapi_physical_size() or
        (use_compact_check and not (has_ntfs_compression or has_wof_compression or has_size_compression))
    ):
        compact_says_compressed, compact_ratio, compact_total, compact_stored = _run_compact_query_files(compact_query_files)
        if compact_total > 0 and compact_stored > 0:
            info.disk_size = compact_stored
            info.ratio = info.total_size / compact_stored if info.total_size > 0 else compact_ratio
        elif compact_ratio > info.ratio:
            info.ratio = compact_ratio

        _report_progress(
            progress_callback,
            len(file_paths) + finalization_units,
            scan_total,
            "finalizing compression check",
        )

    info.compressed = has_ntfs_compression or has_wof_compression or has_size_compression or compact_says_compressed
    info.scanned_at = _now_iso()

    return info


def _scan_mod_fast(
    mod_root: str,
    use_compact_check: bool = False,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
    progress_total: Optional[int] = None,
) -> ModInfo:
    """Scan a managed mod using the same path accounting as foreign mods."""
    return _scan_file_paths(
        list(_iter_mod_scan_files(mod_root)),
        use_compact_check=use_compact_check,
        progress_callback=progress_callback,
        progress_total=progress_total,
    )


def _scan_workload_progress_units(workload: ModWorkload, deep_scan: bool = False) -> int:
    """Return scan checkpoints for one workload (files plus final query)."""
    if workload.is_foreign:
        file_count = len(workload.scan_files)
    else:
        file_count = _count_mod_scan_files(workload.root) if workload.root else 0
    needs_finalization = deep_scan or not _has_winapi_physical_size()
    return max(1, file_count + (1 if needs_finalization else 0))


def _scan_mod_workload(
    workload: ModWorkload,
    use_compact_check: bool = False,
    progress_callback: Optional[Callable[[int, int, str], None]] = None,
    progress_total: Optional[int] = None,
) -> ModInfo:
    if workload.is_foreign:
        return _scan_file_paths(
            workload.scan_files,
            use_compact_check=use_compact_check,
            progress_callback=progress_callback,
            progress_total=progress_total,
        )
    return _scan_mod_fast(
        workload.root,
        use_compact_check=use_compact_check,
        progress_callback=progress_callback,
        progress_total=progress_total,
    )


def _verify_decompression(mod_root: str) -> Tuple[bool, float]:
    """Verify that files are actually decompressed"""
    total_logical = 0
    total_physical = 0
    compressed_files = 0
    checked = 0
    collect_compact_query_files = not _has_winapi_physical_size()
    checked_paths: List[str] = []
    
    try:
        for root, dirs, files in os.walk(mod_root, followlinks=False):
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            
            for filename in files:
                ext = os.path.splitext(filename)[1].lower()
                if ext in IGNORE_EXTENSIONS:
                    continue
                
                filepath = os.path.join(root, filename)
                
                if os.path.islink(filepath):
                    continue
                
                try:
                    stat = os.stat(filepath)
                    if stat.st_size < MIN_FILE_SIZE:
                        continue
                    
                    checked += 1
                    logical = stat.st_size
                    if collect_compact_query_files:
                        checked_paths.append(filepath)
                    physical = _get_physical_size(filepath)
                    
                    if physical <= 0:
                        physical = logical
                    
                    total_logical += logical
                    total_physical += physical
                    
                    if _has_ntfs_compressed_attr(filepath, stat):
                        compressed_files += 1
                    elif _is_wof_compressed(filepath, stat, physical):
                        compressed_files += 1
                    elif physical < logical * 0.90:
                        compressed_files += 1
                    
                    if checked >= 200:
                        break
                        
                except (OSError, PermissionError):
                    continue
            
            if checked >= 200:
                break
                
    except PermissionError:
        pass
    
    ratio = total_logical / total_physical if total_physical > 0 else 1.0

    if checked_paths and not _has_winapi_physical_size():
        compact_says_compressed, compact_ratio, compact_total, compact_stored = _run_compact_query_files(checked_paths)
        if compact_total > 0 and compact_stored > 0:
            ratio = compact_total / compact_stored
        elif compact_ratio > ratio:
            ratio = compact_ratio

        if compact_says_compressed and ratio >= 1.10:
            compressed_files = max(compressed_files, max(1, checked // 10))
    
    is_decompressed = (
        ratio < 1.10 and 
        compressed_files < max(1, checked // 10)
    )
    
    return is_decompressed, ratio


def _verify_decompression_files(file_paths: List[str]) -> Tuple[bool, float]:
    total_logical = 0
    total_physical = 0
    compressed_files = 0
    checked = 0
    collect_compact_query_files = not _has_winapi_physical_size()
    checked_paths: List[str] = []

    for filepath in file_paths:
        ext = os.path.splitext(filepath)[1].lower()
        if ext in IGNORE_EXTENSIONS:
            continue

        if os.path.islink(filepath):
            continue

        try:
            stat = os.stat(filepath)
            if stat.st_size < MIN_FILE_SIZE:
                continue

            checked += 1
            total_logical += stat.st_size
            if collect_compact_query_files:
                checked_paths.append(filepath)

            physical = _get_physical_size(filepath)
            if physical > 0:
                total_physical += physical
            else:
                total_physical += stat.st_size
                physical = stat.st_size

            if _has_ntfs_compressed_attr(filepath, stat):
                compressed_files += 1
            elif _is_wof_compressed(filepath, stat, physical):
                compressed_files += 1
            elif physical < stat.st_size * 0.90:
                compressed_files += 1

        except (OSError, PermissionError):
            continue

    if total_logical > 0 and total_physical > 0:
        ratio = total_logical / total_physical
    else:
        ratio = 1.0

    if checked_paths and not _has_winapi_physical_size():
        compact_says_compressed, compact_ratio, compact_total, compact_stored = _run_compact_query_files(checked_paths)
        if compact_total > 0 and compact_stored > 0:
            ratio = compact_total / compact_stored
        elif compact_ratio > ratio:
            ratio = compact_ratio

        if compact_says_compressed and ratio >= 1.10:
            compressed_files = max(compressed_files, max(1, checked // 10))

    is_decompressed = (
        ratio < 1.10 and
        compressed_files < max(1, checked // 10)
    )

    return is_decompressed, ratio


def _verify_decompression_workload(workload: ModWorkload) -> Tuple[bool, float]:
    if workload.is_foreign:
        return _verify_decompression_files(workload.scan_files)
    return _verify_decompression(workload.root)


def _find_target_dirs(mod_root: str, targets: List[TargetType]) -> List[str]:
    """Find target directories including nested LOD paths"""
    if TargetType.ALL in targets:
        return [mod_root]

    result = []
    seen = set()

    roots = [mod_root]
    data_path = os.path.join(mod_root, "Data")
    if os.path.isdir(data_path):
        roots.append(data_path)

    # Стандартные пути для целей
    target_names = set()
    for target in targets:
        dirs = TARGET_DIRS.get(target, [])
        for d in dirs:
            target_names.add(d.lower())

    # === Специальные вложенные пути для LOD (game-aware) ===
    lod_nested_paths = []
    if TargetType.LOD in targets:
        lod_nested_paths = list(LOD_NESTED_PATHS)

    for base in roots:
        try:
            # Поиск папок первого уровня
            for item in os.listdir(base):
                item_path = os.path.join(base, item)
                if not os.path.isdir(item_path):
                    continue
                if _is_symlink_or_junction(item_path):
                    continue

                item_lower = item.lower()
                key = item_path.lower()

                if item_lower in target_names and key not in seen:
                    seen.add(key)
                    result.append(item_path)

            # === ДОБАВИТЬ: Поиск вложенных LOD путей ===
            for nested in lod_nested_paths:
                nested_path = os.path.join(base, nested)
                nested_key = nested_path.lower()

                if os.path.isdir(nested_path) and nested_key not in seen:
                    seen.add(nested_key)
                    result.append(nested_path)

                    # Также добавляем все подпапки (worldspaces)
                    # textures/terrain/tamriel/, textures/terrain/blackreach/, etc.
                    if "terrain" in nested.lower():
                        try:
                            for ws in os.listdir(nested_path):
                                ws_path = os.path.join(nested_path, ws)
                                ws_key = ws_path.lower()
                                if os.path.isdir(ws_path) and ws_key not in seen:
                                    seen.add(ws_key)
                                    result.append(ws_path)
                        except (OSError, PermissionError):
                            pass

        except (OSError, PermissionError):
            continue

    # Fallback: если ничего не найдено, проверяем имя мода
    if not result:
        mod_name = os.path.basename(mod_root).lower()
        lod_keywords = ['dyndolod', 'xlodgen', 'texgen', 'lodgen', 'terrain', 'grass']
        for kw in lod_keywords:
            if kw in mod_name:
                return [mod_root]

    return result


# ---- State Manager ----
class StateManager:
    def __init__(self, path: str):
        self._path = path
        self._data: Dict[str, dict] = {}
        self._loaded_schema_version = STATE_SCHEMA_VERSION
    
    def load(self) -> None:
        if not self._path or not os.path.isfile(self._path):
            self._data = {}
            self._loaded_schema_version = STATE_SCHEMA_VERSION
            return
        try:
            with open(self._path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            if not isinstance(raw, dict):
                self._data = {}
                self._loaded_schema_version = STATE_SCHEMA_VERSION
                return

            # v2+ files wrap the historical mapping so metadata can evolve.
            # A legacy mod literally named "mods" must not be mistaken for
            # the wrapper unless an explicit schema version is present.
            wrapped_mods = raw.get("mods")
            if "schema_version" in raw and isinstance(wrapped_mods, dict):
                self._data = wrapped_mods
                self._loaded_schema_version = _coerce_int(
                    raw.get("schema_version"), 1, minimum=1
                )
            else:
                self._data = raw
                self._loaded_schema_version = 1
        except:
            self._data = {}
            self._loaded_schema_version = STATE_SCHEMA_VERSION
    
    def save(self) -> bool:
        if not self._path:
            return False
        try:
            os.makedirs(os.path.dirname(self._path), exist_ok=True)
            tmp = f"{self._path}.tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "schema_version": STATE_SCHEMA_VERSION,
                        "mods": self._data,
                    },
                    f,
                    ensure_ascii=False,
                    indent=2,
                )
            os.replace(tmp, self._path)
            self._loaded_schema_version = STATE_SCHEMA_VERSION
            return True
        except:
            return False
    
    def get(self, mod_name: str) -> ModInfo:
        data = self._data.get(mod_name, {})
        return ModInfo.from_dict(data)
    
    def set(self, mod_name: str, info: ModInfo) -> None:
        self._data[mod_name] = info.to_dict()
    
    def get_all_data(self) -> Dict[str, dict]:
        return copy.deepcopy(self._data)
    
    def update_all(self, data: Dict[str, dict]) -> None:
        if not isinstance(data, dict):
            self._data = {}
            return
        wrapped_mods = data.get("mods")
        if "schema_version" in data and isinstance(wrapped_mods, dict):
            self._data = copy.deepcopy(wrapped_mods)
            self._loaded_schema_version = _coerce_int(
                data.get("schema_version"), 1, minimum=1
            )
            return
        self._data = copy.deepcopy(data)
        self._loaded_schema_version = 1

    def prune(self, valid_mod_names: Set[str]) -> int:
        """Remove saved entries that are no longer in the current MO2 list."""
        valid = {str(name) for name in valid_mod_names}
        stale = [name for name in self._data if name not in valid]
        for name in stale:
            self._data.pop(name, None)
        return len(stale)

    def remove(self, mod_name: str) -> None:
        self._data.pop(mod_name, None)


# ---- Backend results ----
@dataclass
class BackendResult:
    """Normalized result shared by the native helper and compact fallback."""
    ok: bool
    code: int
    message: str = ""
    processed: int = 0
    changed: int = 0
    skipped: int = 0
    failed: int = 0
    errors: List[dict] = field(default_factory=list)
    stats: Optional[ModInfo] = None
    output: str = ""
    stderr: str = ""


# ---- Compact Runner ----
class CompactRunner:
    def __init__(self):
        self._process: Optional[subprocess.Popen] = None
        self._cancelled = False
    
    def cancel(self) -> None:
        self._cancelled = True
        if self._process:
            try:
                self._process.terminate()
                self._process.wait(timeout=3)
            except:
                try:
                    self._process.kill()
                    self._process.wait(timeout=3)
                except:
                    pass
    
    def _run(self, args: List[str], timeout: int = 3600) -> Tuple[int, str, str]:
        if self._cancelled:
            return -1, "", "Cancelled"
        
        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = 0
        
        flags = BELOW_NORMAL_PRIORITY_CLASS
        if hasattr(subprocess, "CREATE_NO_WINDOW"):
            flags |= subprocess.CREATE_NO_WINDOW
        
        try:
            self._process = subprocess.Popen(
                args,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                startupinfo=si,
                creationflags=flags
            )
            stdout, stderr = self._process.communicate(timeout=timeout)
            
            out, err = "", ""
            for enc in ("cp866", "cp1251", "utf-8"):
                try:
                    out = stdout.decode(enc)
                    err = stderr.decode(enc)
                    break
                except:
                    pass
            
            return self._process.returncode, out, err
            
        except subprocess.TimeoutExpired:
            self._process.kill()
            return -1, "", "Timeout"
        except Exception as e:
            return -1, "", str(e)
        finally:
            self._process = None

    def _target_args(self, path: str) -> List[str]:
        if os.path.isdir(path):
            return [f"/s:{path}"]
        return [path]
    
    def compress(self, path: str, algorithm: str) -> Tuple[int, str, str]:
        args = ["compact.exe", "/c", "/i", "/q", f"/exe:{algorithm}", *self._target_args(path)]
        return self._run(args)

    def compress_paths(
        self,
        paths: List[str],
        algorithm: str,
        progress_callback: Optional[Callable[[int, int, str], None]] = None,
    ) -> BackendResult:
        """Compress an explicit path list, keeping fallback scope identical to native mode."""
        if not paths:
            return BackendResult(True, 0, "no files")

        outputs: List[str] = []
        errors: List[dict] = []
        processed = 0
        completed = 0
        total = len(paths)
        for batch in _iter_compact_query_batches(paths, max_files=OPERATION_BATCH_SIZE):
            if self._cancelled:
                return BackendResult(False, -1, "Cancelled", processed=processed, errors=errors)
            code, output, error = self._run(
                ["compact.exe", "/c", "/i", "/q", f"/exe:{algorithm}", *batch],
                timeout=3600,
            )
            outputs.append(output)
            processed += len(batch) if code == 0 else 0
            if code != 0:
                errors.append({"path": batch[0] if batch else "", "code": code, "message": error or output})
            completed += len(batch)
            _report_progress(progress_callback, completed, total, batch[-1] if batch else "")

        failed = len(errors)
        return BackendResult(
            ok=failed == 0,
            code=0 if failed == 0 else int(errors[0].get("code", 1)),
            message="compressed" if failed == 0 else "compact compression failed",
            processed=processed,
            changed=processed,
            failed=failed,
            errors=errors,
            output="\n".join(outputs),
            stderr="\n".join(str(item.get("message", "")) for item in errors),
        )
    
    def decompress(self, path: str) -> Tuple[int, str, str]:
        """
        Decompress all compression types (NTFS + WOF)
        """
        if self._cancelled:
            return -1, "", "Cancelled"
        
        results = []
        
        # Step 1: WOF/LZX decompression
        # Нужно указать ЛЮБОЙ алгоритм для /EXE при распаковке
        # Используем тот же что и при сжатии, или xpress4k как fallback
        for algo in ["xpress4k", "xpress8k", "xpress16k", "lzx"]:
            if self._cancelled:
                return -1, "", "Cancelled"
            
            args = ["compact.exe", "/u", f"/exe:{algo}", "/i", "/q", *self._target_args(path)]
            code, out, err = self._run(args, timeout=1800)
            results.append(f"WOF ({algo}): code={code}")
            
            # Если успешно распаковано - не нужно пробовать другие алгоритмы
            # Но compact не говорит сколько файлов обработано, так что пробуем все
        
        # Step 2: Standard NTFS decompression (для файлов сжатых через NTFS, не WOF)
        if self._cancelled:
            return -1, "", "Cancelled"
        
        args = ["compact.exe", "/u", "/i", "/q", *self._target_args(path)]
        code, out, err = self._run(args, timeout=1800)
        results.append(f"NTFS: code={code}")
        
        # Верификация результата
        all_output = "\n".join(results)
        
        return 0, all_output, ""

    def decompress_paths(
        self,
        paths: List[str],
        progress_callback: Optional[Callable[[int, int, str], None]] = None,
    ) -> BackendResult:
        """Remove WOF and NTFS compression from an explicit path list."""
        if not paths:
            return BackendResult(True, 0, "no files")

        outputs: List[str] = []
        errors: List[dict] = []
        processed = 0
        completed = 0
        total = len(paths)
        for batch in _iter_compact_query_batches(paths, max_files=OPERATION_BATCH_SIZE):
            if self._cancelled:
                return BackendResult(False, -1, "Cancelled", processed=processed, errors=errors)

            batch_ok = False
            last_code = 0
            last_error = ""
            for algo in ("xpress4k", "xpress8k", "xpress16k", "lzx"):
                code, output, error = self._run(
                    ["compact.exe", "/u", f"/exe:{algo}", "/i", "/q", *batch],
                    timeout=1800,
                )
                outputs.append(f"WOF ({algo}):\n{output}")
                last_code = code
                last_error = error or output
                batch_ok = batch_ok or code == 0
                if self._cancelled:
                    return BackendResult(False, -1, "Cancelled", processed=processed, errors=errors)

            code, output, error = self._run(
                ["compact.exe", "/u", "/i", "/q", *batch],
                timeout=1800,
            )
            outputs.append(f"NTFS:\n{output}")
            last_code = code
            last_error = error or output
            batch_ok = batch_ok or code == 0
            if batch_ok:
                processed += len(batch)
            else:
                errors.append({"path": batch[0] if batch else "", "code": last_code, "message": last_error})
            completed += len(batch)
            _report_progress(progress_callback, completed, total, batch[-1] if batch else "")

        failed = len(errors)
        return BackendResult(
            ok=failed == 0,
            code=0 if failed == 0 else int(errors[0].get("code", 1)),
            message="decompressed" if failed == 0 else "compact decompression failed",
            processed=processed,
            changed=processed,
            failed=failed,
            errors=errors,
            output="\n".join(outputs),
            stderr="\n".join(str(item.get("message", "")) for item in errors),
        )


class NativeHelperRunner:
    """Optional JSON-lines wrapper around the Windows WOF helper.

    The helper is deliberately optional. A missing, incompatible, or failed
    probe leaves the caller on the explicit-path compact fallback.
    """

    PROTOCOL_VERSION = "0.1.0"
    DEFAULT_TIMEOUT = 7200
    MAX_OUTPUT_CHARS = 262144
    SUPPORTED_ALGORITHMS = frozenset({"xpress4k", "xpress8k", "xpress16k", "lzx"})

    def __init__(self, helper_path: Optional[str] = None):
        self._helper_path = os.path.normpath(helper_path) if helper_path else self._find_helper_path()
        self._process: Optional[subprocess.Popen] = None
        self._cancelled = False
        self._probed = False
        self._available = bool(self._helper_path and os.path.isfile(self._helper_path))
        self.version = ""

    @property
    def helper_path(self) -> str:
        return self._helper_path or ""

    @property
    def available(self) -> bool:
        return self._available

    def _find_helper_path(self) -> Optional[str]:
        configured = os.environ.get("MOD_COMPRESSOR_HELPER", "").strip()
        module_file = globals().get("__file__", "") or ""
        module_dir = os.path.dirname(os.path.abspath(module_file))
        candidates = [
            configured,
            os.path.join(module_dir, "native", "mod-compressor-helper.exe"),
            os.path.join(module_dir, "mod-compressor-helper.exe"),
            os.path.join(os.getcwd(), "native", "mod-compressor-helper.exe"),
        ]
        for candidate in candidates:
            if candidate and os.path.isfile(candidate):
                return os.path.normpath(candidate)
        return None

    def _startup_kwargs(self) -> dict:
        kwargs = {
            "stdin": subprocess.PIPE,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
        }
        startup_factory = getattr(subprocess, "STARTUPINFO", None)
        if startup_factory is not None:
            try:
                startup = startup_factory()
                startup.dwFlags |= getattr(subprocess, "STARTF_USESHOWWINDOW", 0)
                startup.wShowWindow = 0
                kwargs["startupinfo"] = startup
            except Exception:
                pass

        creation_flags = int(getattr(subprocess, "CREATE_NO_WINDOW", 0) or 0)
        creation_flags |= int(BELOW_NORMAL_PRIORITY_CLASS)
        if creation_flags:
            kwargs["creationflags"] = creation_flags
        return kwargs

    def _request(self, payload: dict, timeout: int = DEFAULT_TIMEOUT) -> BackendResult:
        if not self._available or not self._helper_path:
            return BackendResult(False, -2, "native helper unavailable")
        if self._cancelled:
            return BackendResult(False, -1, "Cancelled")

        try:
            self._process = subprocess.Popen(
                [self._helper_path],
                **self._startup_kwargs(),
            )
            stdout, stderr = self._process.communicate(
                input=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
                timeout=timeout,
            )
            code = int(self._process.returncode if self._process.returncode is not None else -1)
        except subprocess.TimeoutExpired:
            self.cancel()
            return BackendResult(False, -1, "Timeout")
        except Exception as exc:
            return BackendResult(False, -1, str(exc))
        finally:
            self._process = None

        output = self._cap_text(self._decode_output(stdout))
        error_text = self._cap_text(self._decode_output(stderr))
        if not output.strip():
            return BackendResult(
                False,
                code or -1,
                error_text or "native helper returned no output",
                output=output,
                stderr=error_text,
            )

        try:
            response = self._parse_response(output)
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            return BackendResult(
                False,
                code or -1,
                f"invalid native helper response: {exc}",
                output=output,
                stderr=error_text,
            )

        result = self._result_from_response(response, output, error_text)
        if code != 0 and result.code == 0:
            result.code = code
            result.ok = False
        return result

    @staticmethod
    def _decode_output(value: Any) -> str:
        if isinstance(value, bytes):
            for encoding in ("utf-8", "cp866", "cp1251"):
                try:
                    return value.decode(encoding)
                except UnicodeDecodeError:
                    continue
            return value.decode("utf-8", errors="replace")
        return str(value or "")

    @classmethod
    def _cap_text(cls, value: str) -> str:
        if len(value) <= cls.MAX_OUTPUT_CHARS:
            return value
        half = cls.MAX_OUTPUT_CHARS // 2
        return value[:half] + "\n...[output truncated]...\n" + value[-half:]

    @staticmethod
    def _parse_response(output: str) -> dict:
        lines = [line.strip() for line in str(output).splitlines() if line.strip()]
        if not lines:
            raise ValueError("empty response")
        parsed = json.loads(lines[-1])
        if not isinstance(parsed, dict):
            raise ValueError("response is not an object")
        return parsed

    def _result_from_response(self, response: dict, output: str = "", stderr: str = "") -> BackendResult:
        if not isinstance(response, dict):
            return BackendResult(False, -1, "native helper response is not an object", output=output, stderr=stderr)
        raw_errors = response.get("errors")
        errors = []
        if isinstance(raw_errors, list):
            for item in raw_errors:
                if isinstance(item, dict):
                    errors.append({
                        "path": str(item.get("path", ""))[:1024],
                        "code": self._safe_int(item.get("code", 0), 0),
                        "message": str(item.get("message", ""))[:2048],
                    })
                elif item is not None:
                    errors.append({"path": "", "code": 0, "message": str(item)[:2048]})
        stats = response.get("stats")
        response_code = self._safe_code(response.get("code", 1), 1)
        ok_value = response.get("ok")
        if isinstance(ok_value, bool):
            ok = ok_value
        elif isinstance(ok_value, str):
            ok = ok_value.strip().casefold() in {"1", "true", "yes", "ok"}
        elif ok_value is None:
            ok = response_code == 0
        else:
            ok = bool(ok_value)
        return BackendResult(
            ok=(ok if response_code == 0 else False),
            code=response_code,
            message=str(response.get("message", ""))[:2048],
            processed=self._safe_int(response.get("processed", 0), 0),
            changed=self._safe_int(response.get("changed", 0), 0),
            skipped=self._safe_int(response.get("skipped", 0), 0),
            failed=self._safe_int(response.get("failed", len(errors)), len(errors)),
            errors=errors,
            stats=self._stats_to_mod_info(stats) if isinstance(stats, dict) else None,
            output=output,
            stderr=stderr,
        )

    @staticmethod
    def _safe_int(value: Any, default: int = 0) -> int:
        return _coerce_int(value, default, minimum=0)

    @staticmethod
    def _safe_code(value: Any, default: int = 1) -> int:
        return _coerce_int(value, default, minimum=None)

    @staticmethod
    def _safe_float(value: Any, default: float = 1.0) -> float:
        return _coerce_float(value, default, minimum=0.0)

    @staticmethod
    def _value(data: dict, camel: str, snake: str, default: Any = 0) -> Any:
        if camel in data:
            return data[camel]
        return data.get(snake, default)

    def _stats_to_mod_info(self, stats: dict) -> ModInfo:
        info = ModInfo(
            file_count=self._safe_int(self._value(stats, "fileCount", "file_count", 0)),
            total_size=self._safe_int(self._value(stats, "totalSize", "total_size", 0)),
            disk_size=self._safe_int(self._value(stats, "diskSize", "disk_size", 0)),
            compressed=_coerce_bool(stats.get("compressed", False)),
            ratio=self._safe_float(stats.get("ratio", 1.0), 1.0),
            algorithm=str(stats.get("algorithm", "") or ""),
            sound_size=self._safe_int(self._value(stats, "soundSize", "sound_size", 0)),
            texture_size=self._safe_int(self._value(stats, "textureSize", "texture_size", 0)),
            mesh_size=self._safe_int(self._value(stats, "meshSize", "mesh_size", 0)),
            lod_size=self._safe_int(self._value(stats, "lodSize", "lod_size", 0)),
            animation_size=self._safe_int(self._value(stats, "animationSize", "animation_size", 0)),
            other_size=self._safe_int(self._value(stats, "otherSize", "other_size", 0)),
            skipped_files=self._safe_int(self._value(stats, "skippedFiles", "skipped_files", 0)),
        )
        info.compressed_by_attr = self._safe_int(self._value(stats, "compressedByAttr", "compressed_by_attr", 0))
        info.compressed_by_size = self._safe_int(self._value(stats, "compressedBySize", "compressed_by_size", 0))
        info.compressed_by_wof = self._safe_int(self._value(stats, "compressedByWof", "compressed_by_wof", 0))
        return info

    def probe(self) -> BackendResult:
        if self._probed:
            return BackendResult(self._available, 0 if self._available else -2, self.version)
        self._probed = True
        result = self._request({"command": "probe"}, timeout=30)
        version = ""
        algorithms: Set[str] = set()
        if result.output:
            try:
                response = self._parse_response(result.output)
                version = str(response.get("version", "") or "")
                raw_algorithms = response.get("algorithms")
                if isinstance(raw_algorithms, list):
                    algorithms = {str(item).casefold() for item in raw_algorithms}
            except (ValueError, TypeError, json.JSONDecodeError):
                version = ""
        self.version = version
        if not result.ok or version != self.PROTOCOL_VERSION:
            self._available = False
            result.ok = False
            result.code = -3
            result.message = f"unsupported native helper protocol {version or 'missing'}"
        elif not self.SUPPORTED_ALGORITHMS.issubset(algorithms):
            self._available = False
            result.ok = False
            result.code = -4
            result.message = "native helper did not advertise all supported algorithms"
        return result

    def _run_progress_operation(
        self,
        command: str,
        paths: List[str],
        payload_extra: Dict[str, Any],
        progress_callback: Optional[Callable[[int, int, str], None]],
    ) -> BackendResult:
        """Run an operation in observable checkpoints when progress is requested.

        The helper protocol remains one request/one response.  Batching is
        therefore a UI-only checkpoint mechanism: callers that do not request
        progress retain the historical single request and its throughput.
        """
        if not paths:
            return BackendResult(True, 0, "no files")

        if progress_callback is None:
            payload = {"command": command, "paths": list(paths), "explicit": True}
            payload.update(payload_extra)
            return self._request(payload)

        total = len(paths)
        completed = 0
        code = 0
        ok = True
        processed = changed = skipped = failed = 0
        messages: List[str] = []
        errors: List[dict] = []
        outputs: List[str] = []
        stderr: List[str] = []

        for batch in _iter_compact_query_batches(paths, max_files=OPERATION_BATCH_SIZE):
            if self._cancelled:
                return BackendResult(
                    False,
                    -1,
                    "Cancelled",
                    processed=processed,
                    changed=changed,
                    skipped=skipped,
                    failed=failed,
                    errors=errors,
                    output="\n".join(outputs),
                    stderr="\n".join(stderr),
                )

            payload = {"command": command, "paths": list(batch), "explicit": True}
            payload.update(payload_extra)
            result = self._request(payload)
            ok = ok and result.ok
            if not result.ok and code == 0:
                code = result.code or 1
            processed += max(0, int(result.processed or 0))
            changed += max(0, int(result.changed or 0))
            skipped += max(0, int(result.skipped or 0))
            failed += max(0, int(result.failed or 0))
            if result.message:
                messages.append(str(result.message))
            errors.extend(result.errors[:20 - len(errors)])
            if result.output:
                outputs.append(result.output)
            if result.stderr:
                stderr.append(result.stderr)

            completed += len(batch)
            _report_progress(progress_callback, completed, total, batch[-1] if batch else "")

        return BackendResult(
            ok=ok,
            code=0 if ok else (code or 1),
            message=("; ".join(messages[-3:]) if messages else ("completed" if ok else "operation failed")),
            processed=processed,
            changed=changed,
            skipped=skipped,
            failed=failed,
            errors=errors,
            output="\n".join(outputs),
            stderr="\n".join(stderr),
        )

    def compress(
        self,
        paths: List[str],
        algorithm: str,
        threads: int = 0,
        progress_callback: Optional[Callable[[int, int, str], None]] = None,
    ) -> BackendResult:
        return self._run_progress_operation(
            "compress",
            paths,
            {
                "algorithm": str(algorithm),
                "threads": int(threads) if threads else None,
            },
            progress_callback,
        )

    def decompress(
        self,
        paths: List[str],
        threads: int = 0,
        progress_callback: Optional[Callable[[int, int, str], None]] = None,
    ) -> BackendResult:
        return self._run_progress_operation(
            "decompress",
            paths,
            {"threads": int(threads) if threads else None},
            progress_callback,
        )

    def measure(self, paths: List[str]) -> BackendResult:
        if not paths:
            return BackendResult(True, 0, "no files", stats=ModInfo())
        return self._request({"command": "measure", "paths": list(paths), "explicit": True})

    def cancel(self) -> None:
        self._cancelled = True
        process = self._process
        if not process:
            return
        try:
            process.terminate()
            process.wait(timeout=3)
        except Exception:
            try:
                process.kill()
                process.wait(timeout=3)
            except Exception:
                pass

    def reset_cancel(self) -> None:
        self._cancelled = False


# ---- Worker ----
class CompressionWorker(QtCore.QObject):
    log = QtCore.pyqtSignal(str)
    progress = QtCore.pyqtSignal(int, int, str)
    backend = QtCore.pyqtSignal(str)
    finished = QtCore.pyqtSignal(bool, str, dict)
    
    def __init__(self, organizer, state_data: Dict[str, dict],
                 mod_names: List[str], mode: str,
                 targets: List[TargetType], algorithm: str,
                 threads: int = 0):
        super().__init__()
        self._organizer = organizer
        self._state_data = copy.deepcopy(state_data)
        self._mod_names = list(mod_names)
        self._mode = mode
        self._targets = targets
        self._algorithm = algorithm
        self._threads = max(0, int(threads or 0))
        self._cancelled = False
        self._runner: Optional[CompactRunner] = None
        self._native: Optional[NativeHelperRunner] = None
        self._backend_name = "compact"
        self._finished_emitted = False
    
    def cancel(self) -> None:
        self._cancelled = True
        if self._runner:
            self._runner.cancel()
        if self._native:
            self._native.cancel()
    
    def _measure_workload(self, workload: ModWorkload) -> ModInfo:
        """Measure the same managed root or origin-verified files after an operation."""
        if self._native and self._backend_name == "native":
            if workload.is_foreign:
                measure_paths = list(workload.scan_files)
            else:
                full_workload = ModWorkload(
                    root=workload.root,
                    operation_items=[workload.root],
                    is_foreign=False,
                )
                measure_paths = _collect_workload_file_paths(full_workload)
            measured = self._native.measure(measure_paths)
            if measured.ok and measured.stats is not None:
                measured.stats.scanned_at = _now_iso()
                return measured.stats
            if measured.message:
                self.log.emit(f"  [WARN] measurement fallback: {measured.message}")
        return _scan_mod_workload(workload)

    def _measure_paths(self, paths: List[str]) -> ModInfo:
        """Measure an explicit, already-authorized operation scope."""
        if self._native and self._backend_name == "native":
            measured = self._native.measure(paths)
            if measured.ok and measured.stats is not None:
                measured.stats.scanned_at = _now_iso()
                return measured.stats
            if measured.message:
                self.log.emit(f"  [WARN] measurement fallback: {measured.message}")
        return _scan_file_paths(paths)

    @staticmethod
    def _invoke_backend(
        method,
        args: Tuple[Any, ...],
        progress_callback: Optional[Callable[[int, int, str], None]] = None,
    ) -> BackendResult:
        """Call current and legacy test/back-end implementations safely."""
        if progress_callback is None:
            return method(*args)
        try:
            return method(*args, progress_callback=progress_callback)
        except TypeError as exc:
            # Third-party/fake runners from older plugin builds do not accept
            # the optional keyword.  Preserve compatibility, but never hide a
            # different TypeError raised by the backend itself.
            if "progress_callback" not in str(exc):
                raise
            return method(*args)

    def _run_backend(
        self,
        paths: List[str],
        progress_callback: Optional[Callable[[int, int, str], None]] = None,
    ) -> BackendResult:
        if self._backend_name == "native" and self._native:
            if self._mode == "compress":
                return self._invoke_backend(
                    self._native.compress,
                    (paths, self._algorithm, self._threads),
                    progress_callback,
                )
            return self._invoke_backend(
                self._native.decompress,
                (paths, self._threads),
                progress_callback,
            )

        if not self._runner:
            return BackendResult(False, -1, "compact runner unavailable")
        if self._mode == "compress":
            return self._invoke_backend(
                self._runner.compress_paths,
                (paths, self._algorithm),
                progress_callback,
            )
        return self._invoke_backend(
            self._runner.decompress_paths,
            (paths,),
            progress_callback,
        )

    def _log_backend_errors(self, result: BackendResult) -> None:
        for item in result.errors[:5]:
            if isinstance(item, dict):
                path = str(item.get("path", ""))
                message = str(item.get("message", ""))
                code = item.get("code", "")
                self.log.emit(f"  [ERR] {path}: code={code} {message[:160]}")
            else:
                self.log.emit(f"  [ERR] {str(item)[:200]}")
        if len(result.errors) > 5:
            self.log.emit(f"  [ERR] ... {len(result.errors) - 5} more error(s)")
    
    @QtCore.pyqtSlot()
    def run(self) -> None:
        """Run the job and always return a terminal signal to the dialog."""
        try:
            self._run_impl()
        except Exception as exc:
            if self._runner:
                self._runner.cancel()
            if self._native:
                self._native.cancel()
            if not self._finished_emitted:
                summary = f"Worker failed: {type(exc).__name__}: {str(exc)[:240]}"
                self.log.emit(f"[ERR] {summary}")
                self._finished_emitted = True
                self.finished.emit(False, summary, self._state_data)

    def _run_impl(self) -> None:
        t0 = time.time()
        success = 0
        errors = 0
        skipped = 0
        total = len(self._mod_names)
        
        self._runner = CompactRunner()
        self._native = NativeHelperRunner()
        probe = self._native.probe()
        if probe.ok:
            self._backend_name = "native"
            self.backend.emit(
                f"Native helper {self._native.version or NativeHelperRunner.PROTOCOL_VERSION}"
            )
            self.log.emit(
                f"Backend: native WOF helper {self._native.version or NativeHelperRunner.PROTOCOL_VERSION}"
            )
        else:
            self._backend_name = "compact"
            reason = probe.message or "helper unavailable"
            self.backend.emit("compact.exe fallback")
            self.log.emit(f"Backend: compact.exe fallback ({reason})")
        
        action = "Compression" if self._mode == "compress" else "Decompression"
        self.log.emit(f"{'='*50}")
        self.log.emit(f"{action}: {total} mods")
        if self._mode == "compress":
            self.log.emit(f"Algorithm: {self._algorithm}")
        self.log.emit(f"Threads: {'auto' if self._threads <= 0 else self._threads}")
        
        target_strs = [TARGET_NAMES.get(t, str(t)) for t in self._targets]
        self.log.emit(f"Targets: {', '.join(target_strs)}")
        self.log.emit(f"{'='*50}")

        # Resolve the operation scope once up front.  The progress denominator
        # is the number of explicit files plus one post-operation measurement
        # checkpoint per mod, so a one-mod job no longer appears complete at
        # its first signal.
        jobs = []
        total_units = 0
        for name in self._mod_names:
            workload = _resolve_mod_workload(self._organizer, name, self._targets)
            path = workload.root
            paths: List[str] = []
            if path and os.path.isdir(path):
                paths = _collect_workload_file_paths(
                    workload, for_compression=self._mode == "compress"
                )
            units = max(1, len(paths) + (1 if paths else 0))
            jobs.append((name, workload, path, paths, units))
            total_units += units
        total_units = max(1, total_units)
        completed_units = 0
        self.progress.emit(0, total_units, "Preparing operation")

        for name, workload, path, paths, units in jobs:
            if self._cancelled:
                self.log.emit(">>> Cancelled by user")
                break

            base_done = completed_units
            self.progress.emit(base_done, total_units, f"{name}: preparing")
            if not path or not os.path.isdir(path):
                self.log.emit(f"[ERR] {name}: path not found")
                errors += 1
                completed_units += units
                self.progress.emit(completed_units, total_units, f"{name}: path not found")
                continue

            if not paths:
                if workload.is_foreign:
                    self.log.emit(f"[SKIP] {name}: no matching files found")
                else:
                    self.log.emit(f"[SKIP] {name}: no eligible target files found")
                skipped += 1
                completed_units += units
                self.progress.emit(completed_units, total_units, f"{name}: no files")
                continue

            if workload.is_foreign:
                self.log.emit(f"  [INFO] {name}: unmanaged mod, processing {len(paths)} file(s)")

            if self._cancelled:
                break

            operation_units = max(1, units - 1)
            last_report = [0.0]

            def report_progress(
                local_done: int,
                local_total: int,
                label: str,
                current_name: str = name,
                current_base: int = base_done,
                current_units: int = operation_units,
            ) -> None:
                try:
                    bounded_total = max(1, int(local_total or current_units))
                    bounded_done = max(0, min(int(local_done or 0), bounded_total))
                except (TypeError, ValueError):
                    bounded_total = current_units
                    bounded_done = 0
                value = current_base + min(current_units, bounded_done)
                now = time.monotonic()
                if value >= current_base + current_units or now - last_report[0] >= 0.05:
                    last_report[0] = now
                    self.progress.emit(
                        value,
                        total_units,
                        f"{current_name}: {os.path.basename(str(label)) or 'processing'}",
                    )

            self.progress.emit(base_done, total_units, f"{name}: 0/{len(paths)} files")
            result = self._run_backend(paths, progress_callback=report_progress)
            if self._cancelled:
                # Keep a measured snapshot of work completed before cancel;
                # do not report the in-flight mod as a successful operation.
                self._state_data[name] = self._measure_workload(workload).to_dict()
                break
            if not result.ok:
                self.log.emit(f"[ERR] {name}: {result.message or 'operation failed'}")
                self._log_backend_errors(result)
                self.progress.emit(
                    base_done + operation_units,
                    total_units,
                    f"{name}: measuring",
                )
                info = self._measure_workload(workload)
                self._state_data[name] = info.to_dict()
                errors += 1
                completed_units += units
                self.progress.emit(completed_units, total_units, f"{name}: failed")
                continue

            self.log.emit(
                f"  [{'C' if self._mode == 'compress' else 'U'}] "
                f"{result.changed or result.processed} file(s), skipped={result.skipped}"
            )
            self.progress.emit(
                base_done + operation_units,
                total_units,
                f"{name}: measuring",
            )
            info = self._measure_workload(workload)
            old_info = ModInfo.from_dict(self._state_data.get(name, {}))

            if self._mode == "compress":
                # The post-operation measurement is authoritative.  Retain the
                # requested algorithm only when the measured state shows WOF or
                # NTFS evidence; never claim success from intent alone.
                if info.compressed:
                    has_transparent_evidence = (
                        info.compressed_by_wof > 0 or info.compressed_by_attr > 0
                    )
                    if has_transparent_evidence:
                        info.algorithm = info.algorithm or old_info.algorithm or self._algorithm
                        info.compressed_at = _now_iso()
                    elif old_info.compressed:
                        info.algorithm = old_info.algorithm
                        info.compressed_at = old_info.compressed_at
                else:
                    info.algorithm = ""
                    info.compressed_at = ""
                saved = max(0, info.total_size - info.disk_size)
                self.log.emit(f"[OK] {name}: {info.ratio:.2f}x, saved {_format_size(saved)}")
                success += 1
            else:
                # Decompression is successful only when the post-operation
                # measurement has no remaining WOF or NTFS evidence.  A size
                # ratio alone is not proof of transparent compression.
                scope_info = self._measure_paths(paths)
                remaining_evidence = (
                    scope_info.compressed_by_wof > 0 or scope_info.compressed_by_attr > 0
                )
                if remaining_evidence:
                    if old_info.algorithm:
                        info.algorithm = old_info.algorithm
                    info.compressed = True
                    self.log.emit(
                        f"[ERR] {name}: WOF/NTFS compression remains "
                        f"(wof={scope_info.compressed_by_wof}, ntfs={scope_info.compressed_by_attr})"
                    )
                    errors += 1
                else:
                    if not info.compressed:
                        info.algorithm = ""
                        info.compressed_at = ""
                    elif old_info.algorithm and not info.algorithm:
                        info.algorithm = old_info.algorithm
                    self.log.emit(f"[OK] {name}: decompressed (ratio: {info.ratio:.2f})")
                    success += 1
            self._state_data[name] = info.to_dict()
            completed_units += units
            self.progress.emit(completed_units, total_units, f"{name}: complete")
        
        dt = time.time() - t0
        self.log.emit(f"{'='*50}")
        cancelled = self._cancelled
        summary = f"Completed in {dt:.1f}s | Success: {success} | Errors: {errors} | Skipped: {skipped}"
        if cancelled:
            summary += " | Cancelled"
        self.log.emit(summary)
        
        self._finished_emitted = True
        self.finished.emit(errors == 0 and not cancelled, summary, self._state_data)


# ---- Dialog ----
class ModCompressorDialog(QtWidgets.QDialog):
    def __init__(self, parent, organizer, state_manager: StateManager):
        super().__init__(parent)
        self.setWindowTitle("Mod Compressor v4.0.3")
        self.resize(1100, 800)
        
        self._organizer = organizer
        self._state = state_manager
        self._mods: List[Dict[str, Any]] = []
        self._checked_names: Set[str] = set()
        self._updating_table = False
        self._mod_list_ok = False
        self._mod_signature = None
        self._scan_in_progress = False
        self._worker: Optional[CompressionWorker] = None
        self._thread: Optional[QtCore.QThread] = None
        self._elapsed_seconds = 0
        self._timer = QtCore.QTimer(self)
        self._timer.setInterval(1000)
        self._timer.timeout.connect(self._on_timer_tick)
        self._refresh_timer = QtCore.QTimer(self)
        self._refresh_timer.setInterval(2000)
        self._refresh_timer.timeout.connect(self._refresh_if_changed)
        self._operation_started = False
        
        self._build_ui()
        self._load_options()
        self._load_mods()
        self._apply_filter()
        self._refresh_timer.start()
    
    def closeEvent(self, event):
        self._save_options()
        self._refresh_timer.stop()
        self._cancel_job()
        if self._thread and self._thread.isRunning():
            # Stop the worker event loop after the backend process has been
            # terminated so closing the dialog cannot leave a child behind.
            self._thread.quit()
            if self._thread.wait(5000):
                self._thread = None
                self._worker = None
        super().closeEvent(event)
    
    def _build_ui(self):
        layout = QtWidgets.QVBoxLayout(self)
        
        # Stats bar
        stats_layout = QtWidgets.QHBoxLayout()
        self.lblStats = QtWidgets.QLabel("Loading...")
        self.lblStats.setStyleSheet("color: #666; font-size: 11px;")
        stats_layout.addWidget(self.lblStats)
        stats_layout.addStretch()
        self.lblSelected = QtWidgets.QLabel("Selected: 0")
        self.lblSelected.setStyleSheet("color: #4CAF50; font-weight: bold; font-size: 11px;")
        stats_layout.addWidget(self.lblSelected)
        self.lblBackend = QtWidgets.QLabel("Backend: probing on run")
        self.lblBackend.setStyleSheet("color: #888; font-size: 11px;")
        stats_layout.addWidget(self.lblBackend)
        self.lblTimer = QtWidgets.QLabel("")
        self.lblTimer.setStyleSheet("color: #888; font-size: 11px; font-family: Consolas;")
        stats_layout.addWidget(self.lblTimer)
        layout.addLayout(stats_layout)
        
        # Filters
        filter_box = QtWidgets.QHBoxLayout()
        
        self.chkActive = QtWidgets.QCheckBox("Active only")
        self.chkActive.stateChanged.connect(self._apply_filter)
        
        self.chkCompressed = QtWidgets.QCheckBox("Compressed")
        self.chkCompressed.stateChanged.connect(self._apply_filter)
        
        self.chkUncompressed = QtWidgets.QCheckBox("Uncompressed")
        self.chkUncompressed.stateChanged.connect(self._apply_filter)
        
        self.chkHasLOD = QtWidgets.QCheckBox("Has LOD content")
        self.chkHasLOD.stateChanged.connect(self._apply_filter)
        
        self.editSearch = QtWidgets.QLineEdit()
        self.editSearch.setPlaceholderText("Search mods...")
        self.editSearch.setClearButtonEnabled(True)
        self.editSearch.textChanged.connect(self._apply_filter)
        
        filter_box.addWidget(self.chkActive)
        filter_box.addWidget(self.chkCompressed)
        filter_box.addWidget(self.chkUncompressed)
        filter_box.addWidget(self.chkHasLOD)
        filter_box.addStretch()
        filter_box.addWidget(self.editSearch, 1)
        layout.addLayout(filter_box)
        
        # Table
        self.table = QtWidgets.QTableWidget()
        self.table.setColumnCount(7)
        self.table.setHorizontalHeaderLabels([
            "✓", "Mod", "Active", "Status", "Ratio", "Size", "Saved"
        ])
        
        hdr = self.table.horizontalHeader()
        hdr.setSectionResizeMode(0, RESIZE_TO_CONTENTS)
        hdr.setSectionResizeMode(1, INTERACTIVE)
        hdr.setSectionResizeMode(2, RESIZE_TO_CONTENTS)
        hdr.setSectionResizeMode(3, INTERACTIVE)
        hdr.setSectionResizeMode(4, RESIZE_TO_CONTENTS)
        hdr.setSectionResizeMode(5, INTERACTIVE)
        hdr.setSectionResizeMode(6, INTERACTIVE)
        self.table.setColumnWidth(1, 360)
        self.table.setColumnWidth(3, 140)
        self.table.setColumnWidth(5, 110)
        self.table.setColumnWidth(6, 110)
        
        self.table.setSelectionBehavior(SELECT_ROWS)
        self.table.setEditTriggers(NO_EDIT)
        self.table.verticalHeader().setVisible(False)
        self.table.setAlternatingRowColors(True)
        self.table.setSortingEnabled(True)
        self.table.itemChanged.connect(self._on_table_item_changed)
        layout.addWidget(self.table, 3)
        
        # Options
        opts = QtWidgets.QGroupBox("Compression Options")
        opts_layout = QtWidgets.QHBoxLayout(opts)
        
        opts_layout.addWidget(QtWidgets.QLabel("Targets:"))
        
        self.chkTextures = QtWidgets.QCheckBox("Textures")
        self.chkTextures.setChecked(True)
        self.chkTextures.setToolTip("Compress textures folder (.dds, .tga, etc.)")
        self.chkTextures.stateChanged.connect(self._save_options)
        
        self.chkMeshes = QtWidgets.QCheckBox("Meshes")
        self.chkMeshes.setChecked(True)
        self.chkMeshes.setToolTip("Compress meshes folder (.nif, .tri, etc.)")
        self.chkMeshes.stateChanged.connect(self._save_options)
        
        self.chkSounds = QtWidgets.QCheckBox("Sounds")
        self.chkSounds.setToolTip("Compress sound/music folders (.wav, .xwm, etc.)")
        self.chkSounds.stateChanged.connect(self._save_options)
        
        self.chkLOD = QtWidgets.QCheckBox("LOD/DynDOLOD")
        self.chkLOD.setChecked(True)
        self.chkLOD.setToolTip("Compress LOD folders (DynDOLOD, xLODGen, TexGen, terrain, grass, etc.)")
        self.chkLOD.setStyleSheet("font-weight: bold;")
        self.chkLOD.stateChanged.connect(self._save_options)
        
        self.chkAnimations = QtWidgets.QCheckBox("Animations")
        self.chkAnimations.setToolTip("Compress animation folders (.hkx, OAR, DAR, Nemesis, Pandora)")
        self.chkAnimations.stateChanged.connect(self._save_options)
        
        self.chkAll = QtWidgets.QCheckBox("Entire mod")
        self.chkAll.setToolTip("Compress everything in the mod folder")
        self.chkAll.stateChanged.connect(self._on_entire_mod_toggled)
        self.chkAll.stateChanged.connect(self._save_options)
        
        opts_layout.addWidget(self.chkTextures)
        opts_layout.addWidget(self.chkMeshes)
        opts_layout.addWidget(self.chkSounds)
        opts_layout.addWidget(self.chkLOD)
        opts_layout.addWidget(self.chkAnimations)
        opts_layout.addWidget(self.chkAll)
        
        opts_layout.addSpacing(20)
        opts_layout.addWidget(QtWidgets.QLabel("Algorithm:"))
        
        self.cmbAlgo = QtWidgets.QComboBox()
        for k, v in COMPRESSION_ALGORITHMS.items():
            self.cmbAlgo.addItem(v, k)
        self.cmbAlgo.setCurrentIndex(1)  # xpress8k
        self.cmbAlgo.setToolTip("LZX = max compression, slower\nXPRESS = faster, less compression")
        self.cmbAlgo.currentIndexChanged.connect(self._save_options)
        opts_layout.addWidget(self.cmbAlgo)

        opts_layout.addWidget(QtWidgets.QLabel("Threads:"))
        self.spinThreads = QtWidgets.QSpinBox()
        self.spinThreads.setRange(0, 16)
        self.spinThreads.setValue(0)
        self.spinThreads.setSpecialValueText("Auto")
        self.spinThreads.setToolTip("Native helper worker threads; 0 uses the helper default")
        self.spinThreads.valueChanged.connect(self._save_options)
        opts_layout.addWidget(self.spinThreads)
        
        opts_layout.addStretch()
        layout.addWidget(opts)
        
        # Selection buttons
        sel_box = QtWidgets.QHBoxLayout()
        
        self.btnSelectAll = QtWidgets.QPushButton("Select all")
        self.btnSelectAll.clicked.connect(lambda: self._select_all(True))
        
        self.btnSelectNone = QtWidgets.QPushButton("Clear")
        self.btnSelectNone.clicked.connect(lambda: self._select_all(False))
        
        self.btnSelectCompressed = QtWidgets.QPushButton("Select compressed")
        self.btnSelectCompressed.clicked.connect(self._select_compressed)
        
        self.btnSelectUncompressed = QtWidgets.QPushButton("Select uncompressed")
        self.btnSelectUncompressed.clicked.connect(self._select_uncompressed)
        
        self.btnSelectLOD = QtWidgets.QPushButton("Select LOD mods")
        self.btnSelectLOD.clicked.connect(self._select_lod_mods)
        self.btnSelectLOD.setStyleSheet("font-weight: bold;")
        
        self.btnScan = QtWidgets.QPushButton("🔍 Scan selected")
        self.btnScan.clicked.connect(self._scan_selected)
        
        self.btnScanAll = QtWidgets.QPushButton("🔍 Scan all")
        self.btnScanAll.clicked.connect(self._scan_all)
        
        sel_box.addWidget(self.btnSelectAll)
        sel_box.addWidget(self.btnSelectNone)
        sel_box.addWidget(self.btnSelectCompressed)
        sel_box.addWidget(self.btnSelectUncompressed)
        sel_box.addWidget(self.btnSelectLOD)
        sel_box.addStretch()
        sel_box.addWidget(self.btnScan)
        sel_box.addWidget(self.btnScanAll)
        layout.addLayout(sel_box)
        
        # Progress and actions
        action_box = QtWidgets.QHBoxLayout()
        
        self.progress = QtWidgets.QProgressBar()
        self.progress.setMinimum(0)
        self.progress.setValue(0)
        self.progress.setTextVisible(True)
        
        self.btnCompress = QtWidgets.QPushButton("📦 Compress")
        self.btnCompress.setStyleSheet("background-color: #4CAF50; color: white; font-weight: bold; padding: 8px 16px;")
        self.btnCompress.clicked.connect(lambda: self._run_job("compress"))
        
        self.btnDecompress = QtWidgets.QPushButton("📂 Decompress")
        self.btnDecompress.setStyleSheet("background-color: #2196F3; color: white; font-weight: bold; padding: 8px 16px;")
        self.btnDecompress.clicked.connect(lambda: self._run_job("decompress"))
        
        self.btnCancel = QtWidgets.QPushButton("⏹ Cancel")
        self.btnCancel.clicked.connect(self._cancel_job)
        self.btnCancel.setEnabled(False)
        
        self.btnClose = QtWidgets.QPushButton("Close")
        self.btnClose.clicked.connect(self.close)
        
        action_box.addWidget(self.progress, 2)
        action_box.addWidget(self.btnCompress)
        action_box.addWidget(self.btnDecompress)
        action_box.addWidget(self.btnCancel)
        action_box.addWidget(self.btnClose)
        layout.addLayout(action_box)
        
        # Log
        self.log = QtWidgets.QPlainTextEdit()
        self.log.setReadOnly(True)
        self.log.setMaximumBlockCount(3000)
        self.log.setMaximumHeight(200)
        self.log.setFont(QtGui.QFont("Consolas", 9))
        layout.addWidget(self.log, 1)
        
        self.status = QtWidgets.QLabel("Ready")
        layout.addWidget(self.status)
    
    def _on_timer_tick(self):
        self._elapsed_seconds += 1
        m = self._elapsed_seconds // 60
        s = self._elapsed_seconds % 60
        self.lblTimer.setText(f"Elapsed: {m:02d}:{s:02d}")
    
    def _on_entire_mod_toggled(self, state):
        """Disable other checkboxes when 'Entire mod' is checked"""
        enabled = state != CHECKED
        self.chkTextures.setEnabled(enabled)
        self.chkMeshes.setEnabled(enabled)
        self.chkSounds.setEnabled(enabled)
        self.chkLOD.setEnabled(enabled)
        self.chkAnimations.setEnabled(enabled)
    
    def _log(self, msg: str):
        """Append to the log (newest at top)"""
        self.log.setPlainText(msg + "\n" + self.log.toPlainText())
    
    def _get_mod_list(self) -> List[str]:
        self._mod_list_ok = False
        try:
            ml = self._organizer.modList()
            for attr in ("allMods", "modNames"):
                if hasattr(ml, attr):
                    names = [str(x) for x in getattr(ml, attr)()]
                    self._mod_list_ok = True
                    return names
        except:
            pass
        return []
    
    def _is_mod_active(self, name: str) -> bool:
        try:
            st = self._organizer.modList().state(name)
            return bool(st & MOD_STATE_ACTIVE)
        except:
            return True
    
    def _get_mod_path(self, name: str) -> str:
        return _get_mod_path_from_organizer(self._organizer, name)
    
    def _load_mods(self):
        self._mods = []
        total_size = 0
        total_saved = 0
        compressed_count = 0
        source_paths_changed = False
        names = self._get_mod_list()
        if self._mod_list_ok:
            removed = self._state.prune(set(names))
            if removed:
                self._state.save()
                self._log(f"Pruned {removed} stale state entr{'y' if removed == 1 else 'ies'}")
            old_selection_count = len(self._checked_names)
            self._checked_names.intersection_update(names)
            pruned_selection_count = old_selection_count - len(self._checked_names)
            if pruned_selection_count:
                self._log(f"Pruned {pruned_selection_count} stale selection(s)")

        for name in names:
            path = self._get_mod_path(name)
            if not path:
                continue
            
            info = self._state.get(name)
            normalized_path = os.path.abspath(os.path.normpath(path))
            previous_path = info.source_path
            if previous_path:
                try:
                    previous_key = os.path.normcase(
                        os.path.abspath(os.path.normpath(previous_path))
                    )
                except (TypeError, ValueError):
                    previous_key = ""
            else:
                previous_key = ""
            if previous_key and previous_key != os.path.normcase(normalized_path):
                self._log(f"Path changed for {name}; refreshing source identity")
            if previous_key != os.path.normcase(normalized_path):
                info.source_path = normalized_path
                source_paths_changed = True
            self._mods.append({
                "name": name,
                "active": self._is_mod_active(name),
                "path": path,
                "info": info
            })
            
            total_size += info.total_size
            if info.compressed and info.disk_size > 0:
                total_saved += info.total_size - info.disk_size
                compressed_count += 1

            if source_paths_changed:
                self._state.set(name, info)

        if source_paths_changed and self._mod_list_ok:
            self._state.save()
        
        self.lblStats.setText(
            f"Mods: {len(self._mods)} | "
            f"Compressed: {compressed_count} | "
            f"Total size: {_format_size(total_size)} | "
            f"Space saved: {_format_size(total_saved)}"
        )
        self._log(f"Loaded: {len(self._mods)} mods")
        self._mod_signature = self._current_mod_signature()

    def _current_mod_signature(self):
        """Return a cheap mod-list/path/active signature for live refresh."""
        names = self._get_mod_list()
        if not self._mod_list_ok:
            return None
        signature = []
        for name in names:
            signature.append((name, self._get_mod_path(name), self._is_mod_active(name)))
        return tuple(signature)

    def _refresh_if_changed(self):
        if self._operation_started or self._scan_in_progress or self._thread is not None:
            return
        signature = self._current_mod_signature()
        if signature is None or signature == self._mod_signature:
            return
        self._capture_checked()
        self._load_mods()
        self._apply_filter()
        self._update_stats()
        self._log("Mod list changed; refreshed")
    
    def _has_lod_content(self, info: ModInfo) -> bool:
        """Check if mod has significant LOD content"""
        return info.lod_size > 256 * 1024  # > 256KB
    
    def _apply_filter(self):
        self._capture_checked()
        only_active = self.chkActive.isChecked()
        only_compressed = self.chkCompressed.isChecked()
        only_uncompressed = self.chkUncompressed.isChecked()
        only_lod = self.chkHasLOD.isChecked()
        query = self.editSearch.text().strip().lower()
        
        self._updating_table = True
        self.table.setSortingEnabled(False)
        self.table.setRowCount(0)
        
        visible_count = 0
        
        for mod in self._mods:
            info: ModInfo = mod["info"]
            
            if only_active and not mod["active"]:
                continue
            if query and query not in mod["name"].lower():
                continue
            if only_compressed and not info.compressed:
                continue
            if only_uncompressed and info.compressed:
                continue
            if only_lod and not self._has_lod_content(info):
                continue
            
            visible_count += 1
            row = self.table.rowCount()
            self.table.insertRow(row)
            
            # Checkbox
            chk = SortableTableWidgetItem()
            chk.setCheckState(CHECKED if mod["name"] in self._checked_names else UNCHECKED)
            chk.setData(MOD_NAME_ROLE, mod["name"])
            chk.setData(SORT_ROLE, mod["name"].casefold())
            self.table.setItem(row, 0, chk)
            
            # Name
            name_item = SortableTableWidgetItem(mod["name"])
            name_item.setData(SORT_ROLE, mod["name"].casefold())
            self.table.setItem(row, 1, name_item)
            
            # Active
            act = SortableTableWidgetItem("✓" if mod["active"] else "")
            act.setData(SORT_ROLE, 1 if mod["active"] else 0)
            act.setTextAlignment(ALIGN_CENTER)
            self.table.setItem(row, 2, act)
            
            # Status
            if info.compressed:
                status_txt = f"✓ {info.algorithm}" if info.algorithm else "✓ Compressed"
                status = SortableTableWidgetItem(status_txt)
                status.setData(SORT_ROLE, f"0:{status_txt.casefold()}")
                status.setForeground(QtGui.QColor("#4CAF50"))
            elif info.scanned_at:
                status = SortableTableWidgetItem("Not compressed")
                status.setData(SORT_ROLE, "1:not compressed")
            else:
                status = SortableTableWidgetItem("Not scanned")
                status.setData(SORT_ROLE, "2:not scanned")
                status.setForeground(QtGui.QColor("#999999"))
            status.setTextAlignment(ALIGN_CENTER)
            self.table.setItem(row, 3, status)
            
            # Ratio
            if info.ratio > 1.0:
                ratio_txt = f"{info.ratio:.2f}x"
                ratio_item = SortableTableWidgetItem(ratio_txt)
                ratio_item.setData(SORT_ROLE, info.ratio)
                if info.ratio > 1.5:
                    ratio_item.setForeground(QtGui.QColor("#4CAF50"))
                elif info.ratio > 1.2:
                    ratio_item.setForeground(QtGui.QColor("#8BC34A"))
            else:
                ratio_item = SortableTableWidgetItem("1.00x")
                ratio_item.setData(SORT_ROLE, 1.0)
            ratio_item.setTextAlignment(ALIGN_CENTER)
            self.table.setItem(row, 4, ratio_item)
            
            # Size
            size_item = SortableTableWidgetItem(
                _format_size(info.total_size) if info.total_size else "—"
            )
            size_item.setData(SORT_ROLE, info.total_size)
            size_item.setTextAlignment(ALIGN_RIGHT)
            self.table.setItem(row, 5, size_item)
            
            # Saved
            if info.total_size > info.disk_size and info.disk_size > 0:
                saved = info.total_size - info.disk_size
                sav_txt = f"-{_format_size(saved)}"
                sav = SortableTableWidgetItem(sav_txt)
                sav.setData(SORT_ROLE, saved)
                sav.setForeground(QtGui.QColor("#4CAF50"))
            else:
                sav = SortableTableWidgetItem("—")
                sav.setData(SORT_ROLE, 0)
            sav.setTextAlignment(ALIGN_RIGHT)
            self.table.setItem(row, 6, sav)
        
        self.table.setSortingEnabled(True)
        self._updating_table = False
        self._update_selected_count()
        self.status.setText(f"Showing {visible_count} of {len(self._mods)} mods")
        self._save_options()
    
    def _set_visible_checks(self, should_check) -> int:
        """Apply checkbox state to visible rows without re-entering the count scan."""
        was_updating = self._updating_table
        if not was_updating:
            self._capture_checked()
        self._updating_table = True
        signals_were_blocked = self.table.blockSignals(True)
        updates_were_enabled = self.table.updatesEnabled()
        self.table.setUpdatesEnabled(False)
        selected = 0
        try:
            for row in range(self.table.rowCount()):
                item = self.table.item(row, 0)
                if not item:
                    continue
                checked = bool(should_check(item))
                item.setCheckState(CHECKED if checked else UNCHECKED)
                if checked:
                    selected += 1
        finally:
            self._updating_table = was_updating
            self.table.setUpdatesEnabled(updates_were_enabled)
            self.table.blockSignals(signals_were_blocked)
        if not was_updating:
            self._capture_checked()
            self._update_selected_count()
        return selected

    def _select_all(self, checked: bool):
        self._set_visible_checks(lambda _item: checked)

    def _capture_checked(self):
        if self._updating_table or not hasattr(self, "table"):
            return
        for row in range(self.table.rowCount()):
            item = self.table.item(row, 0)
            if not item:
                continue
            name = item.data(MOD_NAME_ROLE)
            if not name:
                continue
            if item.checkState() == CHECKED:
                self._checked_names.add(str(name))
            else:
                self._checked_names.discard(str(name))

    def _on_table_item_changed(self, item):
        if self._updating_table or item.column() != 0:
            return
        name = item.data(MOD_NAME_ROLE)
        if name:
            if item.checkState() == CHECKED:
                self._checked_names.add(str(name))
            else:
                self._checked_names.discard(str(name))
        self._update_selected_count()
    
    def _select_compressed(self):
        """Select visible mods whose measured state is compressed."""
        by_name = {mod["name"]: mod["info"] for mod in self._mods}

        def is_compressed(chk):
            info = by_name.get(str(chk.data(MOD_NAME_ROLE)))
            return bool(info and info.compressed)

        self._set_visible_checks(is_compressed)
    
    def _select_uncompressed(self):
        """Select visible mods that are not marked compressed."""
        by_name = {mod["name"]: mod["info"] for mod in self._mods}

        def is_uncompressed(chk):
            info = by_name.get(str(chk.data(MOD_NAME_ROLE)))
            return bool(info and not info.compressed)

        self._set_visible_checks(is_uncompressed)
    
    def _select_lod_mods(self):
        """Select mods that contain LOD content using saved scan data"""
        by_name = {mod["name"]: mod["info"] for mod in self._mods}

        def has_lod(chk):
            info = by_name.get(str(chk.data(MOD_NAME_ROLE)))
            return bool(info and self._has_lod_content(info))

        selected = self._set_visible_checks(has_lod)
        self._log(f"Selected {selected} mods with LOD content")
    
    def _get_checked(self) -> List[str]:
        self._capture_checked()
        valid = {mod["name"] for mod in self._mods}
        self._checked_names.intersection_update(valid)
        return [mod["name"] for mod in self._mods if mod["name"] in self._checked_names]
    
    def _get_targets(self) -> List[TargetType]:
        if self.chkAll.isChecked():
            return [TargetType.ALL]
        
        targets = []
        if self.chkTextures.isChecked():
            targets.append(TargetType.TEXTURES)
        if self.chkMeshes.isChecked():
            targets.append(TargetType.MESHES)
        if self.chkSounds.isChecked():
            targets.append(TargetType.SOUNDS)
        if self.chkLOD.isChecked():
            targets.append(TargetType.LOD)
        if self.chkAnimations.isChecked():
            targets.append(TargetType.ANIMATIONS)
        return targets
    
    def _scan_mods(self, names: List[str], deep_scan: bool = False):
        if self._scan_in_progress or self._operation_started or self._thread is not None:
            return
        self._scan_in_progress = True
        try:
            self._scan_mods_impl(names, deep_scan)
        finally:
            self._scan_in_progress = False
            self._stop_timer()

    def _scan_mods_impl(self, names: List[str], deep_scan: bool = False):
        self._log(f"{'='*50}")
        self._log(f"Scanning: {len(names)} mods {'(deep)' if deep_scan else ''}")
        self._log(f"{'='*50}")

        # Resolve roots and count scanable files before the first scan starts.
        # A one-mod scan therefore gets a file-sized denominator instead of a
        # one-item denominator that fills the bar immediately.
        jobs = []
        total_units = 0
        for name in names:
            workload = _resolve_mod_workload(self._organizer, name, [TargetType.ALL])
            units = _scan_workload_progress_units(workload, deep_scan=deep_scan)
            jobs.append((name, workload, units))
            total_units += units
        total_units = max(1, total_units)
        self.progress.setMaximum(total_units)
        self.progress.setValue(0)
        self.progress.setFormat(f"0/{total_units}: preparing scan")
        self.status.setText("Preparing scan")
        QtWidgets.QApplication.processEvents()

        self._start_timer()

        completed_units = 0
        for name, workload, units in jobs:
            base_done = completed_units
            path = workload.root
            if not path:
                self._log(f"  [SKIP] {name}: path not found")
                completed_units += units
                self.progress.setValue(completed_units)
                self.progress.setFormat(f"{completed_units}/{total_units}: {name} (path not found)")
                self.status.setText(f"Scanning: {name} (path not found)")
                QtWidgets.QApplication.processEvents()
                continue

            last_update = [0.0]

            def report_progress(
                local_done: int,
                local_total: int,
                label: str,
                current_name: str = name,
                current_base: int = base_done,
                current_units: int = units,
            ) -> None:
                try:
                    bounded_total = max(1, int(local_total or current_units))
                    bounded_done = max(0, min(int(local_done or 0), bounded_total))
                except (TypeError, ValueError):
                    bounded_total = current_units
                    bounded_done = 0
                value = current_base + min(current_units, bounded_done)
                now = time.monotonic()
                if value >= current_base + current_units or now - last_update[0] >= 0.05:
                    last_update[0] = now
                    self.progress.setValue(value)
                    self.progress.setFormat(
                        f"{value}/{total_units}: {current_name}: "
                        f"{os.path.basename(str(label)) or 'scanning'}"
                    )
                    self.status.setText(f"Scanning: {current_name}")
                    QtWidgets.QApplication.processEvents()

            old_info = self._state.get(name)
            info = _scan_mod_workload(
                workload,
                use_compact_check=deep_scan,
                progress_callback=report_progress,
                progress_total=units,
            )

            # Empty/unreadable roots have no per-file callback.  Complete their
            # checkpoint explicitly so the next mod starts at the right offset.
            completed_units += units
            report_progress(units, units, "scan complete")
            
            # Preserve algorithm info if still compressed
            if info.compressed and old_info.algorithm and old_info.compressed:
                info.algorithm = old_info.algorithm
                info.compressed_at = old_info.compressed_at
            elif not info.compressed:
                info.algorithm = ""
                info.compressed_at = ""
            
            self._state.set(name, info)
            
            for mod in self._mods:
                if mod["name"] == name:
                    mod["info"] = info
                    break
            
            # Status line
            if info.compressed:
                status = f"compressed ({info.ratio:.2f}x)"
            else:
                status = "not compressed"
            
            self._log(f"  {name}: {status}, size={_format_size(info.total_size)}")
        
        self._stop_timer()
        self._state.save()
        self._apply_filter()
        self._update_stats()
        self.progress.setValue(0)
        self.progress.setFormat("")
        self.status.setText("Ready")
        self._log("Scan complete")
    
    def _update_stats(self):
        """Update statistics display"""
        total_size = 0
        total_saved = 0
        compressed_count = 0
        
        for mod in self._mods:
            info = mod["info"]
            total_size += info.total_size
            if info.compressed and info.disk_size > 0:
                total_saved += info.total_size - info.disk_size
                compressed_count += 1
        
        self.lblStats.setText(
            f"Mods: {len(self._mods)} | "
            f"Compressed: {compressed_count} | "
            f"Total size: {_format_size(total_size)} | "
            f"Space saved: {_format_size(total_saved)}"
        )
    
    def _update_selected_count(self):
        """Update the selected mods count label"""
        count = len(self._get_checked())
        self.lblSelected.setText(f"Selected: {count}")
    
    def _start_timer(self):
        self._elapsed_seconds = 0
        self._timer.start()
        self.lblTimer.setText("Elapsed: 00:00")
    
    def _stop_timer(self):
        self._timer.stop()
    
    def _options_path(self) -> str:
        base = ""
        try:
            base = str(self._organizer.pluginDataPath())
        except:
            try:
                base = str(self._organizer.profilePath())
            except:
                base = os.path.expanduser("~")
        return os.path.join(base, "mod_compressor", "ui_options.json")
    
    def _save_options(self):
        try:
            opts_path = self._options_path()
            os.makedirs(os.path.dirname(opts_path), exist_ok=True)
            data = {
                "active_only": self.chkActive.isChecked(),
                "compressed_only": self.chkCompressed.isChecked(),
                "uncompressed_only": self.chkUncompressed.isChecked(),
                "lod_only": self.chkHasLOD.isChecked(),
                "targets": {
                    "textures": self.chkTextures.isChecked(),
                    "meshes": self.chkMeshes.isChecked(),
                    "sounds": self.chkSounds.isChecked(),
                    "lod": self.chkLOD.isChecked(),
                    "animations": self.chkAnimations.isChecked(),
                },
                "entire_mod": self.chkAll.isChecked(),
                "algorithm": self.cmbAlgo.currentData(),
                "threads": self.spinThreads.value(),
            }
            with open(opts_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"mod-compressor: failed to save UI options: {e}")
    
    def _load_options(self):
        try:
            opts_path = self._options_path()
            if not os.path.exists(opts_path):
                return
            with open(opts_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.chkActive.setChecked(data.get("active_only", False))
            self.chkCompressed.setChecked(data.get("compressed_only", False))
            self.chkUncompressed.setChecked(data.get("uncompressed_only", False))
            self.chkHasLOD.setChecked(data.get("lod_only", False))
            targets = data.get("targets", {})
            self.chkTextures.setChecked(targets.get("textures", True))
            self.chkMeshes.setChecked(targets.get("meshes", True))
            self.chkSounds.setChecked(targets.get("sounds", False))
            self.chkLOD.setChecked(targets.get("lod", True))
            self.chkAnimations.setChecked(targets.get("animations", False))
            self.chkAll.setChecked(data.get("entire_mod", False))
            algo = data.get("algorithm")
            if algo:
                idx = self.cmbAlgo.findData(algo)
                if idx >= 0:
                    self.cmbAlgo.setCurrentIndex(idx)
            try:
                saved_threads = int(data.get("threads", 0) or 0)
            except (TypeError, ValueError, OverflowError):
                saved_threads = 0
            self.spinThreads.setValue(max(0, min(16, saved_threads)))
            self._on_entire_mod_toggled(CHECKED if data.get("entire_mod", False) else UNCHECKED)
        except Exception as e:
            print(f"mod-compressor: failed to load UI options: {e}")
    
    def _scan_selected(self):
        names = self._get_checked()
        if not names:
            QtWidgets.QMessageBox.information(self, "Scan", "Select mods first")
            return
        self._scan_mods(names)
    
    def _scan_all(self):
        reply = QtWidgets.QMessageBox.question(
            self, "Scan all",
            f"Scan all {len(self._mods)} mods?\n\nThis may take a while for large mod lists."
        )
        if reply == YES_BTN:
            self._scan_mods([m["name"] for m in self._mods])
    
    def _set_ui_busy(self, busy: bool):
        enabled = not busy
        self.btnCompress.setEnabled(enabled)
        self.btnDecompress.setEnabled(enabled)
        self.btnScan.setEnabled(enabled)
        self.btnScanAll.setEnabled(enabled)
        self.btnSelectAll.setEnabled(enabled)
        self.btnSelectNone.setEnabled(enabled)
        self.btnSelectCompressed.setEnabled(enabled)
        self.btnSelectUncompressed.setEnabled(enabled)
        self.btnSelectLOD.setEnabled(enabled)
        self.btnCancel.setEnabled(busy)
        self.table.setEnabled(enabled)
        self.chkActive.setEnabled(enabled)
        self.chkCompressed.setEnabled(enabled)
        self.chkUncompressed.setEnabled(enabled)
        self.chkHasLOD.setEnabled(enabled)
        self.editSearch.setEnabled(enabled)
        self.chkTextures.setEnabled(enabled and not self.chkAll.isChecked())
        self.chkMeshes.setEnabled(enabled and not self.chkAll.isChecked())
        self.chkSounds.setEnabled(enabled and not self.chkAll.isChecked())
        self.chkLOD.setEnabled(enabled and not self.chkAll.isChecked())
        self.chkAnimations.setEnabled(enabled and not self.chkAll.isChecked())
        self.chkAll.setEnabled(enabled)
        self.cmbAlgo.setEnabled(enabled)
        self.spinThreads.setEnabled(enabled)
    
    def _cancel_job(self):
        if self._worker:
            self._worker.cancel()
            self._log(">>> Cancelling...")
    
    def _run_job(self, mode: str):
        if self._scan_in_progress or self._operation_started or self._thread is not None:
            return
        names = self._get_checked()
        if not names:
            QtWidgets.QMessageBox.information(self, "Run", "Select mods first")
            return
        
        targets = self._get_targets()
        if not targets:
            QtWidgets.QMessageBox.warning(self, "Run", "Select at least one target type")
            return
        
        algo = self.cmbAlgo.currentData()
        threads = self.spinThreads.value()
        action = "Compress" if mode == "compress" else "Decompress"
        
        target_names = [TARGET_NAMES.get(t, str(t)) for t in targets]
        
        msg = f"{action} {len(names)} mods?\n\n"
        msg += f"Targets: {', '.join(target_names)}\n"
        if mode == "compress":
            msg += f"Algorithm: {algo}\n"
        msg += f"Threads: {'auto' if threads == 0 else threads}\n"
        msg += f"\nThis operation may take a while."
        
        reply = QtWidgets.QMessageBox.question(self, "Confirm", msg)
        if reply != YES_BTN:
            return
        
        self._set_ui_busy(True)
        self._operation_started = True
        self.progress.setMaximum(len(names))
        self.progress.setValue(0)
        self._start_timer()
        
        self._worker = CompressionWorker(
            self._organizer,
            self._state.get_all_data(),
            names, mode, targets, algo, threads
        )
        
        self._thread = QtCore.QThread()
        self._worker.moveToThread(self._thread)
        
        self._thread.started.connect(self._worker.run)
        self._worker.log.connect(self._log)
        self._worker.progress.connect(self._on_progress)
        self._worker.backend.connect(self._on_backend)
        self._worker.finished.connect(self._on_finished, QUEUED_CONNECTION)
        
        self._thread.start()
    
    def _on_progress(self, done: int, total: int, name: str):
        total = max(1, int(total or 1))
        done = max(0, min(int(done or 0), total))
        if self.progress.maximum() != total:
            self.progress.setMaximum(total)
        self.progress.setValue(done)
        self.progress.setFormat(f"{done}/{total}: {name}")
        self.status.setText(f"Processing: {name}")

    def _on_backend(self, backend: str):
        self.lblBackend.setText(f"Backend: {backend}")
    
    def _on_finished(self, ok: bool, summary: str, data: dict):
        self._stop_timer()
        self._log(summary)
        
        self._state.update_all(data)
        self._state.save()
        
        for mod in self._mods:
            mod["info"] = self._state.get(mod["name"])
        
        self._apply_filter()
        self._update_stats()
        self._set_ui_busy(False)
        self._operation_started = False
        self._mod_signature = self._current_mod_signature()
        self.progress.setValue(self.progress.maximum() if ok else 0)
        self.progress.setFormat("")
        self.status.setText(summary)
        
        if self._thread:
            self._thread.quit()
            self._thread.wait(3000)
            self._thread.deleteLater()
            self._thread = None
        if self._worker:
            self._worker.deleteLater()
            self._worker = None


# ---- MO2 Plugin ----
class ModCompressorTool(mobase.IPluginTool):
    def __init__(self):
        super().__init__()
        self._organizer = None
        self._parent = None
        self._state: Optional[StateManager] = None
        self._game_token: str = ""
    
    def init(self, organizer) -> bool:
        self._organizer = organizer
        self._game_token = _detect_game(organizer)
        return True
    
    def name(self) -> str:
        return "ModCompressorTool"
    
    def author(self) -> str:
        return "Community"
    
    def description(self) -> str:
        game = _get_game_name(self._organizer)
        return f"Compress {game} mods using Windows transparent compression (WOF/NTFS) to save disk space"
    
    def version(self) -> mobase.VersionInfo:
        return mobase.VersionInfo(4, 0, 3, 0)
    
    def isActive(self) -> bool:
        return True
    
    def settings(self) -> list:
        return []
    
    def displayName(self) -> str:
        return "Mod Compressor"
    
    def tooltip(self) -> str:
        return "Compress/decompress mods using Windows transparent compression (WOF)"
    
    def icon(self) -> QtGui.QIcon:
        return QtGui.QIcon()
    
    def setParentWidget(self, widget):
        self._parent = widget
    
    def _get_state_path(self) -> str:
        base = ""
        try:
            base = str(self._organizer.pluginDataPath())
        except:
            try:
                base = str(self._organizer.profilePath())
            except:
                base = os.path.expanduser("~")
        
        # Game-specific subfolder keeps state separate per game
        game_folder = self._game_token
        return os.path.join(base, "mod_compressor", game_folder, "state.json")
    
    def display(self):
        ok, err = _check_windows()
        if not ok:
            QtWidgets.QMessageBox.critical(self._parent, "Error", err)
            return
        
        path = self._get_state_path()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        
        self._state = StateManager(path)
        self._state.load()
        
        dlg = ModCompressorDialog(self._parent, self._organizer, self._state)
        
        if hasattr(dlg, "exec"):
            dlg.exec()
        else:
            dlg.exec_()


def createPlugin():
    return ModCompressorTool()
