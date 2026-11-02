//! Bounded, read-only previews. Frontend must render text with textContent,
//! never innerHTML; image payloads only use the raster MIME types below.

use std::fs::{self, File, OpenOptions};
use std::io::{Cursor, Read};
use std::path::{Component, Path};

use serde::Serialize;

#[path = "preview_sheets.rs"]
mod sheets;

const TEXT_LIMIT: usize = 64 * 1024;
const IMAGE_LIMIT: usize = 8 * 1024 * 1024;
const PDF_LIMIT: usize = 32 * 1024 * 1024;
const DOCX_LIMIT: usize = 16 * 1024 * 1024;
const DOCX_XML_LIMIT: usize = 4 * 1024 * 1024;
const DOCUMENT_TEXT_LIMIT: usize = 256 * 1024;
const SHEET_LIMIT: usize = 32 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    kind: &'static str,
    content: String,
    truncated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<&'static str>,
}

impl Preview {
    fn unsupported() -> Self {
        Self::unavailable("unsupported")
    }

    fn unavailable(reason: &'static str) -> Self {
        Self {
            kind: "unsupported",
            content: String::new(),
            truncated: false,
            reason: Some(reason),
        }
    }
}

#[tauri::command]
pub async fn preview_file(path: String) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || read_preview(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

// Reject device/pipe namespaces before opening: opening a named pipe could wait
// indefinitely. Reparse points are excluded below rather than followed.
pub(crate) fn ordinary_path(path: &Path) -> bool {
    let original = path.to_string_lossy().replace('/', "\\");
    let raw = if let Some(unc) = original.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else if original.starts_with(r"\\?\") && original.as_bytes().get(5) == Some(&b':') && original.as_bytes().get(6) == Some(&b'\\') {
        original[4..].to_owned()
    } else { original };
    if !path.is_absolute()
        || raw.contains('\0')
        || raw.starts_with(r"\\.\")
        || raw.starts_with(r"\\?\")
    {
        return false;
    }
    if raw.starts_with(r"\\") {
        let share = raw[2..].split('\\').nth(1).unwrap_or_default();
        if share.eq_ignore_ascii_case("pipe") || share.eq_ignore_ascii_case("IPC$") {
            return false;
        }
    }
    Path::new(&raw).components().all(|component| match component {
        Component::Normal(name) => {
            let name = name.to_string_lossy();
            // Colons in components denote alternate streams, not regular files.
            if name.contains(':') {
                return false;
            }
            let stem = name
                .split('.')
                .next()
                .unwrap_or_default()
                .trim_end_matches(' ')
                .to_uppercase();
            !matches!(
                stem.as_str(),
                "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
            ) && !(stem.starts_with("COM") || stem.starts_with("LPT"))
                .then(|| stem.chars().skip(3).collect::<String>())
                .is_some_and(|n| {
                    matches!(
                        n.as_str(),
                        "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                    )
                })
        }
        _ => true,
    })
}

fn text_extension(ext: &str) -> bool {
    matches!(
        ext,
        "" | "txt"
            | "md"
            | "markdown"
            | "log"
            | "json"
            | "jsonl"
            | "toml"
            | "yaml"
            | "yml"
            | "xml"
            | "csv"
            | "tsv"
            | "ini"
            | "conf"
            | "cfg"
            | "env"
            | "gitignore"
            | "gitattributes"
            | "rs"
            | "js"
            | "mjs"
            | "cjs"
            | "ts"
            | "tsx"
            | "jsx"
            | "vue"
            | "css"
            | "scss"
            | "less"
            | "py"
            | "pyi"
            | "go"
            | "c"
            | "h"
            | "cpp"
            | "hpp"
            | "cc"
            | "cs"
            | "java"
            | "kt"
            | "swift"
            | "rb"
            | "php"
            | "sh"
            | "bash"
            | "ps1"
            | "psm1"
            | "bat"
            | "cmd"
            | "sql"
            | "lock"
            | "dockerfile"
            | "makefile"
            | "r"
            | "tex"
    )
}

fn image_mime(ext: &str, bytes: &[u8]) -> Option<&'static str> {
    match ext {
        "png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => Some("image/png"),
        "jpg" | "jpeg" if bytes.starts_with(b"\xff\xd8\xff") => Some("image/jpeg"),
        "gif" if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") => Some("image/gif"),
        "webp" if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" => {
            Some("image/webp")
        }
        _ => None,
    }
}

fn read_preview(path: &Path) -> Result<Preview, String> {
    if !ordinary_path(path) {
        return Ok(Preview::unavailable("unsafe-path"));
    }
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Ok(Preview::unsupported());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Do not hydrate online-only cloud documents implicitly. Cached cloud
        // files are checked by reparse tag on the opened handle below.
        if metadata.file_attributes() & (0x1000 | 0x40000 | 0x400000) != 0 {
            return Ok(Preview::unavailable("cloud-not-local"));
        }
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if ext == "doc" {
        return Ok(Preview::unavailable("legacy-word"));
    }
    if matches!(ext.as_str(), "xls" | "ods") { return Ok(Preview::unavailable("legacy-sheet")); }
    let is_image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp");
    let is_pdf = ext == "pdf";
    let is_docx = matches!(ext.as_str(), "docx" | "docm" | "dotx" | "dotm");
    let is_sheet = matches!(ext.as_str(), "xlsx" | "xlsm" | "xltx" | "xltm" | "xlsb" | "csv" | "tsv");
    if !is_image && !is_pdf && !is_docx && !is_sheet && !text_extension(&ext) {
        return Ok(Preview::unsupported());
    }
    let limit = match ext.as_str() {
        "pdf" => PDF_LIMIT,
        _ if is_docx => DOCX_LIMIT,
        _ if is_sheet => SHEET_LIMIT,
        _ if is_image => IMAGE_LIMIT,
        _ => TEXT_LIMIT,
    };
    if (is_image || is_pdf || is_docx || is_sheet) && metadata.len() > limit as u64 {
        return Ok(Preview::unavailable("size-limit"));
    }
    let file = match open_regular_file(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::InvalidInput => return Ok(Preview::unavailable("reparse-point")),
        Err(error) => return Err(error.to_string()),
    };
    // Recheck the opened object in case the path changed between metadata/open.
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Ok(Preview::unsupported());
    }
    let mut bytes = Vec::new();
    file.take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let truncated = bytes.len() > limit;
    if (is_pdf || is_docx || is_sheet) && truncated {
        return Ok(Preview::unavailable("size-limit"));
    }
    if is_pdf {
        // Some producers prepend a BOM or transport preamble. PDF.js accepts
        // a header within the first 1024 bytes; keep offsets intact.
        if !bytes[..bytes.len().min(1024)].windows(5).any(|w| w == b"%PDF-") {
            return Ok(Preview::unavailable("invalid-document"));
        }
        return Ok(Preview {
            kind: "pdf",
            content: base64(&bytes),
            truncated: false,
            reason: None,
        });
    }
    if is_docx {
        return Ok(match read_docx(&bytes) {
            Ok((content, truncated)) => Preview {
                kind: "document",
                content,
                truncated,
                reason: None,
            },
            Err(reason) => Preview::unavailable(reason),
        });
    }
    if is_sheet {
        return Ok(match sheets::read(&bytes, &ext) {
            Ok(workbook) => Preview { kind: "spreadsheet", content: serde_json::to_string(&workbook).map_err(|e| e.to_string())?, truncated: false, reason: None },
            Err(reason) => Preview::unavailable(reason),
        });
    }
    if is_image {
        if truncated {
            return Ok(Preview::unavailable("size-limit"));
        }
        let Some(mime) = image_mime(&ext, &bytes) else {
            return Ok(Preview::unsupported());
        };
        return Ok(Preview {
            kind: "image",
            content: format!("data:{mime};base64,{}", base64(&bytes)),
            truncated: false,
            reason: None,
        });
    }
    bytes.truncate(limit);
    let Some(content) = decode_text(&bytes, truncated) else {
        return Ok(Preview::unsupported());
    };
    Ok(Preview {
        kind: "text",
        content,
        truncated,
        reason: None,
    })
}

// Only the main Word body is read. Relationships, embedded files, images and
// macros are never opened; nothing is extracted to disk or fetched remotely.
fn read_docx(bytes: &[u8]) -> Result<(String, bool), &'static str> {
    if bytes.starts_with(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1") {
        // Password protected OOXML is wrapped in an OLE compound file.
        return Err("encrypted-document");
    }
    check_docx_directory(bytes)?;
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "invalid-document")?;
    if archive.len() > 4096 {
        return Err("complex-document");
    }
    let main = docx_main_part(&mut archive)?;
    let xml = read_docx_part(&mut archive, &main, DOCX_XML_LIMIT)?;
    parse_docx_xml(&xml)
}

fn docx_main_part(archive: &mut zip::ZipArchive<Cursor<&[u8]>>) -> Result<String, &'static str> {
    // OPC permits the main part at a different package path. Resolve only the
    // root officeDocument relationship, never external links or macros.
    if archive.index_for_name("_rels/.rels").is_none() { return Ok("word/document.xml".into()); }
    let bytes = read_docx_part(archive, "_rels/.rels", 64 * 1024)?;
    let xml = decode_text(&bytes, false).ok_or("invalid-document")?;
    let mut reader = quick_xml::Reader::from_str(&xml);
    loop {
        match reader.read_event().map_err(|_| "invalid-document")? {
            quick_xml::events::Event::DocType(_) => return Err("invalid-document"),
            quick_xml::events::Event::Start(tag) | quick_xml::events::Event::Empty(tag) if tag.local_name().as_ref() == "Relationship" => {
                let mut kind = String::new(); let mut target = String::new(); let mut external = false;
                for attr in tag.attributes() {
                    let attr = attr.map_err(|_| "invalid-document")?;
                    let value = attr.normalized_value(quick_xml::XmlVersion::Implicit1_0).map_err(|_| "invalid-document")?;
                    match attr.key.as_ref() { "Type" => kind = value.into_owned(), "Target" => target = value.into_owned(), "TargetMode" => external = value.eq_ignore_ascii_case("External"), _ => () }
                }
                if matches!(kind.as_str(), "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" | "http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument") {
                    let target = target.trim_start_matches('/');
                    if external || target.is_empty() || target.contains([':', '\\']) || target.split('/').any(|p| p == "..") { return Err("invalid-document"); }
                    return Ok(target.to_owned());
                }
            }
            quick_xml::events::Event::Eof => return Err("invalid-document"),
            _ => ()
        }
    }
}

// Bound the central-directory allocation before handing an archive to the ZIP
// library. Packages requiring ZIP64 or over 4096 parts exceed preview's scope.
fn check_docx_directory(bytes: &[u8]) -> Result<(), &'static str> {
    if bytes.len() < 22 || !bytes.starts_with(b"PK\x03\x04") {
        return Err("invalid-document");
    }
    let start = bytes.len().saturating_sub(22 + u16::MAX as usize);
    let end = (start..=bytes.len() - 22)
        .rev()
        .find(|&p| {
            bytes[p..].starts_with(b"PK\x05\x06")
                && p + 22 + u16::from_le_bytes([bytes[p + 20], bytes[p + 21]]) as usize
                    == bytes.len()
        })
        .ok_or("invalid-document")?;
    let word = |offset| u16::from_le_bytes([bytes[end + offset], bytes[end + offset + 1]]);
    if word(4) != 0 || word(6) != 0 || word(8) != word(10) {
        return Err("invalid-document");
    }
    if word(10) > 4096 {
        return Err("complex-document");
    }
    let dword = |offset| {
        u32::from_le_bytes(bytes[end + offset..end + offset + 4].try_into().unwrap()) as usize
    };
    let directory_size = dword(12);
    let directory_start = dword(16);
    if directory_size > DOCX_XML_LIMIT {
        return Err("complex-document");
    }
    if directory_start.checked_add(directory_size) != Some(end) {
        return Err("invalid-document");
    }
    let mut position = directory_start;
    for _ in 0..word(10) {
        if position.checked_add(46).is_none_or(|v| v > end)
            || !bytes[position..].starts_with(b"PK\x01\x02")
        {
            return Err("invalid-document");
        }
        let length = |offset| {
            u16::from_le_bytes([bytes[position + offset], bytes[position + offset + 1]]) as usize
        };
        position += 46 + length(28) + length(30) + length(32);
        if position > end {
            return Err("invalid-document");
        }
    }
    if position != end {
        return Err("invalid-document");
    }
    Ok(())
}

fn read_docx_part(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    name: &str,
    limit: usize,
) -> Result<Vec<u8>, &'static str> {
    let part = archive.by_name(name).map_err(|error| match error {
        zip::result::ZipError::UnsupportedArchive(zip::result::ZipError::PASSWORD_REQUIRED) => {
            "encrypted-document"
        }
        _ => "invalid-document",
    })?;
    if part.size() > limit as u64 {
        return Err("complex-document");
    }
    let mut bytes = Vec::new();
    part.take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "invalid-document")?;
    if bytes.len() > limit {
        return Err("complex-document");
    }
    Ok(bytes)
}

fn parse_docx_xml(bytes: &[u8]) -> Result<(String, bool), &'static str> {
    use quick_xml::events::Event;
    use quick_xml::name::ResolveResult;
    use quick_xml::reader::NsReader;

    // Word normally writes UTF-8; BOM-marked UTF-16 is accepted as well.
    let xml = decode_text(bytes, false).ok_or("invalid-document")?;
    let mut reader = NsReader::from_str(&xml);
    let mut output = String::new();
    let mut truncated = false;
    let mut depth = 0usize;
    let mut body_depth = None;
    let mut text_depth = None;
    let mut property_depth = None;
    let mut run_depths = Vec::new();
    let mut root_seen = false;
    let mut body_seen = false;
    loop {
        let (namespace, event) = reader
            .read_resolved_event()
            .map_err(|_| "invalid-document")?;
        let word = matches!(namespace, ResolveResult::Bound(ns) if matches!(ns.as_ref(),
            "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            | "http://purl.oclc.org/ooxml/wordprocessingml/main"));
        match event {
            Event::DocType(_) => return Err("invalid-document"),
            Event::Start(ref tag) | Event::Empty(ref tag) => {
                let empty = matches!(event, Event::Empty(_));
                let name = tag.local_name();
                if depth == 0 {
                    if root_seen || !word || name.as_ref() != "document" {
                        return Err("invalid-document");
                    }
                    root_seen = true;
                }
                if word && name.as_ref() == "body" && depth == 1 {
                    if body_seen {
                        return Err("invalid-document");
                    }
                    body_seen = true;
                    if !empty {
                        body_depth = Some(depth + 1);
                    }
                }
                if word && body_depth.is_some() {
                    // Identical element names can describe formatting rather
                    // than content: pPr/tabs/tab configures a tab stop.
                    if !empty
                        && property_depth.is_none()
                        && matches!(
                            name.as_ref(),
                            "pPr" | "rPr" | "tblPr" | "trPr" | "tcPr" | "sectPr" | "tblPrEx"
                        )
                    {
                        property_depth = Some(depth + 1);
                    }
                    if property_depth.is_none() {
                        if name.as_ref() == "r" && !empty {
                            run_depths.push(depth + 1);
                        } else if run_depths.last() == Some(&depth) {
                            match name.as_ref() {
                                "t" if !empty => text_depth = Some(depth + 1),
                                "tab" => append_document_text(&mut output, "\t", &mut truncated),
                                "br" | "cr" => {
                                    append_document_text(&mut output, "\n", &mut truncated)
                                }
                                _ => (),
                            }
                        }
                        if empty && name.as_ref() == "p" {
                            append_document_text(&mut output, "\n", &mut truncated);
                        }
                    }
                }
                if !empty {
                    depth += 1;
                    if depth > 256 {
                        return Err("complex-document");
                    }
                }
            }
            Event::End(tag) => {
                if word && body_depth.is_some() && property_depth.is_none() {
                    match tag.local_name().as_ref() {
                        "p" => append_document_text(&mut output, "\n", &mut truncated),
                        "tc" => {
                            if !truncated {
                                while output.ends_with('\n') {
                                    output.pop();
                                }
                            }
                            append_document_text(&mut output, "\t", &mut truncated);
                        }
                        "tr" => {
                            if !truncated && output.ends_with('\t') {
                                output.pop();
                            }
                            append_document_text(&mut output, "\n", &mut truncated);
                        }
                        _ => (),
                    }
                }
                if text_depth == Some(depth) {
                    text_depth = None;
                }
                if property_depth == Some(depth) {
                    property_depth = None;
                }
                if run_depths.last() == Some(&depth) {
                    run_depths.pop();
                }
                if body_depth == Some(depth) {
                    body_depth = None;
                }
                depth = depth.checked_sub(1).ok_or("invalid-document")?;
            }
            Event::Text(text) if text_depth == Some(depth) => {
                append_document_text(&mut output, &text, &mut truncated);
            }
            Event::CData(text) if text_depth == Some(depth) => {
                append_document_text(&mut output, &text, &mut truncated);
            }
            Event::GeneralRef(reference) => {
                let character = match reference
                    .resolve_char_ref()
                    .map_err(|_| "invalid-document")?
                {
                    Some(c) => c,
                    None => match reference.as_ref() {
                        "amp" => '&',
                        "lt" => '<',
                        "gt" => '>',
                        "quot" => '"',
                        "apos" => '\'',
                        _ => return Err("invalid-document"),
                    },
                };
                if character.is_control() && !matches!(character, '\t' | '\r' | '\n') {
                    return Err("invalid-document");
                }
                if text_depth == Some(depth) {
                    append_document_text(
                        &mut output,
                        character.encode_utf8(&mut [0; 4]),
                        &mut truncated,
                    );
                }
            }
            Event::Eof => break,
            _ => (),
        }
    }
    if !root_seen || !body_seen || depth != 0 {
        return Err("invalid-document");
    }
    Ok((
        output.trim_end_matches(['\r', '\n', '\t']).to_owned(),
        truncated,
    ))
}

fn append_document_text(output: &mut String, text: &str, truncated: &mut bool) {
    if *truncated {
        return;
    }
    let mut length = text
        .len()
        .min(DOCUMENT_TEXT_LIMIT.saturating_sub(output.len()));
    while !text.is_char_boundary(length) {
        length -= 1;
    }
    output.push_str(&text[..length]);
    *truncated |= length < text.len();
}

pub(crate) fn open_regular_file(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        // FILE_FLAG_OPEN_REPARSE_POINT: do not follow a symlink swapped in
        // after the initial metadata check.
        options.custom_flags(0x00200000);
    }
    let file = options.open(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::Storage::FileSystem::{GetFileType, FILE_TYPE_DISK, GetFileInformationByHandleEx, FileAttributeTagInfo, FILE_ATTRIBUTE_TAG_INFO};
        let disk = unsafe { GetFileType(HANDLE(file.as_raw_handle())) == FILE_TYPE_DISK };
        let metadata = file.metadata()?;
        let mut allowed = metadata.file_attributes() & 0x400 == 0;
        if !allowed {
            let mut info = FILE_ATTRIBUTE_TAG_INFO::default();
            let result = unsafe { GetFileInformationByHandleEx(HANDLE(file.as_raw_handle()), FileAttributeTagInfo, &mut info as *mut _ as *mut _, std::mem::size_of_val(&info) as u32) };
            allowed = result.is_ok() && info.ReparseTag & 0xffff0fff == 0x9000001a;
        }
        if !disk || !allowed || metadata.file_attributes() & (0x1000 | 0x40000 | 0x400000) != 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "preview requires a regular disk file",
            ));
        }
    }
    Ok(file)
}

fn decode_text(bytes: &[u8], truncated: bool) -> Option<String> {
    let text = if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little = bytes[0] == 0xff;
        let data = &bytes[2..];
        if data.len() % 2 != 0 && !truncated {
            return None;
        }
        let mut units: Vec<u16> = data
            .chunks_exact(2)
            .map(|b| {
                if little {
                    u16::from_le_bytes([b[0], b[1]])
                } else {
                    u16::from_be_bytes([b[0], b[1]])
                }
            })
            .collect();
        if truncated && units.last().is_some_and(|u| (0xd800..=0xdbff).contains(u)) {
            units.pop();
        }
        String::from_utf16(&units).ok()?
    } else {
        let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
        match std::str::from_utf8(bytes) {
            Ok(s) => s.to_owned(),
            Err(e) if truncated && e.error_len().is_none() => {
                std::str::from_utf8(&bytes[..e.valid_up_to()])
                    .ok()?
                    .to_owned()
            }
            Err(_) => return None,
        }
    };
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\t' | '\n' | '\r' | '\x0c'))
    {
        return None;
    }
    Some(text)
}

pub(crate) fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let a = chunk[0];
        let b = chunk.get(1).copied().unwrap_or(0);
        let c = chunk.get(2).copied().unwrap_or(0);
        out.push(TABLE[(a >> 2) as usize] as char);
        out.push(TABLE[(((a & 3) << 4) | (b >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 {
            TABLE[(((b & 15) << 2) | (c >> 6)) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[(c & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "dalizi-preview-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn preview(&self, name: &str, bytes: &[u8]) -> Preview {
            let path = self.0.join(name);
            fs::write(&path, bytes).unwrap();
            read_preview(&path).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn unicode_and_binary_detection() {
        let f = Fixture::new();
        assert_eq!(f.preview("中文.txt", "中文😀".as_bytes()).content, "中文😀");
        assert_eq!(
            decode_text(b"\xef\xbb\xbfhello", false).as_deref(),
            Some("hello")
        );
        for little in [true, false] {
            let mut bytes = if little {
                vec![0xff, 0xfe]
            } else {
                vec![0xfe, 0xff]
            };
            for u in "中文😀".encode_utf16() {
                bytes.extend(if little {
                    u.to_le_bytes()
                } else {
                    u.to_be_bytes()
                });
            }
            assert_eq!(f.preview("unicode.txt", &bytes).content, "中文😀");
        }
        assert_eq!(f.preview("binary", b"abc\0def").kind, "unsupported");
        assert_eq!(f.preview("bad.txt", &[0xff, 0x80]).kind, "unsupported");
        assert_eq!(f.preview("active.svg", b"<svg/>").kind, "unsupported");
        assert_eq!(f.preview("active.html", b"<script/>").kind, "unsupported");
        assert_eq!(read_preview(&f.0).unwrap().kind, "unsupported");
    }
    #[test]
    fn text_size_boundary_preserves_complete_unicode() {
        let f = Fixture::new();
        let exact = f.preview("exact.txt", &vec![b'x'; TEXT_LIMIT]);
        assert!(!exact.truncated);
        assert_eq!(exact.content.len(), TEXT_LIMIT);
        let mut data = vec![b'x'; TEXT_LIMIT - 1];
        data.extend_from_slice("中文".as_bytes());
        let p = f.preview("long.txt", &data);
        assert!(p.truncated);
        assert_eq!(p.content.len(), TEXT_LIMIT - 1);
        let mut bytes = vec![0xff, 0xfe];
        bytes.extend(std::iter::repeat_n(0x41u16, (TEXT_LIMIT - 4) / 2).flat_map(u16::to_le_bytes));
        bytes.extend("😀".encode_utf16().flat_map(u16::to_le_bytes));
        let p = f.preview("utf16.txt", &bytes);
        assert!(p.truncated);
        assert!(!p.content.contains('\u{fffd}'));
    }
    #[test]
    fn image_size_type_and_encoding_limits() {
        let f = Fixture::new();
        let mut bytes = vec![0; IMAGE_LIMIT];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        let p = f.preview("exact.png", &bytes);
        assert_eq!(p.kind, "image");
        assert!(p.content.starts_with("data:image/png;base64,iVBORw0KGgo"));
        bytes.push(0);
        assert_eq!(f.preview("large.png", &bytes).kind, "unsupported");
        assert_eq!(f.preview("fake.png", b"<svg/>").kind, "unsupported");
        for (input, output) in [
            ("", ""),
            ("f", "Zg=="),
            ("fo", "Zm8="),
            ("foo", "Zm9v"),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64(input.as_bytes()), output);
        }
    }
    #[test]
    fn device_paths_are_rejected_without_opening() {
        for p in [
            r"\\.\pipe\test",
            r"\\?\GLOBALROOT\Device\x",
            r"C:\NUL",
            r"C:\work\CON.txt",
            r"C:\work\COM1",
            r"\\server\pipe\name",
            r"C:\work\text.txt:stream",
        ] {
            assert!(!ordinary_path(Path::new(p)), "{p}");
        }
    }

    fn docx(xml: &[u8]) -> Vec<u8> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;
        let mut archive = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        archive.start_file("word/document.xml", options).unwrap();
        archive.write_all(xml).unwrap();
        archive.finish().unwrap().into_inner()
    }

    fn word_body(body: &str) -> String {
        format!(
            r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{body}</w:body></w:document>"#
        )
    }

    #[test]
    fn office_variants_and_package_relationships_are_resolved_without_external_access() {
        use std::io::Write;
        let f = Fixture::new();
        let body = word_body("<w:p><w:r><w:t>兼容正文</w:t></w:r></w:p>");
        for extension in ["DOCX", "docm", "dotx", "dotm"] {
            assert_eq!(f.preview(&format!("example.{extension}"), &docx(body.as_bytes())).content, "兼容正文");
        }
        for (target, mode, expected) in [("custom/main.xml", "", "document"), ("https://example.invalid/file", "External", "unsupported"), ("../outside.xml", "", "unsupported")] {
            let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
            zip.start_file("_rels/.rels", zip::write::SimpleFileOptions::default()).unwrap();
            write!(zip, r#"<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="{target}" TargetMode="{mode}"/></Relationships>"#).unwrap();
            zip.start_file("custom/main.xml", zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(body.as_bytes()).unwrap();
            assert_eq!(f.preview("relocated.docx", &zip.finish().unwrap().into_inner()).kind, expected);
        }
    }

    #[test]
    fn pdf_preamble_and_ordinary_extended_paths_are_supported() {
        let f = Fixture::new();
        assert_eq!(f.preview("preamble.PDF", b"\xef\xbb\xbf\r\n%PDF-1.7\n%%EOF").kind, "pdf");
        assert!(ordinary_path(Path::new(r"\\?\C:\folder\book.pdf")));
        assert!(ordinary_path(Path::new(r"\\?\UNC\server\share\book.docx")));
        assert!(!ordinary_path(Path::new(r"\\?\UNC\server\pipe\name")));
    }

    #[test]
    fn pdf_payload_validation_and_file_limits() {
        let f = Fixture::new();
        let bytes = b"%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF";
        let preview = f.preview("example.pdf", bytes);
        assert_eq!(preview.kind, "pdf");
        assert_eq!(preview.content, base64(bytes));
        assert_eq!(preview.reason, None);
        assert_eq!(
            f.preview("fake.pdf", b"<script/>").reason,
            Some("invalid-document")
        );
        // Sparse oversized files verify rejection before allocating/reading payloads.
        for (name, limit) in [("large.pdf", PDF_LIMIT), ("large.docx", DOCX_LIMIT)] {
            let path = f.0.join(name);
            File::create(&path)
                .unwrap()
                .set_len(limit as u64 + 1)
                .unwrap();
            assert_eq!(read_preview(&path).unwrap().reason, Some("size-limit"));
        }
    }

    #[test]
    fn docx_extracts_unicode_paragraphs_tables_and_escaped_text() {
        let f = Fixture::new();
        let xml = word_body(
            r#"<w:p><w:r><w:t xml:space="preserve">中文😀 &amp; &lt;script&gt; &#x41; &#66;</w:t><w:tab/><w:t>end</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:instrText>HYPERLINK external</w:instrText><w:delText>deleted</w:delText><w:t>last</w:t><w:br/><w:t><![CDATA[<safe>]]></w:t></w:r></w:p>"#,
        );
        let preview = f.preview("文字.docx", &docx(xml.as_bytes()));
        assert_eq!(preview.kind, "document");
        assert_eq!(
            preview.content,
            "中文😀 & <script> A B\tend\nA\tB\nlast\n<safe>"
        );
        assert!(!preview.truncated);
        let alternate = xml
            .replace("w:", "word:")
            .replace("xmlns:w=", "xmlns:word=");
        assert_eq!(
            parse_docx_xml(alternate.as_bytes()).unwrap().0,
            preview.content
        );
        let strict = xml.replace(
            "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
            "http://purl.oclc.org/ooxml/wordprocessingml/main",
        );
        assert_eq!(
            parse_docx_xml(strict.as_bytes()).unwrap().0,
            preview.content
        );
        let mut utf16 = vec![0xff, 0xfe];
        utf16.extend(xml.encode_utf16().flat_map(u16::to_le_bytes));
        assert_eq!(parse_docx_xml(&utf16).unwrap().0, preview.content);
    }

    #[test]
    fn docx_distinguishes_tab_stops_from_run_content_and_preserves_empty_paragraphs() {
        let f = Fixture::new();
        let xml = word_body(
            r#"
            <w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>
                <w:r><w:rPr><w:b/></w:rPr><w:t>first</w:t></w:r></w:p>
            <w:p/>
            <w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t><w:cr/><w:t>D</w:t></w:r></w:p>
            <w:p><w:r><w:rPr><w:tab/><w:br/><w:t>formatting</w:t><w:r><w:t>nested formatting</w:t></w:r></w:rPr><w:t>last</w:t></w:r></w:p>
            <w:t>not in a run</w:t><w:tab/>
        "#,
        );
        let preview = f.preview("tabs.docx", &docx(xml.as_bytes()));
        assert_eq!(preview.kind, "document");
        assert_eq!(preview.content, "first\n\nA\tB\nC\nD\nlast");
        assert!(!preview.truncated);
    }

    #[test]
    fn docx_rejects_corrupt_legacy_encrypted_and_entity_documents() {
        let f = Fixture::new();
        assert_eq!(
            f.preview("legacy.doc", b"anything").reason,
            Some("legacy-word")
        );
        assert_eq!(
            f.preview("encrypted.docx", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1")
                .reason,
            Some("encrypted-document")
        );
        assert_eq!(
            f.preview("broken.docx", b"PK\x03\x04").reason,
            Some("invalid-document")
        );
        for xml in [
            word_body("<w:p><w:r><w:t>unclosed"),
            word_body("<w:p><w:r><w:t>&unknown;</w:t></w:r></w:p>"),
            word_body("<w:p><w:r><w:t>&#0;</w:t></w:r></w:p>"),
            format!(
                "<!DOCTYPE document [<!ENTITY external SYSTEM 'file:///C:/secret'>]>{}",
                word_body("<w:p><w:r><w:t>&external;</w:t></w:r></w:p>")
            ),
            "<document><body><t>fake namespace</t></body></document>".to_owned(),
        ] {
            assert_eq!(
                f.preview("invalid.docx", &docx(xml.as_bytes())).reason,
                Some("invalid-document"),
                "{xml}"
            );
        }
    }

    #[test]
    fn docx_bounds_zip_expansion_depth_output_and_directory() {
        let f = Fixture::new();
        let bomb = docx(&vec![b'x'; DOCX_XML_LIMIT + 1]);
        assert!(bomb.len() < 10_000);
        assert_eq!(
            f.preview("bomb.docx", &bomb).reason,
            Some("complex-document")
        );
        let large_text = "😀".repeat(DOCUMENT_TEXT_LIMIT / 4 + 1);
        let xml = word_body(&format!("<w:p><w:r><w:t>{large_text}</w:t></w:r></w:p>"));
        let preview = f.preview("truncated.docx", &docx(xml.as_bytes()));
        assert_eq!(preview.kind, "document");
        assert!(preview.truncated);
        assert_eq!(preview.content.len(), DOCUMENT_TEXT_LIMIT);
        assert!(preview.content.ends_with('😀'));
        let deep = word_body(&format!("{}{}", "<w:r>".repeat(256), "</w:r>".repeat(256)));
        assert_eq!(parse_docx_xml(deep.as_bytes()), Err("complex-document"));
        let mut too_many = docx(word_body("").as_bytes());
        let end = too_many.len() - 22;
        too_many[end + 8..end + 10].copy_from_slice(&4097u16.to_le_bytes());
        too_many[end + 10..end + 12].copy_from_slice(&4097u16.to_le_bytes());
        assert_eq!(read_docx(&too_many), Err("complex-document"));
        let mut false_directory = docx(word_body("").as_bytes());
        let end = false_directory.len() - 22;
        false_directory[end + 16..end + 20].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(read_docx(&false_directory), Err("invalid-document"));
    }
}
