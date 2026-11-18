from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
from windows_architecture import executable_architecture


@unittest.skipUnless(shutil.which("powershell.exe"), "Windows PowerShell required")
class WindowsRuntimeTests(unittest.TestCase):
    def test_full_workbench_prerequisites_are_not_cross_machine_acceptance(self):
        cases = [
            (7601, 1, "x64", "Client", "109.0", "below-full-workbench-baseline"),
            (9600, 1, "x64", "Client", "109.0", "below-full-workbench-baseline"),
            (14393, 3, "x64", "Server", "150.0", "below-full-workbench-baseline"),
            (17763, 1, "x64", "Client", "", "webview2-not-detected"),
            (17763, 1, "x64", "Client", "150.0", "prerequisites-detected"),
            (19045, 1, "x86", "Client", "150.0", "requires-other-architecture"),
            (19045, 1, "arm64", "Client", "150.0", "requires-other-architecture"),
            (26100, 1, "arm64", "Client", "150.0", "x64-emulation-needs-test"),
            (20348, 3, "x64", "Server Core", "150.0", "requires-server-desktop-check"),
            (20348, 3, "x64", "Server", "150.0", "prerequisites-detected"),
            (0, 0, "unknown", "", "", "unknown-platform"),
        ]
        commands = [". .\\tools\\check_windows_runtime.ps1"]
        for build, product, arch, installation, version, _ in cases:
            commands.append(f"Get-DaliziPlatformResult {build} {product} '{arch}' '{installation}' '{version}'")
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", "\n".join(commands)],
            cwd=ROOT, capture_output=True, check=True, timeout=20,
        )
        self.assertEqual(result.stdout.decode("ascii").splitlines(), [c[-1] for c in cases])

    def test_x86_package_prerequisites(self):
        commands = [". .\\tools\\check_windows_runtime.ps1"]
        for arch, web in [('x86', '150.0'), ('x64', '150.0'), ('arm64', '150.0'), ('x86', '')]:
            commands.append(f"Get-DaliziPlatformResult 19045 1 '{arch}' 'Client' '{web}' 'x86'")
        result = subprocess.check_output(['powershell.exe', '-NoProfile', '-Command', '\n'.join(commands)], cwd=ROOT)
        self.assertEqual(result.decode('ascii').splitlines(), [
            'prerequisites-detected', 'wow64-needs-test', 'x86-emulation-needs-test', 'webview2-not-detected'])

    def test_early_windows_with_compatible_terminal_requires_system_acceptance(self):
        commands = [". .\\tools\\check_windows_runtime.ps1"]
        for build, product, installation, web, bundled in [
            (14393, 1, 'Client', '150', '$true'), (14393, 1, 'Client', '150', '$false'),
            (14393, 3, 'Server Core', '150', '$true'), (17134, 1, 'Client', '', '$true'),
            (9600, 1, 'Client', '109', '$true')]:
            commands.append(f"Get-DaliziPlatformResult {build} {product} 'x64' '{installation}' '{web}' 'x64' {bundled}")
        result = subprocess.check_output(['powershell.exe', '-NoProfile', '-Command', '\n'.join(commands)], cwd=ROOT)
        self.assertEqual(result.decode('ascii').splitlines(), [
            'early-windows-with-winpty-needs-test', 'below-full-workbench-baseline',
            'requires-server-desktop-check', 'webview2-not-detected', 'below-full-workbench-baseline'])

    def test_packager_and_checker_identify_the_executable(self):
        with tempfile.TemporaryDirectory() as temp:
            commands = [". .\\tools\\check_windows_runtime.ps1"]
            for machine, arch in [(0x014c, 'x86'), (0x8664, 'x64'), (0xaa64, 'unknown')]:
                path = Path(temp, f'{arch}.exe')
                header = bytearray(136)
                header[:2] = b'MZ'
                struct.pack_into('<I', header, 60, 128)
                struct.pack_into('<4sH', header, 128, b'PE\0\0', machine)
                path.write_bytes(header)
                if arch == 'unknown':
                    with self.assertRaises(ValueError):
                        executable_architecture(path)
                else:
                    self.assertEqual(executable_architecture(path), arch)
                commands.append("Get-DaliziPackageArchitecture '" + str(path).replace("'", "''") + "'")
            result = subprocess.check_output(['powershell.exe', '-NoProfile', '-Command', '\n'.join(commands)], cwd=ROOT)
            self.assertEqual(result.decode('ascii').splitlines(), ['x86', 'x64', 'unknown'])
