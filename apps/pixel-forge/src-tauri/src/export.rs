//! Writes the files the app renders (sprite sheets, engine metadata) into a
//! folder or a zip. The pixels are made in the window; this only puts them on disk.

use serde::Deserialize;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use base64::Engine;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutFile {
    /// Relative path with forward slashes, like "godot/knight/knight_32.png".
    pub path: String,
    /// File contents, base64.
    pub data: String,
}

/// Rejects paths that could land outside the export folder.
fn safe_rel(p: &str) -> Result<PathBuf, String> {
    let rel = PathBuf::from(p.replace('\\', "/"));
    if p.is_empty() || rel.is_absolute() || rel.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err(format!("Refused to write \"{p}\": not a plain relative path"));
    }
    Ok(rel)
}

fn decode(f: &OutFile) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD.decode(&f.data).map_err(|_| format!("{} could not be decoded", f.path))
}

/// Writes every file under `dir`, creating folders as needed. Returns how many were written.
pub fn to_folder(dir: &Path, files: &[OutFile]) -> Result<usize, String> {
    if !dir.is_absolute() {
        return Err("Choose a full folder path".into());
    }
    let mut n = 0;
    for f in files {
        let target = dir.join(safe_rel(&f.path)?);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Couldn't create {}: {e}", parent.display()))?;
        }
        fs::write(&target, decode(f)?).map_err(|e| format!("Couldn't write {}: {e}", target.display()))?;
        n += 1;
    }
    Ok(n)
}

/// Writes one base64 file at an absolute path.
pub fn to_file(path: &Path, data: &str) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("Choose a full file path".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|_| "The file could not be decoded".to_string())?;
    fs::write(path, bytes).map_err(|e| format!("Couldn't write {}: {e}", path.display()))
}

/// Writes every file into one zip at `path`.
pub fn to_zip(path: &Path, files: &[OutFile]) -> Result<usize, String> {
    let file = fs::File::create(path).map_err(|e| format!("Couldn't create {}: {e}", path.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for f in files {
        let rel = safe_rel(&f.path)?;
        let name = rel.to_string_lossy().replace('\\', "/");
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        zip.write_all(&decode(f)?).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(files.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, text: &str) -> OutFile {
        OutFile { path: path.into(), data: base64::engine::general_purpose::STANDARD.encode(text) }
    }

    #[test]
    fn writes_folders_and_zips_and_refuses_escapes() {
        let t = tempfile::tempdir().unwrap();
        let files = vec![file("godot/knight/knight.png", "png"), file("README.txt", "hi")];
        assert_eq!(to_folder(t.path(), &files).unwrap(), 2);
        assert_eq!(fs::read_to_string(t.path().join("godot/knight/knight.png")).unwrap(), "png");
        for bad in ["../x.png", "/abs.png", "a/../../b", ""] {
            assert!(to_folder(t.path(), &[file(bad, "x")]).is_err(), "{bad}");
        }
        let z = t.path().join("pack.zip");
        assert_eq!(to_zip(&z, &files).unwrap(), 2);
        let mut archive = zip::ZipArchive::new(fs::File::open(&z).unwrap()).unwrap();
        assert!(archive.by_name("godot/knight/knight.png").is_ok());
        let one = t.path().join("one.png");
        to_file(&one, &base64::engine::general_purpose::STANDARD.encode("x")).unwrap();
        assert_eq!(fs::read_to_string(&one).unwrap(), "x");
        assert!(to_file(Path::new("rel.png"), "eA==").is_err());
    }
}
