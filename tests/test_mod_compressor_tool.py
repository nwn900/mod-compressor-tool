import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


def load_plugin():
    mobase = types.ModuleType("mobase")

    class IPluginTool:
        pass

    class VersionInfo:
        def __init__(self, *parts):
            self.parts = parts

    class ModState:
        ACTIVE = 0x2

    mobase.IPluginTool = IPluginTool
    mobase.VersionInfo = VersionInfo
    mobase.ModState = ModState
    sys.modules["mobase"] = mobase

    module_name = "mod_compressor_tool_under_test"
    sys.modules.pop(module_name, None)
    spec = importlib.util.spec_from_file_location(
        module_name,
        Path(__file__).resolve().parents[1] / "mod_compressor_tool.py",
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


mod = load_plugin()


class _FakeMod:
    def __init__(self, name, path):
        self.name = name
        self._path = path

    def absolutePath(self):
        return self._path

    def isForeign(self):
        return False


class _FakeModList:
    def __init__(self, mods):
        self.mods = mods

    def allMods(self):
        return [mod.name for mod in self.mods]

    def getMod(self, name):
        return next((mod for mod in self.mods if mod.name == name), None)

    def state(self, name):
        return 0x2


class _FakeOrganizer:
    def __init__(self, mods, plugin_data):
        self._mod_list = _FakeModList(mods)
        self._plugin_data = plugin_data

    def modList(self):
        return self._mod_list

    def pluginDataPath(self):
        return self._plugin_data


class NativeHelperProtocolTests(unittest.TestCase):
    def test_stats_mapping_preserves_extended_measurement_fields(self):
        runner = mod.NativeHelperRunner(helper_path="missing-helper.exe")
        info = runner._stats_to_mod_info(
            {
                "fileCount": 4,
                "totalSize": 4000,
                "diskSize": 2000,
                "skippedFiles": 1,
                "textureSize": 1000,
                "meshSize": 500,
                "soundSize": 250,
                "lodSize": 125,
                "animationSize": 75,
                "otherSize": 2050,
                "compressedByAttr": 2,
                "compressedBySize": 3,
                "compressedByWof": 4,
                "compressed": True,
                "ratio": 2.0,
                "algorithm": "xpress8k",
            }
        )
        self.assertEqual(info.sound_size, 250)
        self.assertEqual(info.animation_size, 75)
        self.assertEqual(info.compressed_by_attr, 2)
        self.assertEqual(info.compressed_by_size, 3)
        self.assertEqual(info.compressed_by_wof, 4)
        self.assertEqual(info.algorithm, "xpress8k")

    def test_response_parser_uses_last_json_line(self):
        runner = mod.NativeHelperRunner(helper_path="missing-helper.exe")
        response = runner._parse_response(
            "native helper diagnostic\n"
            + json.dumps({"ok": True, "code": 0, "stats": {}})
            + "\n"
        )
        self.assertTrue(response["ok"])
        self.assertEqual(response["code"], 0)

    def test_operation_requests_mark_paths_as_authoritative(self):
        runner = mod.NativeHelperRunner(helper_path="missing-helper.exe")
        payloads = []

        def capture(payload, timeout=0):
            payloads.append(payload)
            return mod.BackendResult(True, 0, "ok")

        runner._request = capture
        runner.compress(["C:/mod/texture.dds"], "xpress8k", threads=3)
        runner.decompress(["C:/mod/texture.dds"], threads=2)
        self.assertTrue(payloads[0]["explicit"])
        self.assertEqual(payloads[0]["threads"], 3)
        self.assertTrue(payloads[1]["explicit"])
        self.assertEqual(payloads[1]["threads"], 2)

    def test_measure_request_is_explicit(self):
        runner = mod.NativeHelperRunner(helper_path="missing-helper.exe")
        payloads = []
        runner._request = lambda payload, timeout=0: (
            payloads.append(payload) or mod.BackendResult(True, 0, "ok", stats=mod.ModInfo())
        )
        runner.measure(["C:/mod"])
        self.assertEqual(payloads[0], {"command": "measure", "paths": ["C:/mod"], "explicit": True})

    def test_malformed_numeric_response_is_safe_and_fails_closed(self):
        runner = mod.NativeHelperRunner(helper_path="missing-helper.exe")
        result = runner._result_from_response(
            {"ok": True, "code": "not-a-code", "processed": "bad", "errors": "bad"}
        )
        self.assertFalse(result.ok)
        self.assertEqual(result.code, 1)
        self.assertEqual(result.processed, 0)

    def test_probe_requires_protocol_and_algorithm_advertisement(self):
        runner = mod.NativeHelperRunner(helper_path="fake-helper.exe")
        runner._available = True
        runner._request = lambda payload, timeout=0: mod.BackendResult(
            True,
            0,
            "ready",
            output=json.dumps({"ok": True, "code": 0, "version": "0.1.0", "algorithms": ["xpress8k"]}),
        )
        result = runner.probe()
        self.assertFalse(result.ok)
        self.assertEqual(result.code, -4)

    def test_request_rejects_malformed_output_and_keeps_bounded_diagnostics(self):
        runner = mod.NativeHelperRunner(helper_path="fake-helper.exe")
        runner._available = True
        process = mock.Mock(returncode=0)
        process.communicate.return_value = (b"not-json\n", b"diagnostic")
        with mock.patch.object(mod.subprocess, "Popen", return_value=process):
            result = runner._request({"command": "probe"})
        self.assertFalse(result.ok)
        self.assertIn("invalid native helper response", result.message)

    def test_request_timeout_cancels_process(self):
        runner = mod.NativeHelperRunner(helper_path="fake-helper.exe")
        runner._available = True
        process = mock.Mock(returncode=None)
        process.communicate.side_effect = subprocess.TimeoutExpired("fake-helper", 1)
        process.wait.return_value = 0
        with mock.patch.object(mod.subprocess, "Popen", return_value=process):
            result = runner._request({"command": "measure"}, timeout=1)
        self.assertFalse(result.ok)
        self.assertEqual(result.message, "Timeout")
        process.terminate.assert_called_once()


class SelectionAndStateTests(unittest.TestCase):
    def test_mod_info_round_trip_includes_new_fields(self):
        info = mod.ModInfo(
            sound_size=25,
            animation_size=50,
            source_path="C:/mods/Alpha",
            compressed_by_attr=1,
            compressed_by_size=2,
            compressed_by_wof=3,
        )
        restored = mod.ModInfo.from_dict(info.to_dict())
        self.assertEqual(restored.sound_size, 25)
        self.assertEqual(restored.animation_size, 50)
        self.assertEqual(restored.source_path, "C:/mods/Alpha")
        self.assertEqual(restored.compressed_by_attr, 1)
        self.assertEqual(restored.compressed_by_size, 2)
        self.assertEqual(restored.compressed_by_wof, 3)

    def test_malformed_legacy_state_coerces_without_crashing_ui(self):
        restored = mod.ModInfo.from_dict(
            {"total_size": "not-a-number", "ratio": "nan", "compressed": "yes", "lod_size": -4}
        )
        self.assertEqual(restored.total_size, 0)
        self.assertEqual(restored.ratio, 1.0)
        self.assertTrue(restored.compressed)
        self.assertEqual(restored.lod_size, 0)

    def test_state_prune_removes_only_missing_mods(self):
        with tempfile.TemporaryDirectory() as temp:
            state = mod.StateManager(os.path.join(temp, "state.json"))
            state.update_all({"Keep": {"total_size": 1}, "Remove": {"total_size": 2}})
            removed = state.prune({"Keep"})
            self.assertEqual(removed, 1)
            self.assertIn("Keep", state.get_all_data())
            self.assertNotIn("Remove", state.get_all_data())

    def test_state_manager_migrates_legacy_mapping_to_versioned_wrapper(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "state.json"
            path.write_text(json.dumps({"Alpha": {"total_size": 123}}), encoding="utf-8")
            state = mod.StateManager(str(path))
            state.load()
            self.assertEqual(state.get("Alpha").total_size, 123)
            self.assertTrue(state.save())
            payload = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(payload["schema_version"], mod.STATE_SCHEMA_VERSION)
            self.assertEqual(payload["mods"]["Alpha"]["total_size"], 123)

    def test_state_manager_reads_versioned_wrapper_without_exposing_metadata(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "state.json"
            path.write_text(
                json.dumps({
                    "schema_version": mod.STATE_SCHEMA_VERSION,
                    "mods": {"Alpha": {"source_path": "C:/mods/Alpha"}},
                }),
                encoding="utf-8",
            )
            state = mod.StateManager(str(path))
            state.load()
            self.assertEqual(set(state.get_all_data()), {"Alpha"})
            self.assertEqual(state.get("Alpha").source_path, "C:/mods/Alpha")

    def test_compression_file_selection_is_explicit_and_safe(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            eligible = root / "textures" / "good.dds"
            disputed = [
                root / "sound" / "voice.fuz",
                root / "sound" / "voice.lip",
                root / "scripts" / "effect.pex",
                root / "lod" / "world.seq",
                root / "interface" / "hud.swf",
            ]
            ignored = root / "textures" / "config.ini"
            tiny = root / "textures" / "tiny.dds"
            eligible.parent.mkdir()
            eligible.write_bytes(b"x" * 2048)
            for path in disputed:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"x" * 2048)
            ignored.write_bytes(b"x" * 2048)
            tiny.write_bytes(b"x" * 100)
            workload = mod.ModWorkload(root=str(root), operation_items=[str(root / "textures")])
            paths = mod._collect_workload_file_paths(workload, for_compression=True)
            self.assertEqual(paths, [os.path.normpath(str(eligible))])

            all_paths = mod._collect_workload_file_paths(
                mod.ModWorkload(root=str(root), operation_items=[str(root)]),
                for_compression=True,
            )
            self.assertEqual(
                {Path(path).suffix.lower() for path in all_paths},
                {".dds", ".fuz", ".lip", ".pex", ".seq", ".swf"},
            )

    def test_scan_categories_include_sound_and_animation_sizes(self):
        self.assertEqual(mod._get_file_category("C:/mod/sound/track.wav", ".wav"), "sound")
        self.assertEqual(mod._get_file_category("C:/mod/animations/run.hkx", ".hkx"), "animation")

    def test_scan_reports_per_file_progress(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            first = root / "wall.dds"
            second = root / "floor.nif"
            first.write_bytes(b"x" * 2048)
            second.write_bytes(b"x" * 2048)
            events = []

            with mock.patch.object(mod, "_has_winapi_physical_size", return_value=True), \
                 mock.patch.object(mod, "_get_physical_size", side_effect=lambda path: os.path.getsize(path)), \
                 mock.patch.object(mod, "_has_ntfs_compressed_attr", return_value=False), \
                 mock.patch.object(mod, "_is_wof_compressed", return_value=False):
                info = mod._scan_file_paths(
                    [str(first), str(second)],
                    progress_callback=lambda done, total, label: events.append((done, total, label)),
                )

            self.assertEqual(info.file_count, 2)
            self.assertEqual([(done, total) for done, total, _ in events], [(1, 2), (2, 2)])
            self.assertEqual(Path(events[-1][2]).name, "floor.nif")

    def test_foreign_workload_never_recurses_unowned_data_root(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            owned = root / "owned.dds"
            unowned = root / "unowned.dds"
            owned.write_bytes(b"x" * 2048)
            unowned.write_bytes(b"x" * 2048)
            workload = mod.ModWorkload(
                root=str(root), operation_items=[str(owned)], is_foreign=True
            )
            self.assertEqual(
                mod._collect_workload_file_paths(workload, for_compression=True),
                [os.path.abspath(str(owned))],
            )

    def test_worker_uses_one_native_operation_and_post_measurement(self):
        with tempfile.TemporaryDirectory() as temp:
            mod_root = Path(temp) / "Alpha"
            texture_dir = mod_root / "textures"
            texture_dir.mkdir(parents=True)
            (texture_dir / "wall.dds").write_bytes(b"x" * 2048)
            organizer = _FakeOrganizer([_FakeMod("Alpha", str(mod_root))], temp)
            calls = []

            class FakeNative:
                PROTOCOL_VERSION = "0.1.0"
                version = "0.1.0"

                def __init__(self):
                    self._cancelled = False

                def probe(self):
                    return mod.BackendResult(True, 0, "ready")

                def compress(self, paths, algorithm, threads):
                    calls.append(("compress", list(paths), algorithm, threads))
                    return mod.BackendResult(True, 0, "compressed", processed=len(paths), changed=len(paths))

                def measure(self, paths):
                    calls.append(("measure", list(paths)))
                    return mod.BackendResult(
                        True,
                        0,
                        "measured",
                        stats=mod.ModInfo(
                            file_count=1,
                            total_size=2048,
                            disk_size=1024,
                            ratio=2.0,
                            compressed=True,
                            compressed_by_wof=1,
                            algorithm="xpress8k",
                        ),
                    )

                def decompress(self, paths, threads):
                    raise AssertionError("decompress should not be called")

                def cancel(self):
                    self._cancelled = True

            finished = []
            with mock.patch.object(mod, "NativeHelperRunner", FakeNative):
                worker = mod.CompressionWorker(
                    organizer,
                    {},
                    ["Alpha"],
                    "compress",
                    [mod.TargetType.TEXTURES],
                    "xpress8k",
                    3,
                )
                worker.finished.connect(lambda *args: finished.append(args))
                worker.run()
            self.assertEqual(calls[0][0], "compress")
            self.assertEqual(calls[0][2:], ("xpress8k", 3))
            self.assertEqual(calls[1][0], "measure")
            self.assertEqual(finished[0][0], True)
            self.assertEqual(finished[0][2]["Alpha"]["compressed_by_wof"], 1)

    def test_worker_reports_file_level_progress_for_one_mod(self):
        with tempfile.TemporaryDirectory() as temp:
            mod_root = Path(temp) / "Alpha"
            texture_dir = mod_root / "textures"
            texture_dir.mkdir(parents=True)
            (texture_dir / "wall.dds").write_bytes(b"x" * 2048)
            (texture_dir / "floor.dds").write_bytes(b"x" * 2048)
            organizer = _FakeOrganizer([_FakeMod("Alpha", str(mod_root))], temp)

            class FakeNative:
                PROTOCOL_VERSION = "0.1.0"
                version = "0.1.0"

                def __init__(self):
                    self._cancelled = False

                def probe(self):
                    return mod.BackendResult(True, 0, "ready")

                def compress(self, paths, algorithm, threads, progress_callback=None):
                    if progress_callback is not None:
                        for index, path in enumerate(paths, 1):
                            progress_callback(index, len(paths), path)
                    return mod.BackendResult(
                        True, 0, "compressed", processed=len(paths), changed=len(paths)
                    )

                def measure(self, paths):
                    return mod.BackendResult(
                        True,
                        0,
                        "measured",
                        stats=mod.ModInfo(
                            file_count=len(paths),
                            total_size=4096,
                            disk_size=2048,
                            ratio=2.0,
                            compressed=True,
                            compressed_by_wof=len(paths),
                            algorithm="xpress8k",
                        ),
                    )

                def cancel(self):
                    self._cancelled = True

            progress = []
            with mock.patch.object(mod, "NativeHelperRunner", FakeNative):
                worker = mod.CompressionWorker(
                    organizer,
                    {},
                    ["Alpha"],
                    "compress",
                    [mod.TargetType.TEXTURES],
                    "xpress8k",
                )
                worker.progress.connect(lambda done, total, label: progress.append((done, total, label)))
                worker.run()

            self.assertTrue(progress)
            self.assertGreaterEqual(max(total for _, total, _ in progress), 2)
            self.assertEqual(progress[-1][0], progress[-1][1])
            self.assertIn("floor.dds", " ".join(label for _, _, label in progress))

    def test_worker_exception_still_emits_terminal_failure(self):
        worker = mod.CompressionWorker(None, {}, [], "compress", [], "xpress8k")

        def fail():
            raise RuntimeError("boom")

        worker._run_impl = fail
        finished = []
        worker.finished.connect(lambda *args: finished.append(args))
        worker.run()
        self.assertEqual(len(finished), 1)
        self.assertFalse(finished[0][0])
        self.assertIn("RuntimeError", finished[0][1])

    def test_worker_rejects_decompression_with_remaining_wof_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            mod_root = Path(temp) / "Alpha"
            texture_dir = mod_root / "textures"
            texture_dir.mkdir(parents=True)
            (texture_dir / "wall.dds").write_bytes(b"x" * 2048)
            organizer = _FakeOrganizer([_FakeMod("Alpha", str(mod_root))], temp)

            class FakeNative:
                PROTOCOL_VERSION = "0.1.0"
                version = "0.1.0"

                def probe(self):
                    return mod.BackendResult(True, 0, "ready")

                def decompress(self, paths, threads):
                    return mod.BackendResult(True, 0, "decompressed", processed=len(paths), changed=len(paths))

                def measure(self, paths):
                    return mod.BackendResult(
                        True,
                        0,
                        "measured",
                        stats=mod.ModInfo(
                            file_count=1,
                            total_size=2048,
                            disk_size=1024,
                            ratio=2.0,
                            compressed=True,
                            compressed_by_wof=1,
                            algorithm="xpress8k",
                        ),
                    )

                def compress(self, paths, algorithm, threads):
                    raise AssertionError("compress should not be called")

                def cancel(self):
                    pass

            finished = []
            with mock.patch.object(mod, "NativeHelperRunner", FakeNative):
                worker = mod.CompressionWorker(
                    organizer,
                    {"Alpha": mod.ModInfo(compressed=True, algorithm="xpress8k").to_dict()},
                    ["Alpha"],
                    "decompress",
                    [mod.TargetType.TEXTURES],
                    "xpress8k",
                )
                worker.finished.connect(lambda *args: finished.append(args))
                worker.run()
            self.assertEqual(len(finished), 1)
            self.assertFalse(finished[0][0])
            self.assertIn("Errors: 1", finished[0][1])

    def test_dialog_selection_survives_filter_and_idle_mod_refresh(self):
        app = mod.QtWidgets.QApplication.instance() or mod.QtWidgets.QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            mods = [_FakeMod("Alpha", os.path.join(temp, "Alpha")), _FakeMod("Beta", os.path.join(temp, "Beta"))]
            for item in mods:
                os.makedirs(item._path)
            organizer = _FakeOrganizer(mods, temp)
            state = mod.StateManager(os.path.join(temp, "state.json"))
            dialog = mod.ModCompressorDialog(None, organizer, state)
            try:
                dialog._select_all(True)
                self.assertEqual(dialog._get_checked(), ["Alpha", "Beta"])
                dialog.editSearch.setText("Alpha")
                dialog._apply_filter()
                self.assertEqual(dialog._get_checked(), ["Alpha", "Beta"])

                new_mod = _FakeMod("Gamma", os.path.join(temp, "Gamma"))
                os.makedirs(new_mod._path)
                organizer._mod_list.mods.append(new_mod)
                dialog._refresh_if_changed()
                self.assertEqual(dialog._get_checked(), ["Alpha", "Beta"])
                self.assertNotIn("Gamma", dialog._checked_names)
            finally:
                dialog.close()
                app.processEvents()

    def test_select_all_batches_item_changes_and_refreshes_count_once(self):
        app = mod.QtWidgets.QApplication.instance() or mod.QtWidgets.QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            mods = [
                _FakeMod(name, os.path.join(temp, name))
                for name in ("Alpha", "Beta", "Gamma", "Delta")
            ]
            for item in mods:
                os.makedirs(item._path)
            organizer = _FakeOrganizer(mods, temp)
            state = mod.StateManager(os.path.join(temp, "state.json"))
            dialog = mod.ModCompressorDialog(None, organizer, state)
            update_calls = []
            original_update = dialog._update_selected_count
            dialog._update_selected_count = lambda: (
                update_calls.append(True) or original_update()
            )
            try:
                dialog._select_all(True)
                self.assertEqual(dialog._get_checked(), [item.name for item in mods])
                self.assertEqual(len(update_calls), 1)

                update_calls.clear()
                dialog._select_all(False)
                self.assertEqual(dialog._get_checked(), [])
                self.assertEqual(len(update_calls), 1)
            finally:
                dialog.close()
                app.processEvents()

    def test_dialog_progress_reconfigures_for_file_denominator(self):
        app = mod.QtWidgets.QApplication.instance() or mod.QtWidgets.QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            item = _FakeMod("Alpha", os.path.join(temp, "Alpha"))
            os.makedirs(item._path)
            organizer = _FakeOrganizer([item], temp)
            state = mod.StateManager(os.path.join(temp, "state.json"))
            dialog = mod.ModCompressorDialog(None, organizer, state)
            try:
                dialog._on_progress(1, 4, "Alpha: wall.dds")
                self.assertEqual(dialog.progress.maximum(), 4)
                self.assertEqual(dialog.progress.value(), 1)
                self.assertIn("1/4", dialog.progress.format())
                self.assertIn("wall.dds", dialog.progress.format())
            finally:
                dialog.close()
                app.processEvents()

    def test_thread_option_round_trips_and_bad_value_is_ignored(self):
        app = mod.QtWidgets.QApplication.instance() or mod.QtWidgets.QApplication([])
        with tempfile.TemporaryDirectory() as temp:
            item = _FakeMod("Alpha", os.path.join(temp, "Alpha"))
            os.makedirs(item._path)
            organizer = _FakeOrganizer([item], temp)
            state = mod.StateManager(os.path.join(temp, "state.json"))
            first = mod.ModCompressorDialog(None, organizer, state)
            second = None
            third = None
            try:
                first.spinThreads.setValue(7)
                first._save_options()
                second = mod.ModCompressorDialog(None, organizer, state)
                self.assertEqual(second.spinThreads.value(), 7)
                second.close()
                options_path = Path(first._options_path())
                options_path.write_text(json.dumps({"threads": "invalid"}), encoding="utf-8")
                third = mod.ModCompressorDialog(None, organizer, state)
                self.assertEqual(third.spinThreads.value(), 0)
            finally:
                first.close()
                if second is not None:
                    second.close()
                if third is not None:
                    third.close()
                app.processEvents()

    def test_compact_fallback_receives_explicit_file_arguments(self):
        runner = mod.CompactRunner()
        commands = []
        runner._run = lambda args, timeout=0: (commands.append(args) or (0, "", ""))
        result = runner.compress_paths(["C:/mod/a.dds", "C:/mod/b.nif"], "xpress8k")
        self.assertTrue(result.ok)
        self.assertEqual(
            commands[0][-2:],
            [os.path.normpath("C:/mod/a.dds"), os.path.normpath("C:/mod/b.nif")],
        )

    def test_compact_decompression_reports_batch_progress(self):
        runner = mod.CompactRunner()
        runner._run = lambda args, timeout=0: (0, "", "")
        events = []
        result = runner.decompress_paths(
            ["C:/mod/a.dds", "C:/mod/b.nif"],
            progress_callback=lambda done, total, label: events.append((done, total, label)),
        )
        self.assertTrue(result.ok)
        self.assertEqual(events[-1][:2], (2, 2))


if __name__ == "__main__":
    unittest.main()
