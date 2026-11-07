use super::preprocess::{convert_one, is_heic};
use super::scratch::scratch_path;
use image::imageops::{self, FilterType};
use image::RgbaImage;
use serde::Deserialize;
use std::path::Path;

/// Stamp size level, relative to the short side of each image.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum StampSize {
    /// 1/30 of the short side
    Small,
    /// 1/20 of the short side
    Medium,
    /// 1/10 of the short side
    Large,
}

impl StampSize {
    fn divisor(self) -> u32 {
        match self {
            Self::Small => 30,
            Self::Medium => 20,
            Self::Large => 10,
        }
    }
}

/// Stamp settings chosen in the settings dialog.
#[derive(Debug, Clone, Deserialize)]
pub struct StampSettings {
    pub path: String,
    pub size: StampSize,
}

/// Longest side of the stamp for an image: its short side divided by 30 / 20 / 10 (min 1px).
pub fn stamp_edge(image: (u32, u32), size: StampSize) -> u32 {
    ((image.0.min(image.1) as f64 / size.divisor() as f64).round() as u32).max(1)
}

/// Small deterministic generator (splitmix64); enough for picking stamp positions.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn from_time() -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        Self::new(nanos ^ ((std::process::id() as u64) << 32))
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform-ish value in `0..n` (0 when `n == 0`).
    pub fn below(&mut self, n: u32) -> u32 {
        if n == 0 { 0 } else { (self.next_u64() % n as u64) as u32 }
    }
}

/// Scales `dims` so its longest side equals `edge`, keeping the aspect ratio (min 1px).
pub fn fit_within(dims: (u32, u32), edge: u32) -> (u32, u32) {
    let (w, h) = (dims.0.max(1) as f64, dims.1.max(1) as f64);
    let e = edge as f64;
    if w >= h {
        (edge, ((h * e / w).round() as u32).max(1))
    } else {
        (((w * e / h).round() as u32).max(1), edge)
    }
}

/// Random top-left corner that keeps the whole stamp inside the image.
pub fn random_position(image: (u32, u32), stamp: (u32, u32), rng: &mut Rng) -> (u32, u32) {
    (
        rng.below(image.0.saturating_sub(stamp.0) + 1),
        rng.below(image.1.saturating_sub(stamp.1) + 1),
    )
}

/// Resizes the stamp to `w` x `h` without dark/light fringes: colours are scaled
/// premultiplied by alpha, so fully transparent pixels (whatever colour they hide) can't
/// bleed into the antialiased edge, then converted back to straight alpha.
pub fn scale_stamp(stamp: &RgbaImage, w: u32, h: u32) -> RgbaImage {
    let mut premultiplied = stamp.clone();
    for p in premultiplied.pixels_mut() {
        let a = p[3] as u32;
        for c in &mut p.0[..3] {
            *c = ((*c as u32 * a + 127) / 255) as u8;
        }
    }
    let mut out = imageops::resize(&premultiplied, w, h, FilterType::Triangle);
    for p in out.pixels_mut() {
        let a = p[3] as u32;
        if a == 0 {
            p.0 = [0, 0, 0, 0];
            continue;
        }
        for c in &mut p.0[..3] {
            *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
        }
    }
    out
}

pub fn composite(base: &RgbaImage, stamp: &RgbaImage, pos: (u32, u32)) -> RgbaImage {
    let mut out = base.clone();
    imageops::overlay(&mut out, stamp, pos.0 as i64, pos.1 as i64);
    out
}

/// Loads the stamp (jpeg/gif/tiff/bmp/png/webp, or HEIC/HEIF via macOS `sips`).
pub fn load_rgba(path: &str) -> Result<RgbaImage, String> {
    let err = |e: String| format!("スタンプ画像を読み込めません: {path} ({e})");
    if is_heic(path) {
        let dir = scratch_path("framedrop-stamp");
        let dst = dir.join("stamp.png").to_string_lossy().into_owned();
        let result = convert_one(path, &dst)
            .and_then(|_| image::open(&dst).map(|i| i.to_rgba8()).map_err(|e| e.to_string()));
        let _ = std::fs::remove_dir_all(&dir);
        result.map_err(err)
    } else {
        image::open(path).map(|i| i.to_rgba8()).map_err(|e| err(e.to_string()))
    }
}

/// Composites the stamp onto every image at its own random position; returns the new
/// PNG paths (originals are untouched). The stamp is sized from each image's own short side.
pub fn apply_stamps(
    paths: &[String],
    work_dir: &Path,
    settings: &StampSettings,
    rng: &mut Rng,
) -> Result<Vec<String>, String> {
    apply_stamps_with(paths, work_dir, settings, rng, |_, _| {})
}

/// Like [`apply_stamps`], calling `on_item(current, total)` (1-based) just before each image.
pub fn apply_stamps_with(
    paths: &[String],
    work_dir: &Path,
    settings: &StampSettings,
    rng: &mut Rng,
    mut on_item: impl FnMut(usize, usize),
) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err("有効な画像がありません".into());
    }
    let stamp = load_rgba(&settings.path)?;

    paths
        .iter()
        .enumerate()
        .map(|(i, src)| {
            on_item(i + 1, paths.len());
            let base = image::open(src)
                .map_err(|e| format!("画像を読み込めません: {src} ({e})"))?
                .to_rgba8();
            let (w, h) = base.dimensions();
            let (sw, sh) = fit_within(stamp.dimensions(), stamp_edge((w, h), settings.size));
            let (sw, sh) = (sw.min(w).max(1), sh.min(h).max(1));
            let scaled = scale_stamp(&stamp, sw, sh);
            let out = composite(&base, &scaled, random_position((w, h), (sw, sh), rng));

            let name = Path::new(src).file_name().and_then(|n| n.to_str()).unwrap_or("image");
            let dst = work_dir.join("stamped").join(i.to_string()).join(format!("{name}.png"));
            std::fs::create_dir_all(dst.parent().unwrap()).map_err(|e| e.to_string())?;
            out.save_with_format(&dst, image::ImageFormat::Png).map_err(|e| e.to_string())?;
            Ok(dst.to_string_lossy().into_owned())
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};
    use tempfile::tempdir;

    const RED: Rgba<u8> = Rgba([255, 0, 0, 255]);
    const BLUE: Rgba<u8> = Rgba([0, 0, 255, 255]);

    fn solid(w: u32, h: u32, c: Rgba<u8>) -> RgbaImage {
        RgbaImage::from_pixel(w, h, c)
    }

    fn count(img: &RgbaImage, c: Rgba<u8>) -> usize {
        img.pixels().filter(|p| **p == c).count()
    }

    #[test]
    fn levels_are_one_thirtieth_one_twentieth_and_one_tenth_of_the_short_side() {
        assert_eq!(stamp_edge((600, 300), StampSize::Small), 10);
        assert_eq!(stamp_edge((600, 300), StampSize::Medium), 15);
        assert_eq!(stamp_edge((600, 300), StampSize::Large), 30);
        // portrait uses the same (short) side
        assert_eq!(stamp_edge((300, 600), StampSize::Large), 30);
        // never smaller than one pixel
        assert_eq!(stamp_edge((10, 10), StampSize::Small), 1);
    }

    #[test]
    fn size_levels_deserialize_from_lowercase_json() {
        let ok: StampSettings = serde_json::from_str(r#"{"path":"/s.png","size":"medium"}"#).unwrap();
        assert_eq!(ok.size, StampSize::Medium);
        for (name, size) in [("small", StampSize::Small), ("large", StampSize::Large)] {
            let s: StampSettings = serde_json::from_str(&format!(r#"{{"path":"x","size":"{name}"}}"#)).unwrap();
            assert_eq!(s.size, size);
        }
        assert!(serde_json::from_str::<StampSettings>(r#"{"path":"x","size":48}"#).is_err());
        assert!(serde_json::from_str::<StampSettings>(r#"{"path":"x","size":"huge"}"#).is_err());
    }

    #[test]
    fn each_image_is_stamped_relative_to_its_own_short_side() {
        let dir = tempdir().unwrap();
        let mk = |name: &str, w, h| {
            let p = dir.path().join(name);
            solid(w, h, BLUE).save(&p).unwrap();
            p.to_string_lossy().into_owned()
        };
        let small = mk("small.png", 200, 100);
        let big = mk("big.png", 600, 300);
        let stamp_path = dir.path().join("s.png");
        solid(8, 8, RED).save(&stamp_path).unwrap();
        let settings = StampSettings { path: stamp_path.to_string_lossy().into_owned(), size: StampSize::Large };
        let out = apply_stamps(&[small, big], &dir.path().join("w"), &settings, &mut Rng::new(5)).unwrap();
        let reds: Vec<usize> =
            out.iter().map(|p| count(&image::open(p).unwrap().to_rgba8(), RED)).collect();
        assert_eq!(reds, vec![10 * 10, 30 * 30]);
    }

    #[test]
    fn rng_stays_below_the_bound_and_is_deterministic() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        let xs: Vec<u32> = (0..200).map(|_| a.below(7)).collect();
        assert!(xs.iter().all(|x| *x < 7));
        assert_eq!(xs, (0..200).map(|_| b.below(7)).collect::<Vec<_>>());
        assert!(xs.iter().collect::<std::collections::HashSet<_>>().len() > 3);
        assert_eq!(Rng::new(1).below(0), 0);
        assert_eq!(Rng::new(1).below(1), 0);
    }

    #[test]
    fn fits_the_stamp_so_its_longest_side_equals_the_edge() {
        assert_eq!(fit_within((100, 50), 48), (48, 24));
        assert_eq!(fit_within((50, 100), 48), (24, 48));
        assert_eq!(fit_within((10, 10), 48), (48, 48));
        assert_eq!(fit_within((1, 1000), 32), (1, 32));
    }

    #[test]
    fn random_positions_keep_the_stamp_fully_inside_the_image() {
        let mut rng = Rng::new(7);
        let mut seen = std::collections::HashSet::new();
        for _ in 0..300 {
            let (x, y) = random_position((200, 100), (40, 30), &mut rng);
            assert!(x <= 160 && y <= 70, "({x},{y})");
            seen.insert((x, y));
        }
        assert!(seen.len() > 50);
        assert_eq!(random_position((40, 30), (40, 30), &mut rng), (0, 0));
    }

    #[test]
    fn composites_opaque_and_transparent_stamps() {
        let base = solid(4, 4, Rgba([255, 255, 255, 255]));
        let out = composite(&base, &solid(2, 2, RED), (1, 1));
        assert_eq!(*out.get_pixel(1, 1), RED);
        assert_eq!(*out.get_pixel(2, 2), RED);
        assert_eq!(*out.get_pixel(0, 0), Rgba([255, 255, 255, 255]));
        assert_eq!(*out.get_pixel(3, 3), Rgba([255, 255, 255, 255]));
        let same = composite(&base, &solid(2, 2, Rgba([255, 0, 0, 0])), (1, 1));
        assert_eq!(same, base);
    }

    #[test]
    fn stamps_every_image_at_one_tenth_of_its_short_side_and_keeps_the_originals() {
        let dir = tempdir().unwrap();
        let mk = |name: &str, w, h| {
            let p = dir.path().join(name);
            solid(w, h, BLUE).save(&p).unwrap();
            p.to_string_lossy().into_owned()
        };
        let a = mk("a.png", 200, 100);
        let b = mk("b.png", 100, 200);
        let stamp_path = dir.path().join("stamp.png");
        solid(20, 20, RED).save(&stamp_path).unwrap();
        let settings = StampSettings { path: stamp_path.to_string_lossy().into_owned(), size: StampSize::Large };

        let out = apply_stamps(&[a.clone(), b.clone()], &dir.path().join("work"), &settings, &mut Rng::new(3))
            .unwrap();

        assert_eq!(out.len(), 2);
        for (o, (orig, dims)) in out.iter().zip([(&a, (200, 100)), (&b, (100, 200))]) {
            assert_ne!(o, orig);
            let img = image::open(o).unwrap().to_rgba8();
            assert_eq!(img.dimensions(), dims);
            assert_eq!(count(&img, RED), 10 * 10, "{o}"); // large = 1/10 of the 100px short side
            assert!(count(&image::open(orig).unwrap().to_rgba8(), RED) == 0, "original modified");
        }
    }

    #[test]
    fn each_image_gets_its_own_random_position() {
        let dir = tempdir().unwrap();
        let stamp_path = dir.path().join("s.png");
        solid(8, 8, RED).save(&stamp_path).unwrap();
        let paths: Vec<String> = (0..6)
            .map(|i| {
                let p = dir.path().join(format!("{i}.png"));
                solid(300, 300, BLUE).save(&p).unwrap();
                p.to_string_lossy().into_owned()
            })
            .collect();
        let settings = StampSettings { path: stamp_path.to_string_lossy().into_owned(), size: StampSize::Large };
        let out = apply_stamps(&paths, &dir.path().join("w"), &settings, &mut Rng::new(11)).unwrap();
        let origins: std::collections::HashSet<(u32, u32)> = out
            .iter()
            .map(|p| {
                let img = image::open(p).unwrap().to_rgba8();
                img.enumerate_pixels().find(|(_, _, px)| **px == RED).map(|(x, y, _)| (x, y)).unwrap()
            })
            .collect();
        assert!(origins.len() > 1, "all stamps landed at the same spot: {origins:?}");
    }

    #[test]
    fn reports_a_missing_stamp_file() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("a.png");
        solid(10, 10, BLUE).save(&p).unwrap();
        let settings = StampSettings { path: "/no/such/stamp.png".into(), size: StampSize::Large };
        let err = apply_stamps(&[p.to_string_lossy().into_owned()], &dir.path().join("w"), &settings, &mut Rng::new(1))
            .unwrap_err();
        assert!(err.contains("/no/such/stamp.png"), "{err}");
    }

    #[test]
    fn reports_one_based_progress_for_every_image() {
        let dir = tempdir().unwrap();
        let stamp_path = dir.path().join("s.png");
        solid(8, 8, RED).save(&stamp_path).unwrap();
        let paths: Vec<String> = (0..3)
            .map(|i| {
                let p = dir.path().join(format!("{i}.png"));
                solid(100, 100, BLUE).save(&p).unwrap();
                p.to_string_lossy().into_owned()
            })
            .collect();
        let settings = StampSettings { path: stamp_path.to_string_lossy().into_owned(), size: StampSize::Large };
        let mut calls = vec![];
        apply_stamps_with(&paths, &dir.path().join("w"), &settings, &mut Rng::new(1), |c, t| calls.push((c, t)))
            .unwrap();
        assert_eq!(calls, vec![(1, 3), (2, 3), (3, 3)]);
    }

    #[test]
    fn the_same_image_used_repeatedly_gets_a_different_stamp_position_each_time() {
        let dir = tempdir().unwrap();
        let base = dir.path().join("a.png");
        solid(300, 300, BLUE).save(&base).unwrap();
        let base = base.to_string_lossy().into_owned();
        let stamp_path = dir.path().join("s.png");
        solid(8, 8, RED).save(&stamp_path).unwrap();
        let settings = StampSettings { path: stamp_path.to_string_lossy().into_owned(), size: StampSize::Large };
        let paths = vec![base; 6];
        let out = apply_stamps(&paths, &dir.path().join("w"), &settings, &mut Rng::new(9)).unwrap();
        assert_eq!(out.iter().collect::<std::collections::HashSet<_>>().len(), 6, "separate files");
        let origins: std::collections::HashSet<(u32, u32)> = out
            .iter()
            .map(|p| {
                let img = image::open(p).unwrap().to_rgba8();
                assert_eq!(count(&img, RED), 30 * 30);
                img.enumerate_pixels().find(|(_, _, px)| **px == RED).map(|(x, y, _)| (x, y)).unwrap()
            })
            .collect();
        assert!(origins.len() > 1, "{origins:?}");
    }

    /// A white square on a fully transparent black background.
    fn stamp_with_transparent_surroundings() -> RgbaImage {
        let mut img = RgbaImage::from_pixel(80, 80, Rgba([0, 0, 0, 0]));
        for y in 20..60 {
            for x in 20..60 {
                img.put_pixel(x, y, Rgba([255, 255, 255, 255]));
            }
        }
        img
    }

    #[test]
    fn scaling_a_transparent_stamp_leaves_no_dark_halo_at_its_edges() {
        let small = scale_stamp(&stamp_with_transparent_surroundings(), 27, 27);
        let partial: Vec<&Rgba<u8>> = small.pixels().filter(|p| p[3] > 0 && p[3] < 255).collect();
        assert!(!partial.is_empty(), "expected antialiased edge pixels");
        for p in partial {
            assert!(p[0] >= 250 && p[1] >= 250 && p[2] >= 250, "edge pixel darkened: {p:?}");
        }
    }

    #[test]
    fn a_semi_transparent_stamp_blends_with_the_image_underneath() {
        let base = solid(4, 4, Rgba([0, 0, 255, 255]));
        let half_red = solid(2, 2, Rgba([255, 0, 0, 128]));
        let out = composite(&base, &half_red, (1, 1));
        let p = out.get_pixel(1, 1);
        assert!(p[0] > 120 && p[0] < 135 && p[2] > 120 && p[2] < 135 && p[3] >= 253, "{p:?}");
        assert_eq!(*out.get_pixel(0, 0), Rgba([0, 0, 255, 255]));
    }

    #[test]
    fn a_transparent_png_stamp_keeps_the_image_visible_through_its_transparent_parts() {
        let dir = tempdir().unwrap();
        let base = dir.path().join("a.png");
        solid(300, 300, BLUE).save(&base).unwrap();
        let stamp_path = dir.path().join("s.png");
        // 40x40: left half opaque red, right half fully transparent
        let mut st = RgbaImage::from_pixel(40, 40, Rgba([255, 255, 255, 0]));
        for y in 0..40 {
            for x in 0..20 {
                st.put_pixel(x, y, RED);
            }
        }
        st.save(&stamp_path).unwrap();
        let settings = StampSettings { path: stamp_path.to_string_lossy().into_owned(), size: StampSize::Large };
        let out = apply_stamps(&[base.to_string_lossy().into_owned()], &dir.path().join("w"), &settings, &mut Rng::new(2))
            .unwrap();
        let img = image::open(&out[0]).unwrap().to_rgba8();
        // 30x30 stamp: 15 opaque red columns, the boundary column is a red/blue blend
        let reds = count(&img, RED);
        assert!((14 * 30..=15 * 30).contains(&reds), "opaque half drawn, got {reds}");
        assert_eq!(count(&img, Rgba([255, 255, 255, 255])), 0, "transparent half must not paint white");
        // red, blue and their blends have no green: any green means white leaked from the stamp
        assert!(img.pixels().all(|p| p[1] == 0), "transparent pixels' hidden colour leaked in");
    }
}
