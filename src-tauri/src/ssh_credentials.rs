//! Windows Credential Manager only; secrets never enter frontend profile storage.
use sha2::{Digest, Sha256};
use windows::core::{PCWSTR, PWSTR};
use windows::Win32::Foundation::ERROR_NOT_FOUND;
use windows::Win32::Security::Credentials::*;
use zeroize::Zeroizing;

pub fn target(kind: &str, parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    for part in parts { hash.update((part.len() as u64).to_le_bytes()); hash.update(part.as_bytes()); }
    format!("DaliziFiles/SSH/{kind}/{:x}", hash.finalize())
}
fn wide(text: &str) -> Vec<u16> { text.encode_utf16().chain(Some(0)).collect() }
pub fn read(target: &str) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
    let name = wide(target);
    let mut pointer = std::ptr::null_mut();
    match unsafe { CredReadW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, 0, &mut pointer) } {
        Ok(()) => {
            let value = unsafe { &*pointer };
            let bytes = if value.CredentialBlobSize == 0 { Vec::new() }
                else { unsafe { std::slice::from_raw_parts(value.CredentialBlob, value.CredentialBlobSize as usize) }.to_vec() };
            unsafe { CredFree(pointer.cast()); }
            Ok(Some(Zeroizing::new(bytes)))
        }
        Err(error) if error.code() == windows::core::HRESULT::from_win32(ERROR_NOT_FOUND.0) => Ok(None),
        Err(_) => Err("无法读取 Windows 凭据 / Cannot read Windows credentials".into()),
    }
}
pub fn write(target: &str, user: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > 2560 { return Err("凭据过长 / Credential exceeds storage limit".into()); }
    let mut name = wide(target); let mut username = wide(user);
    let credential = CREDENTIALW {
        Type: CRED_TYPE_GENERIC, TargetName: PWSTR(name.as_mut_ptr()), UserName: PWSTR(username.as_mut_ptr()),
        CredentialBlobSize: bytes.len() as u32, CredentialBlob: bytes.as_ptr() as *mut _,
        Persist: CRED_PERSIST_LOCAL_MACHINE, ..Default::default()
    };
    unsafe { CredWriteW(&credential, 0) }.map_err(|_| "连接成功，但 Windows 凭据保存失败 / Connected; saving credentials failed".into())
}
pub fn delete(target: &str) -> Result<(), String> {
    let name = wide(target);
    match unsafe { CredDeleteW(PCWSTR(name.as_ptr()), CRED_TYPE_GENERIC, 0) } {
        Ok(()) => Ok(()),
        Err(e) if e.code() == windows::core::HRESULT::from_win32(ERROR_NOT_FOUND.0) => Ok(()),
        Err(_) => Err("无法删除已保存凭据 / Cannot remove saved credentials".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn credential_identity_separates_user_host_key_and_auth_method() {
        let one = target("password", &["host", "22", "user", "key1", ""]);
        assert_ne!(one, target("password", &["host", "22", "User", "key1", ""]));
        assert_ne!(one, target("password", &["host", "22", "user", "key2", ""]));
        assert_ne!(one, target("password", &["host", "22", "user", "key1", "id_ed25519"]));
        assert_ne!(target("x", &["ab", "c"]), target("x", &["a", "bc"]));
        assert!(!one.contains("user"));
    }
}
