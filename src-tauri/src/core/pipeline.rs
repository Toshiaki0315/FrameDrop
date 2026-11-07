use super::ffmpeg::{build_concat_list, build_ffmpeg_args};
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
    pub concat_list: String,
    pub ffmpeg_args: Vec<String>,
}

/// Pure planning step: validate, keep the caller's order, determine resolution, build list + FFmpeg args.
pub fn prepare_job(
    paths: &[String],
    duration_per_image: f64,
    output_path: &str,
    list_path: &str,
    read_size: impl Fn(&str) -> Result<(u32, u32), String>,
) -> Result<Job, ConvertError> {
    validate_inputs(paths, duration_per_image).map_err(ConvertError::Validation)?;
    let ordered_paths = paths.to_vec();
    let sizes = ordered_paths
        .iter()
        .map(|p| read_size(p).map_err(|e| ConvertError::ImageRead(p.clone(), e)))
        .collect::<Result<Vec<_>, _>>()?;
    let (w, h) = compute_target_size(&sizes).ok_or(ConvertError::NoValidImage)?;
    Ok(Job {
        concat_list: build_concat_list(&ordered_paths, duration_per_image),
        ffmpeg_args: build_ffmpeg_args(list_path, output_path, w, h),
        ordered_paths,
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
        let job = prepare_job(&[tall.clone(), wide.clone()], 2.0, "/out/v.mp4", "/tmp/l.txt", fake_size)
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
        let err = prepare_job(&[], 1.0, "/o.mp4", "/l.txt", fake_size).unwrap_err();
        assert_eq!(err, ConvertError::Validation(ValidationError::EmptyPathList));
    }

    #[test]
    fn reports_image_that_cannot_be_read() {
        let dir = tempdir().unwrap();
        let bad = touch(dir.path(), "broken.png");
        let err = prepare_job(&[bad.clone()], 1.0, "/o.mp4", "/l.txt", fake_size).unwrap_err();
        assert_eq!(err, ConvertError::ImageRead(bad, "cannot decode".into()));
    }

    #[test]
    fn keeps_repeated_images_so_the_same_picture_can_appear_several_times() {
        let dir = tempdir().unwrap();
        let wide = touch(dir.path(), "a_wide.png");
        let tall = touch(dir.path(), "b_tall.png");
        let order = [wide.clone(), tall.clone(), wide.clone()];
        let job = prepare_job(&order, 1.5, "/o.mp4", "/l.txt", fake_size).unwrap();
        assert_eq!(job.ordered_paths, order.to_vec());
        assert_eq!(
            job.concat_list,
            format!("file '{wide}'\nduration 1.5\nfile '{tall}'\nduration 1.5\nfile '{wide}'\nduration 1.5\nfile '{wide}'\n")
        );
    }
}
