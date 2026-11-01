//! Reading files on disk: walking a folder, sizes, image dimensions, sound
//! length and content hashes. Nothing here changes a file.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

use crate::kinds::{self, FileType};

#[derive(Debug, Clone, PartialEq)]
pub struct DiskFile {
    /// Path inside the source folder, with forward slashes.
    pub rel_path: String,
    pub size: u64,
    pub mtime: i64,
}

/// Every file under `root` the library should know about.
pub fn walk(root: &Path) -> io::Result<Vec<DiskFile>> {
    if !root.is_dir() {
        return Err(io::Error::new(io::ErrorKind::NotFound, format!("{} is not a folder", root.display())));
    }
    let mut out = Vec::new();
    let walker = WalkDir::new(root).follow_links(false).into_iter().filter_entry(|e| e.depth() == 0 || !kinds::ignored(&e.file_name().to_string_lossy()));
    for entry in walker.flatten() {
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(rel) = entry.path().strip_prefix(root) else { continue };
        let rel_path = rel.to_string_lossy().replace('\\', "/");
        let mtime = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
        out.push(DiskFile { rel_path, size: meta.len(), mtime });
    }
    Ok(out)
}

pub fn hash(path: &Path) -> io::Result<String> {
    let mut hasher = blake3::Hasher::new();
    let mut f = File::open(path)?;
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().to_hex()[..32].to_string())
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Details {
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration_ms: Option<u64>,
}

/// Dimensions for images (read from the header only) and length for WAV sounds.
pub fn details(path: &Path, ft: FileType) -> Details {
    match ft {
        FileType::Image => match imagesize::size(path) {
            Ok(s) => Details { width: Some(s.width as u32), height: Some(s.height as u32), duration_ms: None },
            Err(_) => Details::default(),
        },
        FileType::Audio if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("wav")) => Details { duration_ms: wav_duration(path).ok().flatten(), ..Default::default() },
        _ => Details::default(),
    }
}

/// Length of a PCM WAV file from its header.
fn wav_duration(path: &Path) -> io::Result<Option<u64>> {
    let mut f = File::open(path)?;
    let mut head = [0u8; 12];
    f.read_exact(&mut head)?;
    if &head[0..4] != b"RIFF" || &head[8..12] != b"WAVE" {
        return Ok(None);
    }
    let mut byte_rate: Option<u32> = None;
    loop {
        let mut chunk = [0u8; 8];
        if f.read_exact(&mut chunk).is_err() {
            return Ok(None);
        }
        let len = u32::from_le_bytes([chunk[4], chunk[5], chunk[6], chunk[7]]);
        match &chunk[0..4] {
            b"fmt " => {
                let mut fmt = vec![0u8; len as usize];
                f.read_exact(&mut fmt)?;
                if fmt.len() >= 12 {
                    byte_rate = Some(u32::from_le_bytes([fmt[8], fmt[9], fmt[10], fmt[11]]));
                }
                if len % 2 == 1 {
                    f.seek(SeekFrom::Current(1))?;
                }
            }
            b"data" => {
                return Ok(byte_rate.filter(|&r| r > 0).map(|r| len as u64 * 1000 / r as u64));
            }
            _ => {
                f.seek(SeekFrom::Current(len as i64 + (len % 2) as i64))?;
            }
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::fs;

    pub fn write_png(path: &Path, w: u32, h: u32, shade: u8) {
        let img = image::RgbaImage::from_pixel(w, h, image::Rgba([shade, 0, 0, 255]));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        img.save(path).unwrap();
    }

    pub fn write_wav(path: &Path, ms: u32) {
        let rate = 8000u32;
        let data_len = rate * ms / 1000; // 8-bit mono
        let mut b = Vec::new();
        b.extend(b"RIFF");
        b.extend((36 + data_len).to_le_bytes());
        b.extend(b"WAVEfmt ");
        b.extend(16u32.to_le_bytes());
        b.extend(1u16.to_le_bytes());
        b.extend(1u16.to_le_bytes());
        b.extend(rate.to_le_bytes());
        b.extend(rate.to_le_bytes());
        b.extend(1u16.to_le_bytes());
        b.extend(8u16.to_le_bytes());
        b.extend(b"data");
        b.extend(data_len.to_le_bytes());
        b.extend(vec![128u8; data_len as usize]);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b).unwrap();
    }

    #[test]
    fn walks_reads_and_hashes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write_png(&root.join("chars/knight.png"), 32, 48, 1);
        write_png(&root.join("chars/copy.png"), 32, 48, 1);
        write_wav(&root.join("sfx/hit.wav"), 1500);
        fs::write(root.join("chars/knight.png.meta"), "x").unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/HEAD"), "x").unwrap();

        let mut files: Vec<String> = walk(root).unwrap().into_iter().map(|f| f.rel_path).collect();
        files.sort();
        assert_eq!(files, ["chars/copy.png", "chars/knight.png", "sfx/hit.wav"]);

        let d = details(&root.join("chars/knight.png"), FileType::Image);
        assert_eq!((d.width, d.height), (Some(32), Some(48)));
        assert_eq!(details(&root.join("sfx/hit.wav"), FileType::Audio).duration_ms, Some(1500));
        assert_eq!(hash(&root.join("chars/knight.png")).unwrap(), hash(&root.join("chars/copy.png")).unwrap());
        assert!(walk(&root.join("nope")).is_err());
    }
}
