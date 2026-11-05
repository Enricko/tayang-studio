//! This computer's id for gift codes (one gift per computer per promo). Tayang sends only a hash:
//! SHA-256 of a fixed prefix and the OS's machine id, which the API hashes again with its own
//! secret before storing it. The machine id itself never leaves the computer.

use sha2::{Digest, Sha256};

/// The OS's id for this computer: macOS IOPlatformUUID, Windows MachineGuid, Linux machine-id.
/// It stays the same when Tayang is reinstalled or its data is deleted.
fn machine_id() -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        let out = std::process::Command::new("/usr/sbin/ioreg").args(["-rd1", "-c", "IOPlatformExpertDevice"]).output().ok()?;
        return platform_uuid(&String::from_utf8_lossy(&out.stdout));
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("reg")
            .args(["query", r"HKLM\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output()
            .ok()?;
        return machine_guid(&String::from_utf8_lossy(&out.stdout));
    }
    #[cfg(target_os = "linux")]
    {
        return ["/etc/machine-id", "/var/lib/dbus/machine-id"]
            .iter()
            .find_map(|p| std::fs::read_to_string(p).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()));
    }
    #[allow(unreachable_code)]
    None
}

#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn platform_uuid(ioreg: &str) -> Option<String> {
    let line = ioreg.lines().find(|l| l.contains("\"IOPlatformUUID\""))?;
    let value = line.split('=').nth(1)?.trim().trim_matches('"');
    (!value.is_empty()).then(|| value.to_string())
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn machine_guid(reg: &str) -> Option<String> {
    let line = reg.lines().find(|l| l.contains("MachineGuid"))?;
    line.split_whitespace().last().filter(|v| v.len() >= 8).map(str::to_string)
}

fn hash(id: &str) -> String {
    let digest = Sha256::digest(format!("tayang-device-v1:{id}").as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// The hex SHA-256 sent as `deviceId`. Without a machine id (a locked-down system), the install id
/// stands in: weaker, since it changes when Tayang's data is deleted, but still one per install.
pub fn device_id(install_id: &str) -> String {
    hash(&machine_id().unwrap_or_else(|| format!("install:{install_id}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_ids_from_the_os_tools_output() {
        let ioreg = "+-o J314sAP  <class IOPlatformExpertDevice>\n    {\n      \"IOPlatformSerialNumber\" = \"X\"\n      \"IOPlatformUUID\" = \"0A1B2C3D-0000-1111-2222-333344445555\"\n    }";
        assert_eq!(platform_uuid(ioreg).as_deref(), Some("0A1B2C3D-0000-1111-2222-333344445555"));
        let reg = "\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    6f1e2d3c-aaaa-bbbb-cccc-1234567890ab\r\n";
        assert_eq!(machine_guid(reg).as_deref(), Some("6f1e2d3c-aaaa-bbbb-cccc-1234567890ab"));
        assert_eq!(platform_uuid("nothing here"), None);
        assert_eq!(machine_guid(""), None);
    }

    #[test]
    fn sends_only_a_stable_hash() {
        let a = device_id("inst-1");
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(a, device_id("inst-1"));
        assert_ne!(hash("x"), hash("y"));
        assert!(!a.contains("inst-1"));
    }
}
