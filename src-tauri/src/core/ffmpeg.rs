use std::path::{Path, PathBuf};

const KNOWN_DIRS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];

/// Locates `ffmpeg`. Apps launched from Finder get a minimal PATH without Homebrew,
/// so PATH entries are searched first, then well-known install directories.
/// Falls back to the bare command name.
pub fn resolve_ffmpeg(path_env: Option<&str>, exists: impl Fn(&Path) -> bool) -> String {
    let from_path = path_env.unwrap_or("").split(':').filter(|d| !d.is_empty());
    from_path
        .chain(KNOWN_DIRS.iter().copied())
        .map(|d| PathBuf::from(d).join("ffmpeg"))
        .find(|p| exists(p))
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ffmpeg".to_string())
}

/// The FFmpeg command to run. `FRAMEDROP_FFMPEG` (if non-empty) overrides everything, which
/// also lets a missing FFmpeg be simulated; otherwise see [`resolve_ffmpeg`].
pub fn ffmpeg_command(
    env_override: Option<&str>,
    path_env: Option<&str>,
    exists: impl Fn(&Path) -> bool,
) -> String {
    match env_override {
        Some(custom) if !custom.is_empty() => custom.to_string(),
        _ => resolve_ffmpeg(path_env, exists),
    }
}

/// True if `command -version` runs successfully (i.e. FFmpeg is installed and usable).
pub fn probe_ffmpeg(command: &str) -> bool {
    std::process::Command::new(command)
        .arg("-version")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Builds an FFmpeg concat-demuxer list. The last file is repeated
/// (without duration) so FFmpeg honours the final image's duration.
pub fn build_concat_list(paths: &[String], duration_per_image: f64) -> String {
    let quote = |p: &str| format!("file '{}'\n", p.replace('\'', "'\\''"));
    let mut out = String::new();
    for p in paths {
        out.push_str(&quote(p));
        out.push_str(&format!("duration {}\n", duration_per_image));
    }
    if let Some(last) = paths.last() {
        out.push_str(&quote(last));
    }
    out
}

/// Builds FFmpeg arguments: H.264 / yuv420p, no audio, letterboxed to width x height.
pub fn build_ffmpeg_args(list_path: &str, output_path: &str, width: u32, height: u32) -> Vec<String> {
    let vf = format!(
        "scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1",
        w = width,
        h = height
    );
    [
        "-y", "-f", "concat", "-safe", "0", "-i", list_path, "-vf", &vf, "-c:v", "libx264",
        "-pix_fmt", "yuv420p", "-an", output_path,
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn concat_list_has_duration_per_image_and_repeats_last_file() {
        let paths = vec!["/a/1.png".to_string(), "/a/2.png".to_string()];
        assert_eq!(
            build_concat_list(&paths, 2.5),
            "file '/a/1.png'\nduration 2.5\nfile '/a/2.png'\nduration 2.5\nfile '/a/2.png'\n"
        );
    }

    #[test]
    fn concat_list_escapes_single_quotes() {
        let paths = vec!["/a/it's.png".to_string()];
        assert!(build_concat_list(&paths, 1.0).starts_with("file '/a/it'\\''s.png'\n"));
    }

    #[test]
    fn ffmpeg_args_use_h264_yuv420p_no_audio_with_black_padding() {
        let args = build_ffmpeg_args("/tmp/list.txt", "/out/video.mp4", 1920, 1080);
        let joined = args.join(" ");
        assert_eq!(&args[0], "-y");
        assert!(joined.contains("-f concat -safe 0 -i /tmp/list.txt"));
        assert!(joined.contains("-c:v libx264"));
        assert!(joined.contains("-pix_fmt yuv420p"));
        assert!(args.contains(&"-an".to_string()));
        assert!(joined.contains(
            "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
        ));
        assert_eq!(args.last().unwrap(), "/out/video.mp4");
    }

    #[test]
    fn resolve_prefers_path_entries_then_known_dirs() {
        let exists = |p: &Path| p == Path::new("/usr/local/bin/ffmpeg") || p == Path::new("/custom/ffmpeg");
        assert_eq!(resolve_ffmpeg(Some("/custom:/bin"), exists), "/custom/ffmpeg");
        assert_eq!(resolve_ffmpeg(Some("/bin"), exists), "/usr/local/bin/ffmpeg");
    }

    #[test]
    fn resolve_finds_homebrew_when_path_is_minimal_like_finder_launch() {
        let exists = |p: &Path| p == Path::new("/opt/homebrew/bin/ffmpeg");
        assert_eq!(
            resolve_ffmpeg(Some("/usr/bin:/bin:/usr/sbin:/sbin"), exists),
            "/opt/homebrew/bin/ffmpeg"
        );
        assert_eq!(resolve_ffmpeg(None, exists), "/opt/homebrew/bin/ffmpeg");
    }

    #[test]
    fn resolve_falls_back_to_bare_command_name() {
        assert_eq!(resolve_ffmpeg(Some("/bin"), |_| false), "ffmpeg");
    }

    #[test]
    fn env_override_wins_even_when_the_file_does_not_exist() {
        assert_eq!(ffmpeg_command(Some("/custom/ffmpeg"), Some("/bin"), |_| true), "/custom/ffmpeg");
        assert_eq!(ffmpeg_command(Some("/none/ffmpeg"), None, |_| false), "/none/ffmpeg");
    }

    #[test]
    fn empty_override_is_ignored_and_the_normal_lookup_applies() {
        let exists = |p: &Path| p == Path::new("/opt/homebrew/bin/ffmpeg");
        assert_eq!(ffmpeg_command(Some(""), Some("/bin"), exists), "/opt/homebrew/bin/ffmpeg");
        assert_eq!(ffmpeg_command(None, Some("/bin"), exists), "/opt/homebrew/bin/ffmpeg");
    }

    #[test]
    fn probe_reports_whether_the_command_actually_runs() {
        assert!(probe_ffmpeg("/usr/bin/true"));
        assert!(!probe_ffmpeg("/usr/bin/false"));
        assert!(!probe_ffmpeg("/no/such/ffmpeg"));
    }
}
