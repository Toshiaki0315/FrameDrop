use std::path::Path;
use std::process::Command;

fn extension_lower(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
}

/// HEIC/HEIF cannot be decoded by the `image` crate, so macOS `sips` is used.
pub fn is_heic(path: &str) -> bool {
    matches!(extension_lower(path).as_deref(), Some("heic" | "heif"))
}

/// FFmpeg's concat demuxer decodes every file with the first file's decoder, so
/// mixed formats fail. Every non-PNG image is therefore normalised to PNG.
pub fn needs_conversion(path: &str) -> bool {
    extension_lower(path).as_deref() != Some("png")
}

/// Destination PNG path: `<work_dir>/<index>/<file name>.png` (unique even if names repeat).
pub fn converted_png_path(work_dir: &Path, index: usize, src: &str) -> String {
    let name = Path::new(src).file_name().and_then(|s| s.to_str()).unwrap_or("image");
    work_dir.join(index.to_string()).join(format!("{name}.png")).to_string_lossy().into_owned()
}

/// Path list with every non-PNG entry replaced by its converted PNG path.
pub fn map_converted(paths: &[String], work_dir: &Path) -> Vec<String> {
    paths
        .iter()
        .enumerate()
        .map(|(i, p)| if needs_conversion(p) { converted_png_path(work_dir, i, p) } else { p.clone() })
        .collect()
}

pub fn convert_one(src: &str, dst: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(dst).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if is_heic(src) {
        let out = Command::new("sips")
            .args(["-s", "format", "png", src, "--out", dst])
            .output()
            .map_err(|e| format!("sips を実行できません（HEIC の変換は macOS のみ対応）: {e}"))?;
        if !out.status.success() {
            let detail = String::from_utf8_lossy(&out.stderr);
            return Err(format!("HEIC を変換できません: {src} ({})", detail.trim()));
        }
        Ok(())
    } else {
        image::open(src)
            .and_then(|img| img.save_with_format(dst, image::ImageFormat::Png))
            .map_err(|e| format!("画像を変換できません: {src} ({e})"))
    }
}

/// Converts all non-PNG images into PNGs under `work_dir`; returns the paths to feed the pipeline.
pub fn preprocess_images(paths: &[String], work_dir: &Path) -> Result<Vec<String>, String> {
    let mapped = map_converted(paths, work_dir);
    for (src, dst) in paths.iter().zip(&mapped) {
        if needs_conversion(src) {
            convert_one(src, dst)?;
        }
    }
    Ok(mapped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn everything_except_png_needs_conversion() {
        for p in [
            "/a/x.jpg", "/a/x.JPEG", "/a/x.gif", "/a/x.bmp", "/a/x.tif", "/a/x.TIFF", "/a/x.webp",
            "/a/x.heic", "/a/x.HEIF",
        ] {
            assert!(needs_conversion(p), "{p}");
        }
        for p in ["/a/x.png", "/a/x.PNG"] {
            assert!(!needs_conversion(p), "{p}");
        }
    }

    #[test]
    fn only_heic_and_heif_are_detected_as_heic() {
        assert!(is_heic("/a/x.HeIc") && is_heic("/a/x.heif"));
        assert!(!is_heic("/a/x.jpg") && !is_heic("/a/x.tiff"));
    }

    #[test]
    fn converted_path_is_unique_per_index_and_keeps_the_file_name() {
        assert_eq!(
            converted_png_path(Path::new("/work"), 2, "/photos/IMG_0001.HEIC"),
            "/work/2/IMG_0001.HEIC.png"
        );
    }

    #[test]
    fn map_converted_swaps_only_non_png_entries() {
        let originals = vec!["/p/a.png".to_string(), "/p/b.jpg".to_string()];
        assert_eq!(
            map_converted(&originals, Path::new("/w")),
            vec!["/p/a.png", "/w/1/b.jpg.png"]
        );
    }

    #[test]
    fn converts_decodable_images_to_png_and_keeps_png_untouched() {
        let dir = tempdir().unwrap();
        let bmp = dir.path().join("a.bmp");
        image::RgbImage::new(8, 6).save(&bmp).unwrap();
        let png = dir.path().join("b.png");
        image::RgbImage::new(4, 4).save(&png).unwrap();
        let paths = vec![bmp.to_string_lossy().into_owned(), png.to_string_lossy().into_owned()];
        let work = dir.path().join("work");

        let out = preprocess_images(&paths, &work).unwrap();

        assert_eq!(out[1], paths[1]);
        assert_eq!(image::image_dimensions(&out[0]).unwrap(), (8, 6));
        assert!(out[0].ends_with("/0/a.bmp.png"));
    }

    #[test]
    fn reports_undecodable_image() {
        let dir = tempdir().unwrap();
        let bad = dir.path().join("bad.jpg");
        std::fs::write(&bad, b"not an image").unwrap();
        let err = preprocess_images(&[bad.to_string_lossy().into_owned()], &dir.path().join("w")).unwrap_err();
        assert!(err.contains("bad.jpg"), "{err}");
    }
}
