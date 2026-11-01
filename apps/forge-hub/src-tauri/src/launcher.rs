//! Starts an installed app with a fresh single-use launch key.

use std::path::Path;
use std::process::Command;
use std::thread;

use forge_launch_guard as guard;

use crate::activity::{self, Level};
use crate::registry::{AppHealth, InstalledApp};

pub fn launch(app: &InstalledApp, hub_dir: &Path, launch_dir: &Path, args: &[String]) -> Result<u32, String> {
    let id = &app.manifest.id;
    if app.health != AppHealth::Ready {
        let msg = format!("{} can't start: {} is missing", app.manifest.name, app.executable_path.display());
        activity::log(hub_dir, Level::Error, id, &msg);
        return Err(msg);
    }
    let key = guard::issue_key(launch_dir, id).map_err(|e| format!("Could not create a launch key: {e}"))?;

    let mut child = Command::new(&app.executable_path)
        .args(args)
        .current_dir(&app.folder)
        .env(guard::KEY_ENV, key)
        .env(guard::DIR_ENV, launch_dir)
        .spawn()
        .map_err(|e| {
            let msg = format!("{} failed to start: {e}", app.manifest.name);
            activity::log(hub_dir, Level::Error, id, &msg);
            msg
        })?;

    let pid = child.id();
    activity::mark_launched(hub_dir, id);
    activity::log(hub_dir, Level::Info, id, format!("Launched {} {} (pid {pid})", app.manifest.name, app.manifest.version));

    // Note how the app ends, so crashes show up in Logs.
    let (hub_dir, id, name) = (hub_dir.to_path_buf(), id.clone(), app.manifest.name.clone());
    thread::spawn(move || match child.wait() {
        Ok(status) if status.success() => activity::log(&hub_dir, Level::Info, &id, format!("{name} closed")),
        Ok(status) => activity::log(&hub_dir, Level::Error, &id, format!("{name} exited with {status}")),
        Err(e) => activity::log(&hub_dir, Level::Warn, &id, format!("Lost track of {name}: {e}")),
    });
    Ok(pid)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::registry;
    use std::fs;
    use std::os::unix::fs::PermissionsExt;
    use std::time::{Duration, Instant};

    /// Launches a stand-in app that records the key it was given, then checks
    /// that the key passes the guard exactly once.
    #[test]
    fn launched_app_receives_a_working_single_use_key() {
        let tmp = tempfile::tempdir().unwrap();
        let apps = tmp.path().join("apps");
        let app_dir = apps.join("demo");
        fs::create_dir_all(&app_dir).unwrap();
        fs::write(
            app_dir.join(registry::MANIFEST_FILE),
            r#"{"id":"demo-app","name":"Demo","version":"0.1.0","executable":"run.sh"}"#,
        )
        .unwrap();
        let out = tmp.path().join("got-key");
        let script = format!("#!/bin/sh\nprintf '%s' \"$FORGE_LAUNCH_KEY\" > '{}'\n", out.display());
        let exe = app_dir.join("run.sh");
        fs::write(&exe, script).unwrap();
        fs::set_permissions(&exe, fs::Permissions::from_mode(0o755)).unwrap();

        let scan = registry::scan(&[apps]);
        let app = &scan.apps[0];
        let (hub, keys) = (tmp.path().join("hub"), tmp.path().join("keys"));
        launch(app, &hub, &keys, &[]).unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        while !out.exists() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        let key = fs::read_to_string(&out).unwrap();
        assert_eq!(guard::verify(&keys, "demo-app", &key), Ok(()));
        assert_eq!(guard::verify(&keys, "demo-app", &key), Err(guard::GuardError::UnknownKey));
        assert!(activity::read_recent(&hub).contains_key("demo-app"));
    }

    #[test]
    fn missing_executable_is_refused_and_logged() {
        let tmp = tempfile::tempdir().unwrap();
        let app_dir = tmp.path().join("apps").join("demo");
        fs::create_dir_all(&app_dir).unwrap();
        fs::write(
            app_dir.join(registry::MANIFEST_FILE),
            r#"{"id":"demo-app","name":"Demo","version":"0.1.0","executable":"gone.exe"}"#,
        )
        .unwrap();
        let scan = registry::scan(&[tmp.path().join("apps")]);
        let hub = tmp.path().join("hub");
        assert!(launch(&scan.apps[0], &hub, &tmp.path().join("keys"), &[]).is_err());
        assert_eq!(activity::read(&hub, 5)[0].level, Level::Error);
    }
}
