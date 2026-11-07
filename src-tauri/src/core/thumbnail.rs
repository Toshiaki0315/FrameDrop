use super::preprocess::is_heic;
use base64::Engine;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Thumbnail edge length in pixels (displayed smaller in the UI for Retina sharpness).
pub const THUMB_SIZE: u32 = 240;

fn encode_png(img: &image::DynamicImage) -> Result<Vec<u8>, String> {
    let mut buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut buf, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(buf.into_inner())
}

/// Builds a PNG thumbnail: the OS thumbnail if it yields a valid image, otherwise the
/// original downscaled (HEIC/HEIF via `heic_downscale`, everything else via the `image` crate).
pub fn make_thumbnail(
    src: &str,
    max: u32,
    os_thumbnail: impl Fn(&str, u32) -> Option<Vec<u8>>,
    heic_downscale: impl Fn(&str, u32) -> Result<Vec<u8>, String>,
) -> Result<Vec<u8>, String> {
    if let Some(bytes) = os_thumbnail(src, max) {
        if image::load_from_memory(&bytes).is_ok() {
            return Ok(bytes);
        }
    }
    if is_heic(src) {
        return heic_downscale(src, max);
    }
    let img = image::open(src).map_err(|e| format!("画像を読み込めません: {src} ({e})"))?;
    let img = if img.width() <= max && img.height() <= max { img } else { img.thumbnail(max, max) };
    encode_png(&img)
}

pub fn to_data_url(png: &[u8]) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

fn scratch_dir() -> PathBuf {
    super::scratch::scratch_path("framedrop-thumb")
}

/// macOS Quick Look thumbnail (`qlmanage -t`); None if unavailable.
pub fn quicklook_thumbnail(src: &str, size: u32) -> Option<Vec<u8>> {
    let dir = scratch_dir();
    std::fs::create_dir_all(&dir).ok()?;
    let status = Command::new("qlmanage")
        .args(["-t", "-s", &size.to_string(), "-o"])
        .arg(&dir)
        .arg(src)
        .output()
        .ok()?
        .status;
    let name = Path::new(src).file_name()?.to_str()?;
    let bytes = if status.success() { std::fs::read(dir.join(format!("{name}.png"))).ok() } else { None };
    let _ = std::fs::remove_dir_all(&dir);
    bytes
}

/// Downscales HEIC/HEIF to a PNG with macOS `sips`.
pub fn sips_downscale(src: &str, max: u32) -> Result<Vec<u8>, String> {
    let dir = scratch_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dst = dir.join("thumb.png");
    let out = Command::new("sips")
        .args(["-Z", &max.to_string(), "-s", "format", "png", src, "--out"])
        .arg(&dst)
        .output();
    let result = match out {
        Ok(o) if o.status.success() => std::fs::read(&dst).map_err(|e| e.to_string()),
        Ok(_) => Err(format!("HEIC を縮小できません: {src}")),
        Err(e) => Err(format!("sips を実行できません: {e}")),
    };
    let _ = std::fs::remove_dir_all(&dir);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use tempfile::tempdir;

    fn png_bytes(w: u32, h: u32) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        image::RgbImage::new(w, h).write_to(&mut buf, image::ImageFormat::Png).unwrap();
        buf.into_inner()
    }

    fn dims(bytes: &[u8]) -> (u32, u32) {
        image::load_from_memory(bytes).unwrap().to_rgb8().dimensions()
    }

    fn write_png(dir: &std::path::Path, name: &str, w: u32, h: u32) -> String {
        let p = dir.join(name);
        std::fs::write(&p, png_bytes(w, h)).unwrap();
        p.to_string_lossy().into_owned()
    }

    #[test]
    fn uses_the_os_thumbnail_when_available() {
        let dir = tempdir().unwrap();
        let src = write_png(dir.path(), "a.png", 1000, 500);
        let os = png_bytes(50, 25);
        let out = make_thumbnail(&src, 100, |_, _| Some(os.clone()), |_, _| panic!("no fallback")).unwrap();
        assert_eq!(dims(&out), (50, 25));
    }

    #[test]
    fn downscales_the_original_when_no_os_thumbnail() {
        let dir = tempdir().unwrap();
        let src = write_png(dir.path(), "a.png", 1000, 500);
        let out = make_thumbnail(&src, 100, |_, _| None, |_, _| panic!("not heic")).unwrap();
        assert_eq!(dims(&out), (100, 50));
    }

    #[test]
    fn downscales_the_original_when_os_thumbnail_is_not_a_valid_image() {
        let dir = tempdir().unwrap();
        let src = write_png(dir.path(), "a.png", 200, 400);
        let out = make_thumbnail(&src, 100, |_, _| Some(b"junk".to_vec()), |_, _| panic!("not heic")).unwrap();
        assert_eq!(dims(&out), (50, 100));
    }

    #[test]
    fn never_enlarges_small_images() {
        let dir = tempdir().unwrap();
        let src = write_png(dir.path(), "tiny.png", 20, 10);
        let out = make_thumbnail(&src, 100, |_, _| None, |_, _| panic!("not heic")).unwrap();
        assert_eq!(dims(&out), (20, 10));
    }

    #[test]
    fn heic_fallback_goes_through_the_heic_downscaler() {
        let called = Cell::new(false);
        let out = make_thumbnail(
            "/p/x.HEIC",
            100,
            |_, _| None,
            |p, max| {
                called.set(true);
                assert_eq!((p, max), ("/p/x.HEIC", 100));
                Ok(png_bytes(80, 60))
            },
        )
        .unwrap();
        assert!(called.get());
        assert_eq!(dims(&out), (80, 60));
    }

    #[test]
    fn reports_unreadable_originals() {
        let err = make_thumbnail("/no/such.png", 100, |_, _| None, |_, _| Err("x".into())).unwrap_err();
        assert!(err.contains("/no/such.png"), "{err}");
    }

    #[test]
    fn builds_a_png_data_url() {
        assert_eq!(to_data_url(b"abc"), "data:image/png;base64,YWJj");
    }
}
