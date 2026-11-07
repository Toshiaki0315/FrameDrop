use serde::Deserialize;

/// Smallest and largest output edge accepted for a chosen video size.
const MIN_EDGE: u32 = 16;
const MAX_EDGE: u32 = 8192;

/// Output resolution chosen in the settings (e.g. 1920x1080).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
pub struct VideoSize {
    pub width: u32,
    pub height: u32,
}

impl VideoSize {
    /// Checks the size and rounds odd edges up to even ones (required by yuv420p).
    pub fn validated(self) -> Result<(u32, u32), String> {
        let ok = |v: u32| (MIN_EDGE..=MAX_EDGE).contains(&v);
        if !ok(self.width) || !ok(self.height) {
            return Err(format!(
                "動画サイズが正しくありません: {}x{}（{MIN_EDGE}〜{MAX_EDGE}px の範囲で指定してください）",
                self.width, self.height
            ));
        }
        Ok((self.width + self.width % 2, self.height + self.height % 2))
    }
}

/// Computes the common output resolution: the max width/height over all images,
/// rounded up to even numbers (required by yuv420p). Returns None if no valid image.
pub fn compute_target_size(sizes: &[(u32, u32)]) -> Option<(u32, u32)> {
    let valid = sizes.iter().filter(|(w, h)| *w > 0 && *h > 0);
    let (mut max_w, mut max_h) = (0u32, 0u32);
    let mut any = false;
    for &(w, h) in valid {
        any = true;
        max_w = max_w.max(w);
        max_h = max_h.max(h);
    }
    any.then(|| (max_w + max_w % 2, max_h + max_h % 2))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_for_empty_input() {
        assert_eq!(compute_target_size(&[]), None);
    }

    #[test]
    fn uses_max_width_and_max_height_across_images() {
        assert_eq!(
            compute_target_size(&[(800, 600), (1920, 400), (640, 1080)]),
            Some((1920, 1080))
        );
    }

    #[test]
    fn rounds_odd_dimensions_up_to_even_for_yuv420p() {
        assert_eq!(compute_target_size(&[(1001, 563)]), Some((1002, 564)));
    }

    #[test]
    fn ignores_zero_sized_entries_but_none_if_all_zero() {
        assert_eq!(compute_target_size(&[(0, 0), (100, 50)]), Some((100, 50)));
        assert_eq!(compute_target_size(&[(0, 0)]), None);
    }

    #[test]
    fn accepts_common_video_sizes_as_they_are() {
        for (w, h) in [(1920, 1080), (1280, 720), (3840, 2160), (1080, 1920), (1080, 1080), (640, 480)] {
            assert_eq!(VideoSize { width: w, height: h }.validated(), Ok((w, h)));
        }
    }

    #[test]
    fn rounds_odd_video_sizes_up_to_even_for_yuv420p() {
        assert_eq!(VideoSize { width: 1081, height: 721 }.validated(), Ok((1082, 722)));
    }

    #[test]
    fn rejects_zero_tiny_and_huge_video_sizes() {
        for (w, h) in [(0, 720), (1280, 0), (8, 8), (15, 1080), (9000, 1080), (1920, 8193)] {
            assert!(VideoSize { width: w, height: h }.validated().is_err(), "{w}x{h}");
        }
    }

    #[test]
    fn video_size_deserializes_from_the_frontend_json() {
        let v: VideoSize = serde_json::from_str(r#"{"width":1280,"height":720}"#).unwrap();
        assert_eq!(v, VideoSize { width: 1280, height: 720 });
        assert!(serde_json::from_str::<VideoSize>(r#"{"width":"1280"}"#).is_err());
    }
}
