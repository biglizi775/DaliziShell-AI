"""Freeze the current desktop development sources, including uncommitted changes."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
import shutil
import subprocess
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
# Positive selection: being visible to Git alone does not make a screenshot,
# hosting record, unrelated project or local export part of the desktop sources.
SOURCE = re.compile("|".join((
    r"\.(?:editorconfig|gitattributes|gitignore)|(?:README|CONTRIBUTING|THIRD_PARTY_NOTICES)\.md|LICENSE|package(?:-lock)?\.json",
    r"\.github/(?:ISSUE_TEMPLATE/[\w-]+\.md|pull_request_template\.md|workflows/[\w-]+\.ya?ml)",
    r"docs/[\w.-]+\.md|docs/verification/[\w.-]+\.json",
    r"src-tauri/(?:Cargo\.(?:toml|lock)|build\.rs|tauri\.conf\.json|\.cargo/config\.example\.toml|capabilities/[\w-]+\.json|icons/[\w-]+\.(?:png|ico))",
    r"src-tauri/src/(?:[\w-]+/)*[\w-]+\.rs",
    r"src-tauri/vendor/portable-pty/(?:Cargo\.toml|LICENSE\.md|(?:src|examples)/(?:\w+/)*\w+\.rs)",
    r"resources/release-notices/(?:fallbacks\.json|texts/[0-9a-f]{64}\.txt)",
    r"ui/[\w.-]+\.(?:html|css|js)|ui/vendor/(?:[\w.-]+/)*(?:LICENSE[\w.-]*|[\w.-]+\.(?:js|mjs|css|md|bcmap|icc|pfb|ttf|otf|wasm))",
    r"(?:tests|tools)/[\w.-]+\.(?:cjs|js|ps1|py)|tools/requirements[\w-]*\.txt",
    r"promo-film/(?:\.gitignore|README\.md|SCORE\.md|package\.json|cover/cover\.html|tools/[\w-]+\.(?:mjs|cjs)|dist/[\w-]+\.(?:js|css|html))",
)))


def source_files(root):
    names = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root
    ).decode("utf-8").split("\0")
    selected = []
    for name in sorted(set(names)):
        if not SOURCE.fullmatch(name):
            if name.startswith(("ui/", "src-tauri/", "resources/")) and (root / name).exists():
                raise ValueError(f"Review the source packaging rule for this application input: {name}")
            continue
        path = root / name
        if path.resolve() != path or path.is_symlink():
            raise ValueError(f"Refusing a redirected source path: {name}")
        if path.is_file():
            selected.append(name)
    return selected


def digest(path):
    with path.open("rb") as stream:
        h = sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
        return h.hexdigest()


def publish(source, destination):
    # Never replace an existing snapshot or silently accept a damaged sidecar.
    try:
        target = destination.open("xb")
    except FileExistsError:
        if digest(source) != digest(destination):
            raise ValueError(f"Existing artifact differs: {destination}")
        return
    try:
        with target, source.open("rb") as stream:
            shutil.copyfileobj(stream, target)
    except BaseException:
        destination.unlink()
        raise


def freeze(root, output):
    files = source_files(root)
    version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[\w.-]+)?", version):
        raise ValueError("Invalid package version")
    prefix = f"dalizi-files-{version}"
    output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output) as tmp:
        tmp = Path(tmp)
        zip_path, inventory, checksum = (tmp / n for n in ("source.zip", "files.txt", "sha256"))
        with ZipFile(zip_path, "x") as package, inventory.open("x", encoding="utf-8", newline="\n") as index:
            for name in files:
                data = (root / name).read_bytes()
                entry = ZipInfo(f"{prefix}/{name}", date_time=(1980, 1, 1, 0, 0, 0))
                entry.create_system = 3
                entry.external_attr = 0o100644 << 16
                package.writestr(entry, data, compress_type=ZIP_DEFLATED, compresslevel=9)
                index.write(f"{sha256(data).hexdigest()}  {name}\n")
        fingerprint = digest(zip_path)
        archive = output / f"{prefix}-source-{fingerprint[:16]}.zip"
        checksum.write_bytes(f"{fingerprint}  {archive.name}\n".encode("ascii"))
        publish(zip_path, archive)
        publish(inventory, archive.with_suffix(".files.txt"))
        publish(checksum, archive.with_suffix(".sha256"))
    return archive, fingerprint, len(files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    subprocess.run(["node", "tools/check_repo.cjs"], cwd=ROOT, check=True)
    archive, fingerprint, count = freeze(ROOT, args.output_dir.resolve())
    print(f"Source archive: {archive}\nFiles: {count}, bytes: {archive.stat().st_size}\nSHA-256: {fingerprint}")


if __name__ == "__main__":
    main()
