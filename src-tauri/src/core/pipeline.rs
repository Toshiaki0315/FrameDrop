use super::ffmpeg::{build_args_for, build_concat_list, OutputFormat};
use super::sizing::compute_target_size;
use super::validation::{validate_inputs, ValidationError};
use std::fmt;

#[derive(Debug, PartialEq, Eq)]
pub enum ConvertError {
    Validation(ValidationError),
    ImageRead(String, String),
    NoValidImage,
}

impl fmt::Display for ConvertError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Validation(ValidationError::EmptyPathList) => write!(f, "画像が指定されていません"),
            Self::Validation(ValidationError::FileNotFound(p)) => write!(f, "ファイルが見つかりません: {p}"),
            Self::Validation(ValidationError::UnsupportedExtension(p)) => {
                write!(f, "未対応の拡張子です: {p}")
            }
            Self::Validation(ValidationError::InvalidDuration) => {
                write!(f, "表示時間は0より大きい数値を指定してください")
            }
            Self::ImageRead(p, e) => write!(f, "画像を読み込めません: {p} ({e})"),
            Self::NoValidImage => write!(f, "有効な画像がありません"),
        }
    }
}

#[derive(Debug, PartialEq)]
pub struct Job {
    pub ordered_paths: Vec<String>,
    /// The actual output size (width, height): the chosen one, or fitted to the images.
    pub video_size: (u32, u32),
    pub concat_list: String,
    pub ffmpeg_args: Vec<String>,
}

/// [`prepare_job_as`] for an MP4.
pub fn prepare_job(
    paths: &[String],
    duration_per_image: f64,
    output_path: &str,
    list_path: &str,
    video_size: Option<(u32, u32)>,
    read_size: impl Fn(&str) -> Result<(u32, u32), String>,
) -> Result<Job, ConvertError> {
    prepare_job_as(paths, duration_per_image, output_path, list_path, video_size, OutputFormat::Mp4, read_size)
}

/// Pure planning step: validate, keep the caller's order, determine resolution, build list + FFmpeg args.
pub fn prepare_job_as(
    paths: &[String],
    duration_per_image: f64,
    output_path: &str,
    list_path: &str,
    video_size: Option<(u32, u32)>,
    format: OutputFormat,
    read_size: impl Fn(&str) -> Result<(u32, u32), String>,
) -> Result<Job, ConvertError> {
    validate_inputs(paths, duration_per_image).map_err(ConvertError::Validation)?;
    let ordered_paths = paths.to_vec();
    let sizes = ordered_paths
        .iter()
        .map(|p| read_size(p).map_err(|e| ConvertError::ImageRead(p.clone(), e)))
        .collect::<Result<Vec<_>, _>>()?;
    // A size chosen in the settings wins; otherwise fit the largest image.
    let (w, h) = match video_size {
        Some(size) => size,
        None => compute_target_size(&sizes).ok_or(ConvertError::NoValidImage)?,
    };
    Ok(Job {
        concat_list: build_concat_list(&ordered_paths, duration_per_image),
        ffmpeg_args: build_args_for(format, list_path, output_path, w, h),
        ordered_paths,
        video_size: (w, h),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use tempfile::tempdir;

    fn touch(dir: &std::path::Path, name: &str) -> String {
        let p = dir.join(name);
        File::create(&p).unwrap();
        p.to_string_lossy().into_owned()
    }

    fn fake_size(p: &str) -> Result<(u32, u32), String> {
        if p.ends_with("wide.png") {
            Ok((1920, 800))
        } else if p.ends_with("tall.png") {
            Ok((601, 1080))
        } else {
            Err("cannot decode".into())
        }
    }

    #[test]
    fn prepares_job_keeping_the_given_order_with_common_even_resolution() {
        let dir = tempdir().unwrap();
        let tall = touch(dir.path(), "b_tall.png");
        let wide = touch(dir.path(), "a_wide.png");
        let job = prepare_job(&[tall.clone(), wide.clone()], 2.0, "/out/v.mp4", "/tmp/l.txt", None, fake_size)
            .unwrap();
        assert_eq!(job.ordered_paths, vec![tall.clone(), wide.clone()]);
        assert_eq!(
            job.concat_list,
            format!("file '{tall}'\nduration 2\nfile '{wide}'\nduration 2\nfile '{wide}'\n")
        );
        let joined = job.ffmpeg_args.join(" ");
        assert!(joined.contains("scale=1920:1080:"));
        assert!(joined.contains("pad=1920:1080:"));
        assert_eq!(job.ffmpeg_args.last().unwrap(), "/out/v.mp4");
    }

    #[test]
    fn propagates_validation_errors() {
        let err = prepare_job(&[], 1.0, "/o.mp4", "/l.txt", None, fake_size).unwrap_err();
        assert_eq!(err, ConvertError::Validation(ValidationError::EmptyPathList));
    }

    #[test]
    fn reports_image_that_cannot_be_read() {
        let dir = tempdir().unwrap();
        let bad = touch(dir.path(), "broken.png");
        let err = prepare_job(&[bad.clone()], 1.0, "/o.mp4", "/l.txt", None, fake_size).unwrap_err();
        assert_eq!(err, ConvertError::ImageRead(bad, "cannot decode".into()));
    }

    #[test]
    fn keeps_repeated_images_so_the_same_picture_can_appear_several_times() {
        let dir = tempdir().unwrap();
        let wide = touch(dir.path(), "a_wide.png");
        let tall = touch(dir.path(), "b_tall.png");
        let order = [wide.clone(), tall.clone(), wide.clone()];
        let job = prepare_job(&order, 1.5, "/o.mp4", "/l.txt", None, fake_size).unwrap();
        assert_eq!(job.ordered_paths, order.to_vec());
        assert_eq!(
            job.concat_list,
            format!("file '{wide}'\nduration 1.5\nfile '{tall}'\nduration 1.5\nfile '{wide}'\nduration 1.5\nfile '{wide}'\n")
        );
    }

    #[test]
    fn a_chosen_video_size_replaces_the_automatic_one() {
        let dir = tempfile::tempdir().unwrap();
        let wide = touch(dir.path(), "a_wide.png");
        let tall = touch(dir.path(), "b_tall.png");
        let job = prepare_job(&[wide, tall], 1.0, "/o.mp4", "/l.txt", Some((1280, 720)), fake_size).unwrap();
        let joined = job.ffmpeg_args.join(" ");
        assert!(joined.contains("scale=1280:720:"), "{joined}");
        assert!(joined.contains("pad=1280:720:"), "{joined}");
        assert!(!joined.contains("1920"), "automatic size must not be used: {joined}");
    }

    #[test]
    fn automatic_size_is_used_when_no_video_size_is_given() {
        let dir = tempfile::tempdir().unwrap();
        let wide = touch(dir.path(), "a_wide.png");
        let tall = touch(dir.path(), "b_tall.png");
        let job = prepare_job(&[wide, tall], 1.0, "/o.mp4", "/l.txt", None, fake_size).unwrap();
        assert!(job.ffmpeg_args.join(" ").contains("scale=1920:1080:"));
    }

    #[test]
    fn unreadable_images_are_still_reported_with_a_chosen_size() {
        let dir = tempfile::tempdir().unwrap();
        let bad = touch(dir.path(), "broken.png");
        let err = prepare_job(&[bad.clone()], 1.0, "/o.mp4", "/l.txt", Some((1280, 720)), fake_size).unwrap_err();
        assert_eq!(err, ConvertError::ImageRead(bad, "cannot decode".into()));
    }

    #[test]
    fn the_job_reports_the_actual_output_size() {
        let dir = tempfile::tempdir().unwrap();
        let wide = touch(dir.path(), "a_wide.png");
        let tall = touch(dir.path(), "b_tall.png");
        let auto = prepare_job(&[wide.clone(), tall.clone()], 1.0, "/o.mp4", "/l.txt", None, fake_size).unwrap();
        assert_eq!(auto.video_size, (1920, 1080), "automatic: the largest width and height");
        let chosen = prepare_job(&[wide, tall], 1.0, "/o.mp4", "/l.txt", Some((1080, 1920)), fake_size).unwrap();
        assert_eq!(chosen.video_size, (1080, 1920));
    }

    #[test]
    fn a_gif_job_uses_gif_arguments_and_keeps_the_size() {
        let dir = tempfile::tempdir().unwrap();
        let wide = touch(dir.path(), "a_wide.png");
        let job = prepare_job_as(
            &[wide],
            1.0,
            "/o.gif",
            "/l.txt",
            Some((720, 404)),
            OutputFormat::Gif { loop_forever: false },
            fake_size,
        )
        .unwrap();
        let joined = job.ffmpeg_args.join(" ");
        assert!(joined.contains("paletteuse") && joined.contains("-loop -1"), "{joined}");
        assert!(!joined.contains("libx264"));
        assert_eq!(job.video_size, (720, 404));
    }
}
