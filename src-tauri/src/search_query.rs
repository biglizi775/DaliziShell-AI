//! Bounded Everything-style subset. The same serialized expression drives local filtering.
use chrono::{Datelike, Days, Local, Months, NaiveDate, TimeZone};
use serde::Serialize;

#[derive(Serialize)]
pub struct Query {
    pub root: Option<Expr>,
    pub needs_path: bool,
    pub needs_size: bool,
}
#[derive(Serialize)]
#[serde(tag = "op", content = "value", rename_all = "camelCase")]
pub enum Expr {
    And(Vec<Expr>),
    Or(Vec<Expr>),
    Not(Box<Expr>),
    Name(Pattern),
    Path(Pattern),
    Parent(String),
    Extension(Vec<String>),
    Kind(bool),
    Size(Range),
    Modified(Range),
}
#[derive(Serialize)]
pub struct Pattern {
    text: String,
    #[serde(skip)]
    compiled: Option<regex::Regex>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Range {
    min: Option<f64>,
    max: Option<f64>,
    min_inclusive: bool,
    max_inclusive: bool,
}
pub struct Record<'a> {
    pub name: &'a str,
    pub path: &'a str,
    pub parent: &'a str,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub mtime: i64,
}

impl Pattern {
    fn new(text: String) -> Result<Self, String> {
        let compiled = if text.contains(['*', '?']) {
            let mut pattern = String::from("^");
            let mut chars = text.chars().peekable();
            while let Some(ch) = chars.next() {
                match ch {
                    '*' if chars.peek() == Some(&'*') => {
                        chars.next();
                        pattern.push_str(".*");
                    }
                    '*' => pattern.push_str(r"[^\\]*"),
                    '?' => pattern.push_str(r"[^\\]"),
                    _ => pattern.push_str(&regex::escape(&ch.to_string())),
                }
            }
            pattern.push('$');
            Some(
                regex::RegexBuilder::new(&pattern)
                    .size_limit(1024 * 1024)
                    .build()
                    .map_err(|_| "通配符过于复杂 / Wildcard is too complex")?,
            )
        } else {
            None
        };
        Ok(Self { text, compiled })
    }
    fn matches(&self, value: &str) -> bool {
        self.compiled
            .as_ref()
            .map_or_else(|| value.contains(&self.text), |r| r.is_match(value))
    }
}
impl Range {
    fn matches(&self, value: f64) -> bool {
        self.min.is_none_or(|v| {
            if self.min_inclusive {
                value >= v
            } else {
                value > v
            }
        }) && self.max.is_none_or(|v| {
            if self.max_inclusive {
                value <= v
            } else {
                value < v
            }
        })
    }
}
impl Expr {
    fn matches(&self, item: &Record<'_>) -> bool {
        match self {
            Self::And(items) => items.iter().all(|v| v.matches(item)),
            Self::Or(items) => items.iter().any(|v| v.matches(item)),
            Self::Not(value) => !value.matches(item),
            Self::Name(v) => v.matches(item.name),
            Self::Path(v) => v.matches(item.path),
            Self::Parent(v) => item.parent.trim_end_matches('\\') == v,
            Self::Extension(exts) => {
                !item.is_dir
                    && item
                        .name
                        .rsplit_once('.')
                        .is_some_and(|(_, ext)| exts.iter().any(|v| v == ext))
            }
            Self::Kind(dir) => item.is_dir == *dir,
            Self::Size(range) => item.size.is_some_and(|v| range.matches(v as f64)),
            Self::Modified(range) => item.mtime != 0 && range.matches(item.mtime as f64),
        }
    }
    fn needs(&self, size: bool) -> bool {
        match self {
            Self::And(v) | Self::Or(v) => v.iter().any(|e| e.needs(size)),
            Self::Not(v) => v.needs(size),
            Self::Size(_) => size,
            Self::Path(_) | Self::Parent(_) => !size,
            _ => false,
        }
    }
}

#[derive(Debug, PartialEq)]
enum Token {
    Word(String, bool),
    Or,
    Not,
    Open,
    Close,
}
fn lex(input: &str) -> Result<Vec<Token>, String> {
    let mut tokens = Vec::new();
    let mut chars = input.chars().peekable();
    while let Some(&ch) = chars.peek() {
        if ch.is_whitespace() {
            chars.next();
            continue;
        }
        let special = match ch {
            '|' => Some(Token::Or),
            '!' => Some(Token::Not),
            '<' => Some(Token::Open),
            '>' => Some(Token::Close),
            _ => None,
        };
        if let Some(token) = special {
            chars.next();
            tokens.push(token);
            continue;
        }
        let mut word = String::new();
        let mut quoted = false;
        let literal = ch == '"';
        while let Some(&c) = chars.peek() {
            if c == '"' {
                chars.next();
                quoted = !quoted;
                continue;
            }
            let numeric_prefix = ["size:", "dm:", "datemodified:", "date-modified:"]
                .iter()
                .any(|p| word.eq_ignore_ascii_case(p));
            if !quoted
                && (c.is_whitespace()
                    || c == '|'
                    || (c == '!' && word.is_empty())
                    || (matches!(c, '<' | '>') && !numeric_prefix))
            {
                break;
            }
            word.push(c);
            chars.next();
        }
        if quoted {
            return Err("双引号尚未闭合 / Close the quoted phrase".into());
        }
        if word.is_empty() {
            return Err("搜索条件不能为空 / Empty search term".into());
        }
        tokens.push(Token::Word(word.to_lowercase(), literal));
        if tokens.len() > 128 {
            return Err("搜索条件过多 / Too many search terms".into());
        }
    }
    Ok(tokens)
}
struct Parser {
    tokens: Vec<Token>,
    cursor: usize,
    today: NaiveDate,
}
impl Parser {
    // Everything's default precedence is NOT, OR, then AND (space).
    fn and(&mut self, depth: usize) -> Result<Expr, String> {
        let mut terms = vec![self.or(depth)?];
        while self.cursor < self.tokens.len() && self.tokens[self.cursor] != Token::Close {
            terms.push(self.or(depth)?);
        }
        Ok(if terms.len() == 1 {
            terms.remove(0)
        } else {
            Expr::And(terms)
        })
    }
    fn or(&mut self, depth: usize) -> Result<Expr, String> {
        let mut terms = vec![self.atom(depth)?];
        while self.tokens.get(self.cursor) == Some(&Token::Or) {
            self.cursor += 1;
            terms.push(self.atom(depth)?);
        }
        Ok(if terms.len() == 1 {
            terms.remove(0)
        } else {
            Expr::Or(terms)
        })
    }
    fn atom(&mut self, depth: usize) -> Result<Expr, String> {
        if depth > 16 {
            return Err("搜索分组嵌套过深 / Search groups are too deep".into());
        }
        let token = self
            .tokens
            .get(self.cursor)
            .ok_or("缺少搜索条件 / Missing search term")?;
        self.cursor += 1;
        match token {
            Token::Not => Ok(Expr::Not(Box::new(self.atom(depth + 1)?))),
            Token::Open => {
                let value = self.and(depth + 1)?;
                if self.tokens.get(self.cursor) != Some(&Token::Close) {
                    return Err("分组缺少 > / Missing closing >".into());
                }
                self.cursor += 1;
                Ok(value)
            }
            Token::Word(word, literal) => term(word, *literal, self.today),
            _ => Err("请检查 |、! 和 < > 两侧的条件 / Check terms around |, ! and < >".into()),
        }
    }
}
impl Query {
    pub fn parse(input: &str) -> Result<Self, String> {
        Self::at(input, Local::now().date_naive())
    }
    fn at(input: &str, today: NaiveDate) -> Result<Self, String> {
        if input.len() > 1024 {
            return Err("搜索内容最多 1024 字节 / Query is too long".into());
        }
        let tokens = lex(input)?;
        if tokens.is_empty() {
            return Ok(Self {
                root: None,
                needs_path: false,
                needs_size: false,
            });
        }
        let mut parser = Parser {
            tokens,
            cursor: 0,
            today,
        };
        let root = parser.and(0)?;
        if parser.cursor != parser.tokens.len() {
            return Err("多余的分组符号 > / Unexpected closing >".into());
        }
        Ok(Self {
            needs_path: root.needs(false),
            needs_size: root.needs(true),
            root: Some(root),
        })
    }
    pub fn is_empty(&self) -> bool {
        self.root.is_none()
    }
    pub fn matches(&self, item: &Record<'_>) -> bool {
        self.root.as_ref().is_some_and(|root| root.matches(item))
    }
}
fn term(word: &str, literal: bool, today: NaiveDate) -> Result<Expr, String> {
    if !literal {
        if let Some((prefix, value)) = word.split_once(':') {
            match prefix {
            "ext" | "extension" => { let extensions: Vec<_> = value.split([';', ',']).filter(|s| !s.is_empty()).map(|s| s.trim_start_matches('.').to_owned()).collect(); if extensions.is_empty() { return Err("ext: 后需要扩展名 / Specify an extension after ext:".into()); } return Ok(Expr::Extension(extensions)); }
            "file" | "folder" | "dir" => { let kind = Expr::Kind(prefix != "file"); return if value.is_empty() { Ok(kind) } else { Ok(Expr::And(vec![kind, Expr::Name(Pattern::new(value.into())?)])) }; }
            "type" => return match value { "dir" | "folder" => Ok(Expr::Kind(true)), "file" => Ok(Expr::Kind(false)), _ => Err("type: 支持 file 或 folder / type: supports file or folder".into()) },
            "path" if !value.is_empty() => return Ok(Expr::Path(Pattern::new(value.replace('/', "\\"))?)),
            "parent" if !value.is_empty() => return Ok(Expr::Parent(value.replace('/', "\\").trim_end_matches('\\').into())),
            "size" => return Ok(Expr::Size(size_range(value)?)),
            "dm" | "datemodified" | "date-modified" => return Ok(Expr::Modified(date_range(value, today)?)),
            "name" if !value.is_empty() => return Ok(Expr::Name(Pattern::new(value.into())?)),
            _ if prefix.len() == 1 && prefix.as_bytes()[0].is_ascii_alphabetic() => return Ok(Expr::Path(Pattern::new(word.replace('/', "\\"))?)),
            _ => return Err(format!("暂不支持或缺少参数：{prefix}: / Unsupported or incomplete search function: {prefix}:")),
        }
        }
    }
    let pattern = Pattern::new(word.replace('/', "\\"))?;
    Ok(if word.contains(['\\', '/']) {
        Expr::Path(pattern)
    } else {
        Expr::Name(pattern)
    })
}
fn comparison(input: &str) -> (&str, &str) {
    for prefix in [">=", "<=", "==", ">", "<", "="] {
        if let Some(value) = input.strip_prefix(prefix) {
            return (prefix, value);
        }
    }
    ("", input)
}
fn size(value: &str) -> Result<(f64, f64), String> {
    let split = value
        .find(|c: char| !c.is_ascii_digit() && c != '.')
        .unwrap_or(value.len());
    let (number, unit) = value.split_at(split);
    let number: f64 = number.parse().map_err(|_| "大小格式无效 / Invalid size")?;
    let power = match unit {
        "" | "b" => 0,
        "k" | "kb" | "kib" => 1,
        "m" | "mb" | "mib" => 2,
        "g" | "gb" | "gib" => 3,
        "t" | "tb" | "tib" => 4,
        _ => return Err("大小单位支持 B/KB/MB/GB/TB / Unsupported size unit".into()),
    };
    let quantum = 1024f64.powi(power);
    let bytes = number * quantum;
    if !bytes.is_finite() || bytes < 0.0 || bytes > u64::MAX as f64 {
        return Err("大小超出范围 / Size out of range".into());
    }
    Ok((bytes, quantum))
}
fn size_range(input: &str) -> Result<Range, String> {
    let (op, value) = comparison(input);
    let mut range = Range {
        min: None,
        max: None,
        min_inclusive: true,
        max_inclusive: true,
    };
    if let Some((a, b)) = value.split_once("..") {
        if !op.is_empty() {
            return Err("范围不能同时包含比较符 / A range cannot also have a comparator".into());
        }
        let a = size(a)?.0;
        let b = size(b)?.0;
        if a > b {
            return Err("大小范围起点大于终点 / Size range is reversed".into());
        }
        range.min = Some(a);
        range.max = Some(b);
        return Ok(range);
    }
    let (number, quantum) = size(value)?;
    match op {
        ">" | ">=" => {
            range.min = Some(number);
            range.min_inclusive = op == ">=";
        }
        "<" | "<=" => {
            range.max = Some(number);
            range.max_inclusive = op == "<=";
        }
        "=" | "==" => {
            range.min = Some(number);
            range.max = Some(number);
        }
        _ => {
            range.min = Some(number);
            range.max = Some(number + quantum);
            range.max_inclusive = false;
        }
    }
    Ok(range)
}
fn period(value: &str, today: NaiveDate) -> Result<(f64, f64), String> {
    let tomorrow = today.succ_opt().ok_or("Date out of range")?;
    let (start, end) = match value {
        "today" => (today, tomorrow),
        "yesterday" => (today.pred_opt().ok_or("Date out of range")?, today),
        "thisweek" => {
            let start = today
                .checked_sub_days(Days::new(today.weekday().num_days_from_monday() as u64))
                .ok_or("Date out of range")?;
            (
                start,
                start
                    .checked_add_days(Days::new(7))
                    .ok_or("Date out of range")?,
            )
        }
        "thismonth" | "thisyear" => {
            let start = if value == "thisyear" {
                today.with_month(1).unwrap().with_day(1).unwrap()
            } else {
                today.with_day(1).unwrap()
            };
            (
                start,
                start
                    .checked_add_months(Months::new(if value == "thisyear" { 12 } else { 1 }))
                    .ok_or("Date out of range")?,
            )
        }
        _ if value.ends_with("days") => {
            let days: u64 = value[..value.len() - 4]
                .parse()
                .map_err(|_| "Invalid day count")?;
            if days == 0 || days > 36500 {
                return Err("天数支持 1..36500 / Day count must be 1..36500".into());
            }
            (
                today
                    .checked_sub_days(Days::new(days - 1))
                    .ok_or("Date out of range")?,
                tomorrow,
            )
        }
        _ => {
            let parts: Vec<_> = value.split('-').collect();
            if parts.is_empty() || parts.len() > 3 || parts[0].len() != 4 {
                return Err(
                    "日期请使用 YYYY、YYYY-MM 或 YYYY-MM-DD / Use YYYY, YYYY-MM or YYYY-MM-DD"
                        .into(),
                );
            }
            let y: i32 = parts[0].parse().map_err(|_| "Invalid year")?;
            let m: u32 = parts
                .get(1)
                .unwrap_or(&"1")
                .parse()
                .map_err(|_| "Invalid month")?;
            let d: u32 = parts
                .get(2)
                .unwrap_or(&"1")
                .parse()
                .map_err(|_| "Invalid day")?;
            let start = NaiveDate::from_ymd_opt(y, m, d)
                .filter(|_| (1601..=9998).contains(&y))
                .ok_or("日期无效 / Invalid date")?;
            let end = if parts.len() == 1 {
                start.checked_add_months(Months::new(12))
            } else if parts.len() == 2 {
                start.checked_add_months(Months::new(1))
            } else {
                start.succ_opt()
            }
            .ok_or("Date out of range")?;
            (start, end)
        }
    };
    let timestamp = |date: NaiveDate| {
        Local
            .from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
            .earliest()
            .map(|v| v.timestamp_millis() as f64)
            .ok_or_else(|| "本地日期无效 / Invalid local date".to_string())
    };
    Ok((timestamp(start)?, timestamp(end)?))
}
fn date_range(input: &str, today: NaiveDate) -> Result<Range, String> {
    let (op, value) = comparison(input);
    let mut range = Range {
        min: None,
        max: None,
        min_inclusive: true,
        max_inclusive: false,
    };
    if let Some((a, b)) = value.split_once("..") {
        if !op.is_empty() {
            return Err(
                "日期范围不能同时包含比较符 / A date range cannot also have a comparator".into(),
            );
        }
        let a = period(a, today)?.0;
        let b = period(b, today)?;
        if a > b.0 {
            return Err("日期范围起点大于终点 / Date range is reversed".into());
        }
        range.min = Some(a);
        range.max = Some(b.1);
        return Ok(range);
    }
    let (start, end) = period(value, today)?;
    match op {
        ">" => range.min = Some(end),
        ">=" => range.min = Some(start),
        "<" => range.max = Some(start),
        "<=" => range.max = Some(end),
        _ => {
            range.min = Some(start);
            range.max = Some(end);
        }
    }
    Ok(range)
}
#[tauri::command]
pub fn search_parse(query: String) -> Result<Query, String> {
    Query::parse(&query)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hit(query: &str, name: &str, path: &str, size: Option<u64>, mtime: i64) -> bool {
        Query::parse(query).unwrap().matches(&Record {
            name,
            path,
            parent: path.rsplit_once('\\').map_or("", |v| v.0),
            is_dir: false,
            size,
            mtime,
        })
    }
    #[test]
    fn wildcard_boolean_grouping_and_unicode() {
        assert!(hit("报告?.pdf", "报告一.pdf", "", None, 0));
        assert!(!hit("报告?.pdf", "报告一二.pdf", "", None, 0));
        assert!(hit(
            "invoice ext:pdf|ext:docx !draft",
            "invoice.pdf",
            "",
            None,
            0
        ));
        assert!(!hit("invoice ext:pdf|ext:docx", "other.pdf", "", None, 0));
        assert!(hit("<invoice ext:pdf>|other", "other.txt", "", None, 0));
        assert!(!hit("!<invoice|draft>", "draft.txt", "", None, 0));
        assert!(hit("*", "anything", "", None, 0));
        assert!(hit("\"annual report\"", "annual report.pdf", "", None, 0));
        assert!(hit("\"!draft\"", "!draft.txt", "", None, 0));
    }
    #[test]
    fn paths_and_size_bounds() {
        assert!(hit(
            r#"c:\work\ *.pdf"#,
            "one.pdf",
            r"c:\work\one.pdf",
            Some(1025),
            0
        ));
        assert!(!hit(
            r#"c:\work\ *.pdf"#,
            "one.pdf",
            r"c:\work-old\one.pdf",
            Some(1025),
            0
        ));
        assert!(!hit(
            r#"path:c:\work\*.pdf"#,
            "one.pdf",
            r"c:\work\sub\one.pdf",
            None,
            0
        ));
        assert!(hit(
            r#"path:c:\work\**.pdf"#,
            "one.pdf",
            r"c:\work\sub\one.pdf",
            None,
            0
        ));
        assert!(hit(
            r#"parent:"c:\my work""#,
            "one.pdf",
            r"c:\my work\one.pdf",
            None,
            0
        ));
        for (q, n, yes) in [
            ("size:1kb", 1025, true),
            ("size:1kb", 2048, false),
            ("size:=1kb", 1025, false),
            ("size:>1kb", 1024, false),
            ("size:1kb..2kb", 2048, true),
        ] {
            assert_eq!(hit(q, "x", "", Some(n), 0), yes, "{q}");
        }
        assert!(!hit("size:<1kb", "x", "", None, 0));
    }
    #[test]
    fn dates_include_end_day_and_handle_leap_years() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 2).unwrap();
        let q = Query::at("dm:2024-02-01..2024-02-29", today).unwrap();
        let end = period("2024-02-29", today).unwrap().1;
        let record = |mtime| Record {
            name: "x",
            path: "",
            parent: "",
            is_dir: false,
            size: None,
            mtime,
        };
        assert!(q.matches(&record(end as i64 - 1)));
        assert!(!q.matches(&record(end as i64)));
        assert!(Query::at("dm:>2025", today)
            .unwrap()
            .matches(&record(period("2026", today).unwrap().0 as i64)));
        assert_eq!(
            period("7days", today).unwrap().0,
            period("2026-10-27", today).unwrap().0
        );
        assert_eq!(
            period("thismonth", today).unwrap(),
            period("2026-11", today).unwrap()
        );
        assert_eq!(
            period("thisyear", today).unwrap(),
            period("2026", today).unwrap()
        );
        assert_eq!(
            period("thisweek", today).unwrap().1,
            period("2026-11-09", today).unwrap().0
        );
    }
    #[test]
    fn malformed_and_unsupported_queries_report_errors() {
        for q in [
            "|x",
            "x|",
            "!",
            "<x",
            "x>",
            "\"x",
            "size:",
            "size:bad",
            "size:2kb..1kb",
            "dm:2025-02-29",
            "dm:0days",
            "regex:.*",
            "content:secret",
            "ext:",
        ] {
            assert!(Query::parse(q).is_err(), "{q}");
        }
        assert!(Query::parse(&"!".repeat(128)).is_err());
        assert!(Query::parse(&"x".repeat(1025)).is_err());
    }
}
