#![cfg(windows)]
use dalizi_harness_client::snapshot::{capture, identify};
use std::fs;

#[test]
fn review_freezes_only_selected_text_even_if_file_changes() {
    let root = tempfile::tempdir().unwrap();
    fs::write(root.path().join("需求.md"), "A").unwrap();
    fs::write(root.path().join("unselected.txt"), "private").unwrap();
    let preview = capture(root.path(), &["需求.md".into()]).unwrap();
    fs::write(root.path().join("需求.md"), "B").unwrap();
    assert_eq!(preview.files.len(), 1);
    assert_eq!(preview.files[0].text, "A");
    assert_eq!(preview.workspace, identify(root.path()).unwrap());
}

#[test]
fn replacement_directory_does_not_inherit_tasks_under_the_same_name() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("project");
    fs::create_dir(&root).unwrap();
    let first = identify(&root).unwrap();
    fs::rename(&root, parent.path().join("original")).unwrap();
    fs::create_dir(&root).unwrap();
    let next = identify(&root).unwrap();
    assert_eq!(first.path, next.path);
    assert_ne!(first.identity, next.identity);
}

#[test]
fn aliases_reserved_paths_and_invalid_content_are_not_snapshots() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("project");
    fs::create_dir(&root).unwrap();
    let outside = parent.path().join("outside.txt");
    fs::write(&outside, "outside").unwrap();
    fs::hard_link(outside, root.join("hardlink.md")).unwrap();
    fs::write(root.join("binary.md"), [0, 4]).unwrap();
    fs::write(root.join("invalid.txt"), [0xff]).unwrap();
    fs::write(root.join("large.txt"), vec![0x61_u8; 32769]).unwrap();
    fs::create_dir(root.join(".dalizi")).unwrap();
    fs::write(root.join(".dalizi/private.md"), "private").unwrap();
    for name in [
        "../outside.txt",
        "hardlink.md",
        "binary.md",
        "invalid.txt",
        "large.txt",
        ".dalizi/private.md",
        "shell.exe",
        "NUL.txt",
        "data.txt:stream",
    ] {
        assert!(capture(&root, &[name.into()]).is_err(), "{name}");
    }
}

#[test]
fn batch_limit_is_applied_to_the_combined_utf8_bytes() {
    let root = tempfile::tempdir().unwrap();
    let names = ["1.md".into(), "2.md".into(), "3.md".into()];
    for name in &names {
        fs::write(root.path().join(name), "文".repeat(10000)).unwrap();
    }
    assert!(capture(root.path(), &names[..2]).is_ok());
    assert!(capture(root.path(), &names).is_err());
}
