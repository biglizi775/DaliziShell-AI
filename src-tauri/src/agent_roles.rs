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
    role!("development", "开发助手", "Development", "分析代码并提出修改。项目里已有的检查只在确认后运行，不能执行任意命令。", "Analyze code and propose changes. Existing project checks run only after confirmation. Arbitrary commands are not available.", Standard, ["software-development", "debug-and-test", "documentation"]),
    role!("review", "审查助手", "Code review", "只读审查。指出有证据的缺陷、影响及验证方式。", "Review in read-only mode. Identify evidence for defects, their impact and ways to verify them.", ReadOnly, ["code-review", "debug-and-test"]),
    role!("terminal", "终端与远程助手", "Terminal and SSH", "仅建议。根据粘贴的终端或 SSH 日志解释错误与恢复步骤。", "Advice only. Diagnose supplied terminal or SSH logs and suggest recovery steps. No terminal or remote access is available.", Advice, ["terminal-diagnostics", "task-planning"]),
    role!("web", "网页助手", "Web", "只操作当前这一个浏览器标签。先读取标题、地址和可见正文摘要，再提出下一步。打开地址、后退、前进和刷新都要你确认；只读时只能读取。", "Operates only the current browser tab. Reads its title, address and a short visible-text summary before proposing one next step. Opening a page, going back, forward or reloading waits for confirmation. Read-only mode can only read.", Advice, []),
    role!("computer", "电脑操作助手", "Computer use", "仅建议。根据描述列出操作步骤；窗口控制工具尚未接入。", "Advice only. Suggest steps based on the user's description. Desktop controls are unavailable.", Advice, ["task-planning"]),
];

pub fn find(id: Option<&str>) -> Result<&'static AgentRole, String> {
    let id = id.unwrap_or("general");
    CATALOG.iter().find(|role| role.id == id)
        .ok_or_else(|| "未知助手角色 / Unknown assistant role".into())
}
