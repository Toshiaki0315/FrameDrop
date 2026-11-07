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
}
