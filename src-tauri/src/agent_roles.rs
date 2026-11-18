//! Conversation presets. The native catalog supplies both UI labels and model instructions.
use serde::Serialize;

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RoleAccess {
    Standard,
    ReadOnly,
    Advice,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRole {
    pub id: &'static str,
    name_zh: &'static str,
    name_en: &'static str,
    description_zh: &'static str,
    pub description_en: &'static str,
    pub access: RoleAccess,
    pub suggested_skills: &'static [&'static str],
}

impl AgentRole {
    pub fn apply_focus(&self, mut system: String) -> String {
        if self.id != "general" {
            system.push_str("\nRole focus: ");
            system.push_str(self.description_en);
        }
        system
    }
}

macro_rules! role {
    ($id:literal, $zh:literal, $en:literal, $desc_zh:literal, $desc_en:literal, $access:ident, [$($slug:literal),*]) => {
        AgentRole {
            id: $id, name_zh: $zh, name_en: $en,
            description_zh: $desc_zh, description_en: $desc_en,
            access: RoleAccess::$access, suggested_skills: &[$(concat!("builtin.", $slug)),*],
        }
    };
}

pub const CATALOG: &[AgentRole] = &[
    role!("general", "通用助手", "General", "拆解任务，按需要整理成文。", "Break tasks into steps and help draft documents as needed.", Standard, ["task-planning", "documentation"]),
    role!("organizer", "文件整理助手", "File organizer", "规划目录分类。开启项目工具后可按当前权限提出文件操作。", "Plan folder organization. With project tools enabled, propose supported file operations within the current permission mode.", Standard, ["file-organize", "task-planning"]),
    role!("design", "产品与设计助手", "Product and design", "梳理需求与交互。仅根据提供的界面材料评审设计。", "Clarify requirements and interaction flows. Review interfaces only when relevant evidence is provided.", Standard, ["product-design", "ui-design-review", "documentation"]),
    role!("development", "开发助手", "Development", "分析提供的代码，设计实现方案和验证步骤。运行构建或测试需由用户完成。", "Analyze available code, plan implementation and suggest verification steps. Builds and tests must be run by the user.", Standard, ["software-development", "debug-and-test", "documentation"]),
    role!("review", "审查助手", "Code review", "只读审查。指出有证据的缺陷、影响及验证方式。", "Review in read-only mode. Identify evidence for defects, their impact and ways to verify them.", ReadOnly, ["code-review", "debug-and-test"]),
    role!("terminal", "终端与远程助手", "Terminal and SSH", "仅建议。根据粘贴的终端或 SSH 日志解释错误与恢复步骤。", "Advice only. Diagnose supplied terminal or SSH logs and suggest recovery steps. No terminal or remote access is available.", Advice, ["terminal-diagnostics", "task-planning"]),
    role!("web", "网页助手", "Web", "仅建议。根据提供的网页内容归纳或比较；浏览器工具尚未接入。", "Advice only. Summarize or compare supplied page content. Browser controls are unavailable.", Advice, []),
    role!("computer", "电脑操作助手", "Computer use", "仅建议。根据描述列出操作步骤；窗口控制工具尚未接入。", "Advice only. Suggest steps based on the user's description. Desktop controls are unavailable.", Advice, ["task-planning"]),
];

pub fn find(id: Option<&str>) -> Result<&'static AgentRole, String> {
    let id = id.unwrap_or("general");
    CATALOG.iter().find(|role| role.id == id)
        .ok_or_else(|| "未知助手角色 / Unknown assistant role".into())
}
