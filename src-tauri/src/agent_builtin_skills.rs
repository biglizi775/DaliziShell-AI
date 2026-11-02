//! Immutable, offline instructions. These entries grant no tools or permissions.
pub(super) struct BuiltinSkill {
    pub id: &'static str,
    pub name: &'static str,
    pub path: &'static str,
    pub availability: &'static str,
    pub text: &'static str,
}

macro_rules! skill {
    ($slug:literal, $name:literal, $availability:literal) => {
        BuiltinSkill {
            id: concat!("builtin.", $slug),
            name: $name,
            path: concat!("builtin://", $slug, "/SKILL.md"),
            availability: $availability,
            text: include_str!(concat!(
                "../../resources/builtin-skills/",
                $slug,
                "/SKILL.md"
            )),
        }
    };
}

pub(super) const VERSION: &str = "1.0.0";
pub(super) const CATALOG: &[BuiltinSkill] = &[
    skill!("file-organize", "文件整理", "file-actions"),
    skill!("task-planning", "任务拆解", "advice"),
    skill!("product-design", "产品与交互设计", "advice"),
    skill!("ui-design-review", "界面设计评审", "advice"),
    skill!("software-development", "软件开发建议", "advice"),
    skill!("debug-and-test", "调试与测试建议", "advice"),
    skill!("code-review", "代码审查建议", "advice"),
    skill!("documentation", "文档编写", "advice"),
    skill!("terminal-diagnostics", "终端与 SSH 诊断", "advice"),
];

pub(super) fn find(id: &str) -> Option<&'static BuiltinSkill> {
    CATALOG.iter().find(|skill| skill.id == id)
}
