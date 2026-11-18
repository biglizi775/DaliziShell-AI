//! The verified identity of one authenticated SFTP peer and its remote directories.
use crate::{
    ssh::{InfoMode, SshConfig},
    ssh_credentials,
    workspace_identity::Workspace,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::net::IpAddr;

#[derive(Clone, Serialize, Deserialize, PartialEq)]
pub struct Host {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub fingerprint: String,
    pub system: String,
}
pub struct Peer {
    pub host: Host,
    trust_key: String,
}
impl Peer {
    pub fn new(host: &str, config: &SshConfig, fingerprint: &str, trust_key: String) -> Self {
        let host = host
            .parse::<IpAddr>()
            .map(|a| a.to_string())
            .unwrap_or_else(|_| host.trim_end_matches('.').to_ascii_lowercase());
        let system = match config.info_mode {
            InfoMode::Windows => "windows",
            InfoMode::Posix => "posix",
            InfoMode::Shell => "unspecified",
        };
        Self {
            host: Host {
                host,
                port: config.port,
                user: config.user.clone(),
                fingerprint: fingerprint.into(),
                system: system.into(),
            },
            trust_key,
        }
    }
    pub(super) fn trusted(&self) -> Result<(), String> {
        if ssh_credentials::read(&self.trust_key)?
            .as_deref()
            .map(|b| b.as_slice())
            == Some(self.host.fingerprint.as_bytes())
        {
            Ok(())
        } else {
            Err("主机信任已改变，请重新核对指纹并登录。".into())
        }
    }
}
pub(super) fn workspace(h: &Host, root: &str) -> Workspace {
    let mut hash = Sha256::new();
    for s in [
        &h.host,
        &h.port.to_string(),
        &h.user,
        &h.fingerprint,
        &h.system,
        root,
    ] {
        hash.update((s.len() as u64).to_be_bytes());
        hash.update(s.as_bytes());
    }
    let host = if h.host.contains(':') {
        format!("[{}]", h.host)
    } else {
        h.host.clone()
    };
    Workspace {
        path: format!("ssh://{}@{}:{}{}", h.user, host, h.port, root),
        identity: format!("sftp:{:x}", hash.finalize()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn remote_scope_keeps_account_port_host_key_system_and_path_case() {
        let base = Host {
            host: "example.org".into(),
            user: "alice".into(),
            port: 22,
            fingerprint: "key-a".into(),
            system: "posix".into(),
        };
        let id = workspace(&base, "/A").identity;
        assert_eq!(workspace(&base, "/A").identity, id);
        for change in [
            Host { user: "Alice".into(), ..base.clone() },
            Host { port: 222, ..base.clone() },
            Host { host: "other.example".into(), ..base.clone() },
            Host { fingerprint: "key-b".into(), ..base.clone() },
            Host { system: "windows".into(), ..base.clone() },
        ] {
            assert_ne!(workspace(&change, "/A").identity, id);
        }
        assert_ne!(workspace(&base, "/a").identity, id);
    }
}
