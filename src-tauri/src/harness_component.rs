//! The executable, not the removable component, owns the trusted inventory digest.
use dalizi_harness_client::runtime::Runtime;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{self, Read, Seek, SeekFrom, Write},
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
use zip::ZipArchive;

pub const ID: &str = "harness-0.2.2-rc.3-node24.22.1-win-x64-r2";
pub const PIN: &str = include_str!("../../resources/harness/component.sha256");
const NODE: &str = "node.exe";
const ENTRY: &str = "node_modules/@deepseek-ai/dsh/lib/bin.js";
const INVALID: &str = "组件校验失败。请从对应版本的发行包重新复制完整组件；没有启动模型。";
fn invalid() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, INVALID)
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema: u32,
    component: String,
    files: BTreeMap<String, (u64, String)>,
}
pub struct Image {
    archive: ZipArchive<File>,
    manifest: Manifest,
}
pub fn path(exe_dir: &Path) -> PathBuf {
    exe_dir.join("components").join(format!("{ID}.zip"))
}
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 1024
        && name.split('/').all(|s| {
            let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
            !s.is_empty()
                && s != "."
                && s != ".."
                && !s.ends_with([' ', '.'])
                && s.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"@_+.~ -".contains(&c))
                && !matches!(stem.as_str(), "AUX" | "PRN" | "NUL" | "CON")
                && !(stem.len() == 4
                    && (stem.starts_with("COM") || stem.starts_with("LPT"))
                    && stem.as_bytes()[3].is_ascii_digit())
        })
}
impl Image {
    pub fn open(exe_dir: &Path) -> io::Result<Self> {
        let path = path(exe_dir);
        let dir = fs::symlink_metadata(exe_dir.join("components"))?;
        if !dir.is_dir() || dir.file_attributes() & 0x400 != 0 {
            return Err(invalid());
        }
        let mut file = OpenOptions::new()
            .read(true)
            .share_mode(1)
            .custom_flags(0x0020_0000)
            .open(&path)?;
        let meta = file.metadata()?;
        if !meta.is_file() || meta.file_attributes() & 0x400 != 0 || meta.len() > 192 * 1024 * 1024
        {
            return Err(invalid());
        }
        check_directory_bounds(&mut file, meta.len())?;
        let mut archive = ZipArchive::new(file).map_err(|_| invalid())?;
        if archive.len() > 10000 {
            return Err(invalid());
        }
        let mut manifest = Vec::new();
        archive
            .by_name("manifest.json")
            .map_err(|_| invalid())?
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut manifest)
            .map_err(|_| invalid())?;
        if manifest.len() > 2 * 1024 * 1024
            || format!("{:x}", Sha256::digest(&manifest)) != PIN.trim()
        {
            return Err(invalid());
        }
        let manifest: Manifest = serde_json::from_slice(&manifest).map_err(|_| invalid())?;
        if manifest.schema != 1
            || manifest.component != ID
            || manifest.files.len() + 1 != archive.len()
            || !manifest.files.contains_key(NODE)
            || !manifest.files.contains_key(ENTRY)
        {
            return Err(invalid());
        }
        let mut seen = HashSet::new();
        let mut total = 0u64;
        for i in 0..archive.len() {
            let e = archive.by_index(i).map_err(|_| invalid())?;
            let entry_name = e.name().map_err(|_| invalid())?;
            let n = entry_name.as_ref();
            if !safe_name(n)
                || !seen.insert(n.to_ascii_lowercase())
                || !e.is_file()
                || e.is_symlink()
            {
                return Err(invalid());
            }
            if n != "manifest.json" {
                let (size, _) = manifest.files.get(n).ok_or_else(invalid)?;
                total = total.checked_add(*size).ok_or_else(invalid)?;
                if e.size() != *size || total > 256 * 1024 * 1024 {
                    return Err(invalid());
                }
            }
        }
        Ok(Self { archive, manifest })
    }
    pub fn verify_or_extract(mut self, dest: Option<&Path>) -> io::Result<()> {
        if let Some(d) = dest {
            fs::create_dir(d)?;
        }
        let mut buf = vec![0u8; 65536];
        for (name, (expected, hash)) in self.manifest.files {
            let mut file = if let Some(d) = dest {
                let path = d.join(&name);
                fs::create_dir_all(path.parent().ok_or_else(invalid)?)?;
                Some(File::create_new(path)?)
            } else {
                None
            };
            let mut input = self
                .archive
                .by_name(&name)
                .map_err(|_| invalid())?
                .take(expected + 1);
            let mut sha = Sha256::new();
            let mut count = 0u64;
            loop {
                let n = input.read(&mut buf).map_err(|_| invalid())?;
                if n == 0 {
                    break;
                }
                count += n as u64;
                if count > expected {
                    return Err(invalid());
                }
                sha.update(&buf[..n]);
                if let Some(f) = &mut file {
                    f.write_all(&buf[..n])?;
                }
            }
            if count != expected || format!("{:x}", sha.finalize()) != hash {
                return Err(invalid());
            }
        }
        Ok(())
    }
    pub fn provision(self, scratch: &Path) -> io::Result<Runtime> {
        let dest = scratch.join("component");
        self.verify_or_extract(Some(&dest))?;
        Ok(Runtime {
            node: dest.join(NODE),
            entry: dest.join(ENTRY),
        })
    }
}

// The builder emits an ordinary single-disk ZIP with no comment. Bound the parser's
// allocation from the end record before opening the directory of an untrusted file.
fn check_directory_bounds(f: &mut (impl Read + Seek), length: u64) -> io::Result<()> {
    let mut b = [0u8; 22];
    if length < 22 {
        return Err(invalid());
    }
    f.seek(SeekFrom::End(-22))?;
    f.read_exact(&mut b)?;
    let count = u16::from_le_bytes([b[10], b[11]]);
    let size = u32::from_le_bytes([b[12], b[13], b[14], b[15]]) as u64;
    let offset = u32::from_le_bytes([b[16], b[17], b[18], b[19]]) as u64;
    if &b[..4] != b"PK\x05\x06"
        || b[4..8] != [0; 4]
        || b[8..10] != b[10..12]
        || !(2..=10000).contains(&count)
        || size > 4 * 1024 * 1024
        || size < 46 * u64::from(count)
        || offset + size + 22 != length
        || b[20..] != [0, 0]
    {
        return Err(invalid());
    }
    f.rewind()?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_oversized_index_before_zip_parser() {
        let mut end = vec![0u8; 22];
        end[0..4].copy_from_slice(b"PK\x05\x06");
        end[8..10].copy_from_slice(&60000u16.to_le_bytes());
        end[10..12].copy_from_slice(&60000u16.to_le_bytes());
        assert!(check_directory_bounds(&mut io::Cursor::new(end), 22).is_err());
    }
}
