//! Editable snapshots of built-in instructions. Only explicit saves modify the global profile.
use super::{blocking, builtin, store, Skill, SkillView, Store, StoredProfile};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CopyInfo {
    source_id: String,
    version: String,
    revision: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CopyInput {
    id: String,
    source_id: String,
    expected_revision: Option<String>,
    base_copy: Option<CopyBase>,
    name: String,
    description: String,
    body: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CopyBase {
    id: String,
    version: String,
}

// The v2 path field records the source of a snapshot. Imported paths are absolute
// filesystem paths. For copies it holds a versioned URI and is never opened.
fn origin(skill: &Skill) -> Option<(&str, &str)> {
    let path = skill
        .path
        .strip_prefix("builtin://")?
        .strip_suffix("/SKILL.md")?;
    let (slug, version) = path.split_once('/')?;
    (!slug.is_empty() && !version.is_empty() && !version.contains('/')).then_some((slug, version))
}

pub(super) fn represents(skill: &Skill, id: &str) -> bool {
    origin(skill).is_some_and(|(slug, _)| id.strip_prefix("builtin.") == Some(slug))
}

pub(super) fn revision(skill: &Skill) -> String {
    let mut digest = Sha256::new();
    // Toggling a skill does not change the text that the editor loaded.
    for field in [&skill.path, &skill.name, &skill.description, &skill.body] {
        digest.update((field.len() as u64).to_le_bytes());
        digest.update(field.as_bytes());
    }
    format!("{:x}", digest.finalize())
}

pub(super) fn verify_selection(
    data: &StoredProfile,
    ids: &[String],
    revisions: &std::collections::HashMap<String, String>,
) -> Result<(), String> {
    for (id, expected) in revisions {
        let copy = data
            .skills
            .iter()
            .find(|skill| &skill.id == id && skill.enabled);
        if !ids.contains(id)
            || !copy.is_some_and(|skill| origin(skill).is_some() && revision(skill) == *expected)
        {
            return Err("所选技能副本已变化，请核对后重新发送 / Selected skill copy changed. Review it and resend.".into());
        }
    }
    Ok(())
}

pub(super) fn info(skill: &Skill) -> Option<CopyInfo> {
    let (slug, version) = origin(skill)?;
    Some(CopyInfo {
        source_id: format!("builtin.{slug}"),
        version: version.to_owned(),
        revision: revision(skill),
    })
}

impl Store {
    fn save_copy(&mut self, input: CopyInput) -> Result<Skill, String> {
        if !input
            .id
            .strip_prefix("copy-")
            .is_some_and(|id| id.len() == 36 && uuid::Uuid::parse_str(id).is_ok())
        {
            return Err("无效的副本 ID / Invalid copy ID".into());
        }
        self.mutate(move |data| {
            let name = input.name.trim().to_owned();
            let description = input.description.trim().to_owned();
            if let Some(existing) = data.skills.iter_mut().find(|skill| skill.id == input.id) {
                if !represents(existing, &input.source_id) {
                    return Err("副本来源不一致 / Copy source has changed".into());
                }
                if existing.name == name && existing.description == description && existing.body == input.body {
                    return Ok(existing.clone());
                }
                if input.expected_revision.as_deref() != Some(revision(existing).as_str()) {
                    return Err("副本已被修改。请保存为另一份副本，或重新打开最新版本。 / Copy changed. Save a separate copy or reopen the latest version.".into());
                }
                existing.name = name;
                existing.description = description;
                existing.body = input.body;
                return Ok(existing.clone());
            }
            if input.expected_revision.is_some() {
                return Err("副本已被移除。可保存为另一份副本。 / Copy was removed. You can save a separate copy.".into());
            }
            let base = input.base_copy.as_ref();
            let parent = base.and_then(|base| data.skills.iter().find(|s| s.id == base.id
                && represents(s, &input.source_id) && origin(s).is_some_and(|(_, v)| v == base.version)));
            let path = if let Some(parent) = parent {
                parent.path.clone()
            } else {
                let source = builtin::find(&input.source_id).ok_or("原技能已移除，可先复制草稿 / Original skill unavailable. You can copy your draft.")?;
                if base.is_some_and(|base| base.version != builtin::VERSION) {
                    return Err("原版本已移除，请先复制草稿 / Source version unavailable. You can copy your draft.".into());
                }
                let slug = source.id.trim_start_matches("builtin.");
                format!("builtin://{slug}/{}/SKILL.md", builtin::VERSION)
            };
            let skill = Skill {
                id: input.id, name, description, body: input.body, enabled: false, path,
            };
            data.skills.push(skill.clone());
            Ok(skill)
        })
    }
}

#[tauri::command]
pub async fn agent_skill_save_copy(input: CopyInput) -> Result<SkillView, String> {
    blocking(move || store()?.save_copy(input).map(SkillView::user)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_profile::{context_with_recommendations, ACTIVE_SKILLS, SKILL_COUNT};

    fn input(id: &str, body: &str, expected_revision: Option<String>) -> CopyInput {
        CopyInput {
            id: id.into(),
            source_id: "builtin.documentation".into(),
            expected_revision,
            base_copy: None,
            name: "My docs".into(),
            description: "Writing rules".into(),
            body: body.into(),
        }
    }

    #[test]
    fn edits_bind_to_the_read_text_and_keep_independent_toggles() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("profile.json");
        let mut store = Store::open(path.clone()).unwrap();
        let id = format!("copy-{}", uuid::Uuid::new_v4());
        let original = store.save_copy(input(&id, "old", None)).unwrap();
        assert!(!original.enabled);
        store.save_copy(input(&id, "old", None)).unwrap();
        assert_eq!(store.data.skills.len(), 1);
        let old = revision(&original);
        let mut second = Store::open(path.clone()).unwrap();
        second.set_skill(&id, true).unwrap();
        let updated = store
            .save_copy(input(&id, "new", Some(old.clone())))
            .unwrap();
        assert!(updated.enabled);
        assert!(second
            .save_copy(input(&id, "stale", Some(old.clone())))
            .is_err());
        let profile = Store::open(path).unwrap();
        assert_eq!(profile.data.skills[0].body, "new");
        let ids = vec![id.clone()];
        assert!(verify_selection(&profile.data, &ids, &[(id.clone(), old)].into()).is_err());
        verify_selection(
            &profile.data,
            &ids,
            &[(id.clone(), revision(&updated))].into(),
        )
        .unwrap();
        let context = context_with_recommendations(
            &profile.data,
            "C:\\work",
            &[],
            &ids,
            false,
            &["builtin.documentation", "builtin.task-planning"],
        )
        .unwrap();
        assert_eq!(
            context
                .skills
                .iter()
                .map(|s| s.id.as_str())
                .collect::<Vec<_>>(),
            [id.as_str(), "builtin.task-planning"]
        );
        assert_eq!(context.skills[0].body, "new");
        assert!(second
            .remove_skill(&id, Some(&revision(&original)))
            .is_err());
        second.remove_skill(&id, Some(&revision(&updated))).unwrap();
        assert!(store
            .save_copy(input(&id, "revived", Some(revision(&updated))))
            .is_err());
    }

    #[test]
    fn stored_copy_survives_catalog_updates_with_its_original_version_and_text() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("profile.json");
        let id = format!("copy-{}", uuid::Uuid::new_v4());
        let mut store = Store::open(path.clone()).unwrap();
        store
            .save_copy(input(&id, "My older instructions", None))
            .unwrap();
        store
            .mutate(|data| {
                data.skills[0].path = "builtin://documentation/0.9.0/SKILL.md".into();
                Ok(())
            })
            .unwrap();
        let view = Store::open(path).unwrap().view(None).unwrap();
        let copy = view.skills.iter().find(|s| s.skill.id == id).unwrap();
        assert_eq!(copy.copy.as_ref().unwrap().version, "0.9.0");
        assert_eq!(copy.skill.body, "My older instructions");
        assert!(!copy.skill.enabled);
        let builtin = view
            .skills
            .iter()
            .find(|s| s.skill.id == "builtin.documentation")
            .unwrap();
        assert_eq!(builtin.version, super::builtin::VERSION);
        assert_ne!(builtin.skill.body, copy.skill.body);
        let mut fork = input(&format!("copy-{}", uuid::Uuid::new_v4()), "Draft", None);
        fork.base_copy = Some(CopyBase {
            id,
            version: "0.9.0".into(),
        });
        assert_eq!(origin(&store.save_copy(fork).unwrap()).unwrap().1, "0.9.0");
    }

    #[test]
    fn copies_share_the_existing_capacity_and_can_be_edited_when_full() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path().join("profile.json")).unwrap();
        let mut ids = Vec::new();
        for i in 0..SKILL_COUNT {
            let id = format!("copy-{}", uuid::Uuid::new_v4());
            store.save_copy(input(&id, "base", None)).unwrap();
            if i < ACTIVE_SKILLS {
                store.set_skill(&id, true).unwrap();
            }
            ids.push(id);
        }
        let extra = format!("copy-{}", uuid::Uuid::new_v4());
        assert!(store
            .save_copy(input(&extra, "one too many", None))
            .is_err());
        assert!(store.set_skill(&ids[4], true).is_err());
        let rev = revision(&store.data.skills[0]);
        let edit = store
            .save_copy(input(&ids[0], "updated at capacity", Some(rev)))
            .unwrap();
        assert!(edit.enabled);
        assert_eq!(store.data.skills.len(), 32);
    }

    #[test]
    fn failed_saves_preserve_disk_contents_and_release_the_profile_lock() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("profile.json");
        let id = format!("copy-{}", uuid::Uuid::new_v4());
        let mut store = Store::open(path.clone()).unwrap();
        store.save_copy(input(&id, "working", None)).unwrap();
        let original = std::fs::read(&path).unwrap();
        let rev = revision(&store.data.skills[0]);
        assert!(store
            .save_copy(input(&id, &"界".repeat(21846), Some(rev.clone())))
            .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let lock = path.with_extension("lock");
        let held = std::fs::File::create_new(&lock).unwrap();
        assert!(store
            .save_copy(input(&id, "blocked", Some(rev.clone())))
            .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), original);
        drop(held);
        std::fs::remove_file(&lock).unwrap();
        store
            .save_copy(input(&id, "after retry", Some(rev)))
            .unwrap();
        assert!(!lock.exists());
    }
}
