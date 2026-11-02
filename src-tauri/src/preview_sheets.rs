//! Read-only, bounded spreadsheet previews; formulas/macros are never executed.
use super::{check_docx_directory, decode_text, read_docx_part};
use calamine::{DataRef, Reader, Xlsb, Xlsx};
use serde::Serialize;
use std::io::Cursor;

const ROWS: usize = 500;
const COLS: usize = 50;
const SHEETS: usize = 20;
const TEXT_BUDGET: usize = 2 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Workbook {
    sheets: Vec<Sheet>,
    truncated: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Sheet {
    name: String,
    rows: Vec<Vec<String>>,
    truncated: bool,
}

fn value(data: &DataRef<'_>) -> String {
    match data {
        DataRef::DateTime(date) => date.as_datetime().map(|d| d.to_string()).unwrap_or_else(|| date.to_string()),
        _ => calamine::Data::from(data.clone()).to_string(),
    }
}

fn put(sheet: &mut Sheet, row: usize, col: usize, text: &str, budget: &mut usize) {
    if row >= ROWS || col >= COLS || *budget == 0 { sheet.truncated = true; return; }
    let mut length = text.len().min(4096).min(*budget);
    while !text.is_char_boundary(length) { length -= 1; }
    sheet.truncated |= length < text.len();
    *budget -= length;
    sheet.rows.resize_with(sheet.rows.len().max(row + 1), Vec::new);
    let width = sheet.rows[row].len().max(col + 1);
    sheet.rows[row].resize(width, String::new());
    sheet.rows[row][col] = text[..length].to_owned();
}

pub(super) fn read(bytes: &[u8], ext: &str) -> Result<Workbook, &'static str> {
    if matches!(ext, "csv" | "tsv") { return delimited(bytes, ext); }
    if bytes.starts_with(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1") { return Err("encrypted-document"); }
    // Preflight the compressed package before the library allocates shared
    // strings/styles. Cell readers stream instead of allocating a dense range
    // using untrusted sheet dimensions (e.g. a single XFD1048576 cell).
    check_docx_directory(bytes)?;
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "invalid-document")?;
    let mut expanded = 0u64;
    let mut binary_parts = Vec::new();
    for i in 0..archive.len() {
        let part = archive.by_index(i).map_err(|error| match error {
            zip::result::ZipError::UnsupportedArchive(zip::result::ZipError::PASSWORD_REQUIRED) => "encrypted-document",
            _ => "invalid-document",
        })?;
        expanded = expanded.checked_add(part.size()).ok_or("complex-document")?;
        if part.size() > 32 * 1024 * 1024 || expanded > 64 * 1024 * 1024 { return Err("complex-document"); }
        let name = part.name().map_err(|_| "invalid-document")?;
        if ext == "xlsb" && (matches!(name.as_ref(), "xl/workbook.bin" | "xl/styles.bin" | "xl/sharedStrings.bin") || name.starts_with("xl/worksheets/") && name.ends_with(".bin")) {
            binary_parts.push(name.into_owned());
        }
    }
    for name in binary_parts { check_binary_records(&read_docx_part(&mut archive, &name, 32 * 1024 * 1024)?)?; }
    if archive.index_for_name("xl/sharedStrings.xml").is_some() {
        let strings = read_docx_part(&mut archive, "xl/sharedStrings.xml", 32 * 1024 * 1024)?;
        let text = decode_text(&strings, false).ok_or("invalid-document")?;
        let mut reader = quick_xml::Reader::from_str(&text);
        let mut count = 0;
        loop {
            match reader.read_event().map_err(|_| "invalid-document")? {
                quick_xml::events::Event::Start(tag) | quick_xml::events::Event::Empty(tag) => {
                    if tag.local_name().as_ref() == "sst" {
                        for attr in tag.attributes() {
                            let attr = attr.map_err(|_| "invalid-document")?;
                            if attr.key.as_ref() == "uniqueCount" && attr.value.parse::<usize>().map_err(|_| "invalid-document")? > 100_000 {
                                return Err("complex-document");
                            }
                        }
                    }
                    if tag.local_name().as_ref() == "si" { count += 1; if count > 100_000 { return Err("complex-document"); } }
                }
                quick_xml::events::Event::DocType(_) => return Err("invalid-document"),
                quick_xml::events::Event::Eof => break,
                _ => ()
            }
        }
    }
    drop(archive);
    let mut sheets = Vec::new();
    let mut budget = TEXT_BUDGET;
    macro_rules! collect {
        ($book:expr) => {{
            let mut book = $book.map_err(|_| "invalid-document")?;
            let names = book.sheet_names();
            let omitted = names.len() > SHEETS;
            for name in names.iter().take(SHEETS) {
                let mut sheet = Sheet { name: name.clone(), rows: Vec::new(), truncated: false };
                let mut cells = book.worksheet_cells_reader(name).map_err(|_| "invalid-document")?;
                let mut scanned = 0;
                while let Some(cell) = cells.next_cell().map_err(|_| "invalid-document")? {
                    let (row, col) = cell.get_position();
                    scanned += 1;
                    if row as usize >= ROWS || budget == 0 || scanned > ROWS * COLS * 4 {
                        sheet.truncated = true; break;
                    }
                    put(&mut sheet, row as usize, col as usize, &value(cell.get_value()), &mut budget);
                }
                sheets.push(sheet);
            }
            omitted
        }};
    }
    let truncated = if ext == "xlsb" { collect!(Xlsb::new(Cursor::new(bytes))) }
        else { collect!(Xlsx::new(Cursor::new(bytes))) };
    Ok(Workbook { truncated: truncated || sheets.iter().any(|s| s.truncated), sheets })
}

fn check_binary_records(bytes: &[u8]) -> Result<(), &'static str> {
    let mut pos = 0;
    while pos < bytes.len() {
        let first = bytes[pos]; pos += 1;
        if first & 128 != 0 { if pos >= bytes.len() { return Err("invalid-document"); } pos += 1; }
        let mut length = 0usize;
        for shift in 0..4 {
            let b = *bytes.get(pos).ok_or("invalid-document")?; pos += 1;
            length |= ((b & 127) as usize) << (7 * shift);
            if b & 128 == 0 { break; }
            if shift == 3 { return Err("invalid-document"); }
        }
        pos = pos.checked_add(length).filter(|end| *end <= bytes.len()).ok_or("invalid-document")?;
    }
    Ok(())
}

fn delimited(bytes: &[u8], ext: &str) -> Result<Workbook, &'static str> {
    // Chinese Excel commonly exports GB18030 CSV without a UTF-8 BOM.
    let text = decode_text(bytes, false).or_else(|| {
        if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) || bytes.contains(&0) { return None; }
        let (value, errors) = encoding_rs::GB18030.decode_without_bom_handling(bytes);
        (!errors && !value.chars().any(|c| c.is_control() && !matches!(c, '\r' | '\n' | '\t'))).then(|| value.into_owned())
    }).ok_or("text-encoding")?;
    let mut delimiter = if ext == "tsv" { b'\t' } else { b',' };
    let mut source = text.as_str();
    if let Some(first) = text.lines().next() {
        if first.len() == 5 && first.as_bytes()[..4].eq_ignore_ascii_case(b"sep=") && matches!(first.as_bytes()[4], b',' | b';' | b'\t' | b'|') {
            delimiter = first.as_bytes()[4];
            source = text.split_once('\n').map(|(_, rest)| rest).unwrap_or("");
        } else if ext == "csv" {
            // Compare parsed field counts, so delimiters in quoted text do not
            // win over the actual separator. Support regional Excel exports.
            let mut best = 1;
            for candidate in [b',', b';', b'\t'] {
                let count = csv::ReaderBuilder::new().has_headers(false).delimiter(candidate)
                    .from_reader(first.as_bytes()).records().next().and_then(Result::ok).map(|r| r.len()).unwrap_or(0);
                if count > best { best = count; delimiter = candidate; }
            }
        }
    }
    if source.bytes().filter(|&b| b == delimiter).take(1_000_001).count() > 1_000_000 { return Err("complex-document"); }
    let mut reader = csv::ReaderBuilder::new().has_headers(false).flexible(true).delimiter(delimiter).from_reader(source.as_bytes());
    let mut sheet = Sheet { name: "Data".into(), rows: Vec::new(), truncated: false };
    let mut budget = TEXT_BUDGET;
    for (row, record) in reader.records().enumerate() {
        let record = record.map_err(|_| "invalid-document")?;
        if row >= ROWS || budget == 0 { sheet.truncated = true; break; }
        for (col, text) in record.iter().enumerate() { put(&mut sheet, row, col, text, &mut budget); }
    }
    Ok(Workbook { truncated: sheet.truncated, sheets: vec![sheet] })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn csv_preserves_quotes_newlines_unicode_and_formula_text() {
        let book = read("名称,内容\r\n中文,\"a,b\n第二行\"\r\n公式,=1+1".as_bytes(), "csv").unwrap();
        assert_eq!(book.sheets[0].rows[1], ["中文", "a,b\n第二行"]);
        assert_eq!(book.sheets[0].rows[2][1], "=1+1");
        let (gb, _, _) = encoding_rs::GBK.encode("名称;金额\n梨;12");
        assert_eq!(read(&gb, "csv").unwrap().sheets[0].rows[1], ["梨", "12"]);
        assert_eq!(read(b"sep=;\r\na;b", "csv").unwrap().sheets[0].rows[0], ["a", "b"]);
    }
    #[test]
    fn table_output_has_row_column_and_text_budgets() {
        let text = (0..600).map(|_| vec!["v"; 60].join("\t")).collect::<Vec<_>>().join("\n");
        let book = read(text.as_bytes(), "tsv").unwrap();
        assert!(book.truncated);
        assert_eq!(book.sheets[0].rows.len(), ROWS);
        assert_eq!(book.sheets[0].rows[0].len(), COLS);
    }
    #[test]
    fn forged_shared_string_allocation_is_rejected_before_library_load() {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("xl/sharedStrings.xml", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(b"<sst uniqueCount=\"4000000000\"><si><t>x</t></si></sst>").unwrap();
        let bytes = zip.finish().unwrap().into_inner();
        assert!(matches!(read(&bytes, "xlsx"), Err("complex-document")));
    }
    #[test]
    fn binary_record_lengths_must_fit_the_decompressed_part() {
        assert!(check_binary_records(&[0, 1, 42]).is_ok());
        assert!(check_binary_records(&[0, 255, 255, 255, 127]).is_err());
        assert!(check_binary_records(&[128]).is_err());
    }
}
