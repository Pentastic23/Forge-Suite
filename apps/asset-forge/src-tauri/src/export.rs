//! Export pipelines: copy assets into a game engine project (or any folder)
//! with a chosen layout, naming and pixel-art scaling, plus a manifest. Also
//! the .forgeasset exchange file for the other Forge apps.

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::kinds::{self, NamingRule};
use crate::requirements;
use crate::store::{now_ms, AssetSummary, Project, Result};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    Folder,
    Unity,
    Godot,
    Unreal,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    /// The ids passed in.
    Selection,
    /// Approved and Final assets.
    Approved,
    All,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Layout {
    /// One folder per category: Sprite/, Icon/, SFX/...
    Category,
    /// The same folders as the source.
    Source,
    /// Everything in one folder.
    Flat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExportSpec {
    pub target: Target,
    pub dest: String,
    pub scope: Scope,
    pub ids: Vec<String>,
    pub layout: Layout,
    pub naming: NamingRule,
    /// Whole-number upscale for pixel art (nearest neighbour). 1 = as is.
    pub scale: u32,
    /// Unity: point filtering and no compression in the .meta files.
    pub pixel_art: bool,
    pub pixels_per_unit: u32,
    /// Unreal: add T_ / A_ / SM_ name prefixes.
    pub prefixes: bool,
    pub overwrite: bool,
    pub manifest: bool,
}

impl Default for ExportSpec {
    fn default() -> Self {
        ExportSpec {
            target: Target::Folder,
            dest: String::new(),
            scope: Scope::Approved,
            ids: vec![],
            layout: Layout::Category,
            naming: NamingRule::None,
            scale: 1,
            pixel_art: true,
            pixels_per_unit: 16,
            prefixes: true,
            overwrite: true,
            manifest: true,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    pub dest: String,
    pub assets: usize,
    pub copied: usize,
    pub unchanged: usize,
    pub kept_existing: usize,
    pub scaled: usize,
    pub meta_files: usize,
    pub errors: Vec<String>,
}

/// One planned file: where it comes from and where it goes, relative to dest.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Planned {
    pub id: String,
    pub from: String,
    pub to: String,
    pub scaled: bool,
}

fn scalable(ext: &str) -> bool {
    matches!(ext.to_lowercase().as_str(), "png" | "bmp" | "tga" | "gif" | "jpg" | "jpeg" | "webp")
}

fn unreal_prefix(a: &AssetSummary) -> &'static str {
    match a.file_type.as_str() {
        "image" => "T_",
        "audio" => "A_",
        "model" => "SM_",
        "font" => "Font_",
        "shader" => "M_",
        _ => "",
    }
}

pub fn select<'a>(all: &'a [AssetSummary], spec: &ExportSpec) -> Vec<&'a AssetSummary> {
    let ids: std::collections::HashSet<&str> = spec.ids.iter().map(String::as_str).collect();
    all.iter()
        .filter(|a| !a.missing)
        .filter(|a| match spec.scope {
            Scope::Selection => ids.contains(a.id.as_str()),
            Scope::Approved => a.status == "Approved" || a.status == "Final",
            Scope::All => true,
        })
        .collect()
}

pub fn plan(assets: &[&AssetSummary], spec: &ExportSpec, folder_names: &HashMap<String, String>) -> Vec<Planned> {
    let many_folders = assets.iter().map(|a| &a.folder_id).collect::<std::collections::HashSet<_>>().len() > 1;
    let mut used: HashMap<String, usize> = HashMap::new();
    let mut out = Vec::new();
    for a in assets {
        let (stem, ext) = a.name.rsplit_once('.').unwrap_or((&a.name, ""));
        let scaled = spec.scale > 1 && a.file_type == "image" && scalable(ext);
        let mut stem = if spec.naming == NamingRule::None { stem.to_string() } else { kinds::to_case(stem, spec.naming) };
        if spec.target == Target::Unreal && spec.prefixes {
            let p = unreal_prefix(a);
            if !p.is_empty() && !stem.starts_with(p) {
                stem = format!("{p}{stem}");
            }
        }
        let ext = if scaled { "png".to_string() } else { ext.to_lowercase() };
        let file = if ext.is_empty() { stem } else { format!("{stem}.{ext}") };
        let dir = match spec.layout {
            Layout::Category => a.category.clone(),
            Layout::Flat => String::new(),
            Layout::Source => {
                let sub = a.rel_path.rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default();
                let top = if many_folders { folder_names.get(&a.folder_id).cloned().unwrap_or_default() } else { String::new() };
                [top, sub].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join("/")
            }
        };
        let mut to = if dir.is_empty() { file.clone() } else { format!("{dir}/{file}") };
        // Two assets with the same name in one folder: number the later ones.
        let key = to.to_lowercase();
        let n = used.entry(key).or_insert(0);
        *n += 1;
        if *n > 1 {
            let (s, e) = file.rsplit_once('.').map(|(s, e)| (s.to_string(), format!(".{e}"))).unwrap_or((file.clone(), String::new()));
            let renamed = format!("{s}_{n}{e}");
            to = if dir.is_empty() { renamed } else { format!("{dir}/{renamed}") };
        }
        out.push(Planned { id: a.id.clone(), from: a.path.clone(), to, scaled });
    }
    out
}

fn unity_meta(ppu: u32, pixel_art: bool) -> String {
    let guid = uuid::Uuid::new_v4().simple().to_string();
    format!(
        "fileFormatVersion: 2\nguid: {guid}\nTextureImporter:\n  serializedVersion: 12\n  mipmaps:\n    enableMipMap: 0\n  textureSettings:\n    serializedVersion: 2\n    filterMode: {filter}\n    aniso: 1\n    mipBias: 0\n    wrapU: 1\n    wrapV: 1\n    wrapW: 1\n  textureType: 8\n  textureShape: 1\n  spriteMode: 1\n  spritePixelsToUnits: {ppu}\n  alphaUsage: 1\n  alphaIsTransparency: 1\n  platformSettings:\n  - serializedVersion: 3\n    buildTarget: DefaultTexturePlatform\n    maxTextureSize: 2048\n    textureFormat: -1\n    textureCompression: {comp}\n  userData: Exported by Asset Forge\n  assetBundleName: \n  assetBundleVariant: \n",
        filter = if pixel_art { 0 } else { 1 },
        comp = if pixel_art { 0 } else { 1 },
    )
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::metadata(a), fs::metadata(b)) {
        (Ok(x), Ok(y)) if x.len() == y.len() => crate::scan::hash(a).ok() == crate::scan::hash(b).ok(),
        _ => false,
    }
}

pub fn run(p: &Project, spec: &ExportSpec) -> Result<ExportReport> {
    if spec.dest.trim().is_empty() {
        return Err("Choose where to export to".into());
    }
    let dest = PathBuf::from(&spec.dest);
    fs::create_dir_all(&dest).map_err(|e| format!("Couldn't create {}: {e}", dest.display()))?;
    let all = p.all()?;
    let picked = select(&all, spec);
    if picked.is_empty() {
        return Err(match spec.scope {
            Scope::Approved => "No assets are Approved or Final yet".into(),
            Scope::Selection => "Select some assets first".into(),
            Scope::All => "The library is empty".into(),
        });
    }
    let folder_names: HashMap<String, String> = p
        .folders()?
        .into_iter()
        .map(|f| (f.id, Path::new(&f.path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()))
        .collect();
    let planned = plan(&picked, spec, &folder_names);
    let by_id: HashMap<&str, &AssetSummary> = picked.iter().map(|a| (a.id.as_str(), *a)).collect();
    let mut report = ExportReport { dest: dest.display().to_string(), assets: planned.len(), ..Default::default() };
    let mut manifest = Vec::new();

    for pl in &planned {
        let a = by_id[pl.id.as_str()];
        let target = dest.join(&pl.to);
        if let Some(dir) = target.parent() {
            if let Err(e) = fs::create_dir_all(dir) {
                report.errors.push(format!("{}: {e}", pl.to));
                continue;
            }
        }
        let exists = target.exists();
        let mut wrote = false;
        if pl.scaled {
            if exists && !spec.overwrite {
                report.kept_existing += 1;
            } else {
                match image::open(&pl.from) {
                    Ok(img) => {
                        let (w, h) = (img.width() * spec.scale, img.height() * spec.scale);
                        let big = img.resize_exact(w, h, image::imageops::FilterType::Nearest);
                        match big.save_with_format(&target, image::ImageFormat::Png) {
                            Ok(()) => {
                                report.scaled += 1;
                                report.copied += 1;
                                wrote = true;
                            }
                            Err(e) => report.errors.push(format!("{}: {e}", a.name)),
                        }
                    }
                    Err(e) => report.errors.push(format!("{}: couldn't read the image ({e})", a.name)),
                }
            }
        } else if exists && same_file(Path::new(&pl.from), &target) {
            report.unchanged += 1;
        } else if exists && !spec.overwrite {
            report.kept_existing += 1;
        } else {
            match fs::copy(&pl.from, &target) {
                Ok(_) => {
                    report.copied += 1;
                    wrote = true;
                }
                Err(e) => report.errors.push(format!("{}: {e}", a.name)),
            }
        }
        // Unity: a .meta next to each sprite. An existing .meta is kept, because scenes refer to its GUID.
        if spec.target == Target::Unity && a.file_type == "image" && matches!(a.category.as_str(), "Sprite" | "Icon" | "UI" | "Animation" | "Tileset" | "VFX") {
            let meta = PathBuf::from(format!("{}.meta", target.display()));
            if !meta.exists() && target.exists() {
                match fs::write(&meta, unity_meta(spec.pixels_per_unit.max(1), spec.pixel_art)) {
                    Ok(()) => report.meta_files += 1,
                    Err(e) => report.errors.push(format!("{}.meta: {e}", a.name)),
                }
            }
        }
        if wrote {
            p.log(Some(&a.id), "Exported", &format!("{} → {}", target_name(spec.target), pl.to))?;
        }
        manifest.push(json!({
            "id": a.id, "name": a.name, "file": pl.to, "source": a.rel_path, "category": a.category, "status": a.status,
            "tags": a.tags, "width": a.width, "height": a.height, "scale": if pl.scaled { spec.scale } else { 1 }, "hash": a.hash,
        }));
    }
    if spec.manifest {
        let body = json!({
            "formatVersion": 1, "sourceApp": "asset-forge", "sourceAppVersion": env!("CARGO_PKG_VERSION"),
            "project": p.info()?.name, "target": target_name(spec.target), "exportedAt": now_ms(), "assets": manifest,
        });
        if let Err(e) = fs::write(dest.join("assetforge-export.json"), serde_json::to_string_pretty(&body).unwrap()) {
            report.errors.push(format!("assetforge-export.json: {e}"));
        }
    }
    p.log(None, "Export", &format!("{} assets to {} ({}): {} copied, {} unchanged", report.assets, target_name(spec.target), report.dest, report.copied, report.unchanged))?;
    Ok(report)
}

fn target_name(t: Target) -> &'static str {
    match t {
        Target::Folder => "folder",
        Target::Unity => "Unity",
        Target::Godot => "Godot",
        Target::Unreal => "Unreal",
    }
}

/// The .forgeasset exchange file: what the library holds and how ready each
/// requirement is. It lists files; it doesn't contain them.
pub fn exchange(p: &Project, path: &Path) -> Result<usize> {
    let info = p.info()?;
    let all = p.all()?;
    let ready = requirements::readiness(p)?;
    let manifest = json!({
        "formatVersion": 1,
        "kind": "asset",
        "sourceApp": "asset-forge",
        "sourceAppVersion": env!("CARGO_PKG_VERSION"),
        "createdAt": now_ms(),
        "project": { "id": info.id, "name": info.name },
        "entityIds": ready.requirements.iter().filter_map(|r| r.source_id.clone()).collect::<Vec<_>>(),
    });
    let body = json!({
        "formatVersion": 1,
        "assets": all.iter().filter(|a| !a.missing).map(|a| json!({
            "id": a.id, "name": a.name, "path": a.rel_path, "fileType": a.file_type, "category": a.category, "status": a.status,
            "tags": a.tags, "width": a.width, "height": a.height, "durationMs": a.duration_ms, "size": a.size, "hash": a.hash,
        })).collect::<Vec<_>>(),
        "requirements": ready.requirements.iter().map(|r| json!({
            "sourceId": r.source_id, "group": r.group, "name": r.name,
            "slots": r.slots.iter().map(|s| json!({ "name": s.name, "state": s.state, "assetId": s.asset.as_ref().map(|a| a.id.clone()) })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>(),
    });
    let mut zip = zip::ZipWriter::new(File::create(path).map_err(|e| e.to_string())?);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("manifest.json", opts).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string_pretty(&manifest).unwrap().as_bytes()).map_err(|e| e.to_string())?;
    zip.start_file("assets.json", opts).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string(&body).unwrap().as_bytes()).map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(all.iter().filter(|a| !a.missing).count())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::tests::sample;
    use crate::store::{AssetPatch, AssetQuery};
    use std::io::Read;

    #[test]
    fn exports_to_unity_with_scaling_and_metas() {
        let (dir, mut p, _) = sample();
        let icons: Vec<String> = p.list(&AssetQuery { category: Some("Icon".into()), ..Default::default() }).unwrap().assets.into_iter().map(|a| a.id).collect();
        let dest = dir.path().join("unity/Assets/Art");
        let spec = ExportSpec { target: Target::Unity, dest: dest.display().to_string(), scale: 2, naming: NamingRule::SnakeCase, ..Default::default() };
        assert!(run(&p, &spec).unwrap_err().contains("Approved"), "nothing approved yet");

        p.update(&icons, &AssetPatch { status: Some("Approved".into()), ..Default::default() }).unwrap();
        let r = run(&p, &spec).unwrap();
        assert_eq!((r.assets, r.copied, r.scaled, r.meta_files), (4, 4, 4, 4), "{r:?}");
        let out = dest.join("Icon/big_axe.png");
        assert_eq!(imagesize::size(&out).map(|s| (s.width, s.height)).unwrap(), (36, 32), "18×16 doubled");
        let meta = fs::read_to_string(dest.join("Icon/big_axe.png.meta")).unwrap();
        assert!(meta.contains("filterMode: 0") && meta.contains("spritePixelsToUnits: 16"));
        assert!(dest.join("assetforge-export.json").is_file());

        // A second run keeps the .meta (and its GUID).
        let r2 = run(&p, &spec).unwrap();
        assert_eq!(r2.meta_files, 0);
        assert_eq!(fs::read_to_string(dest.join("Icon/big_axe.png.meta")).unwrap(), meta);
        assert!(p.get(&icons[0]).unwrap().history.iter().any(|e| e.action == "Exported"));
    }

    #[test]
    fn plans_layouts_and_unreal_names() {
        let (_dir, p, _) = sample();
        let all = p.all().unwrap();
        let picked: Vec<&AssetSummary> = all.iter().collect();
        let names = HashMap::new();
        let flat = plan(&picked, &ExportSpec { layout: Layout::Flat, ..Default::default() }, &names);
        assert!(flat.iter().any(|x| x.to == "hit.wav"));
        let src = plan(&picked, &ExportSpec { layout: Layout::Source, ..Default::default() }, &names);
        assert!(src.iter().any(|x| x.to == "UI/icons/sword.png"));
        let ue = plan(&picked, &ExportSpec { target: Target::Unreal, ..Default::default() }, &names);
        assert!(ue.iter().any(|x| x.to == "Icon/T_sword.png"));
        assert!(ue.iter().any(|x| x.to == "SFX/A_hit.wav"));
        let clash = plan(&picked, &ExportSpec { layout: Layout::Flat, naming: NamingRule::SnakeCase, ..Default::default() }, &names);
        let mut tos: Vec<&str> = clash.iter().map(|x| x.to.as_str()).collect();
        tos.sort();
        tos.dedup();
        assert_eq!(tos.len(), clash.len(), "no two files land on the same name");
    }

    #[test]
    fn writes_exchange_file() {
        let (dir, p, _) = sample();
        let path = dir.path().join("lib.forgeasset");
        assert_eq!(exchange(&p, &path).unwrap(), 9);
        let mut zip = zip::ZipArchive::new(File::open(&path).unwrap()).unwrap();
        let mut s = String::new();
        zip.by_name("manifest.json").unwrap().read_to_string(&mut s).unwrap();
        assert!(s.contains("\"kind\": \"asset\""));
        s.clear();
        zip.by_name("assets.json").unwrap().read_to_string(&mut s).unwrap();
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["assets"].as_array().unwrap().len(), 9);
    }
}
