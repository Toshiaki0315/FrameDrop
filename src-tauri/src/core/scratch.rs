use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

/// A unique path under the OS temp dir: `<prefix>-<pid>-<n>`. Distinct for every call,
/// so concurrent jobs never share (or delete) each other's files.
pub fn scratch_path(prefix: &str) -> PathBuf {
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    std::env::temp_dir().join(format!(
        "{prefix}-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_call_returns_a_distinct_path_under_the_temp_dir() {
        let a = scratch_path("framedrop-job");
        let b = scratch_path("framedrop-job");
        assert_ne!(a, b);
        assert!(a.starts_with(std::env::temp_dir()));
        assert!(a.file_name().unwrap().to_str().unwrap().starts_with("framedrop-job-"));
    }

    #[test]
    fn concurrent_callers_never_share_a_path() {
        let handles: Vec<_> = (0..8)
            .map(|_| std::thread::spawn(|| (0..50).map(|_| scratch_path("p")).collect::<Vec<_>>()))
            .collect();
        let mut all: Vec<_> = handles.into_iter().flat_map(|h| h.join().unwrap()).collect();
        let n = all.len();
        all.sort();
        all.dedup();
        assert_eq!(all.len(), n);
    }
}
