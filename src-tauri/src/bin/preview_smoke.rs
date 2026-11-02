//! Local fixture driver for native preview + browser rendering integration.
#[path = "../preview.rs"]
mod preview;
fn main() {
    let mut results = serde_json::Map::new();
    for file in std::env::args().skip(1) {
        let name = std::path::Path::new(&file).file_name().unwrap().to_string_lossy().to_string();
        match tauri::async_runtime::block_on(preview::preview_file(file)) {
            Ok(value) => { results.insert(name, serde_json::to_value(value).unwrap()); }
            Err(error) => { eprintln!("{name}: {error}"); std::process::exit(1); }
        }
    }
    println!("{}", serde_json::Value::Object(results));
}
