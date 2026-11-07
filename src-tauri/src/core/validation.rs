use std::path::Path;

const SUPPORTED_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "bmp", "gif", "webp", "tif", "tiff", "heic", "heif",
];

#[derive(Debug, PartialEq, Eq)]
pub enum ValidationError {
    EmptyPathList,
    FileNotFound(String),
    UnsupportedExtension(String),
    InvalidDuration,
}

/// Validates the input path list and per-image duration (seconds).
pub fn validate_inputs(paths: &[String], duration_per_image: f64) -> Result<(), ValidationError> {
    if !duration_per_image.is_finite() || duration_per_image <= 0.0 {
        return Err(ValidationError::InvalidDuration);
    }
    if paths.is_empty() {
        return Err(ValidationError::EmptyPathList);
    }
    for p in paths {
        let path = Path::new(p);
        if !path.is_file() {
            return Err(ValidationError::FileNotFound(p.clone()));
        }
        let supported = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| SUPPORTED_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false);
        if !supported {
            return Err(ValidationError::UnsupportedExtension(p.clone()));
        }
    }
    Ok(())
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

    #[test]
    fn accepts_existing_image_files_and_positive_duration() {
        let dir = tempdir().unwrap();
        let paths = vec![touch(dir.path(), "a.png"), touch(dir.path(), "b.JPG")];
        assert_eq!(validate_inputs(&paths, 2.0), Ok(()));
    }

    #[test]
    fn accepts_all_supported_still_image_formats_case_insensitively() {
        let dir = tempdir().unwrap();
        let names = [
            "a.jpeg", "b.JPG", "c.gif", "d.bmp", "e.tiff", "f.TIF", "g.heic", "h.HEIF", "i.png",
        ];
        let paths: Vec<String> = names.iter().map(|n| touch(dir.path(), n)).collect();
        assert_eq!(validate_inputs(&paths, 1.0), Ok(()));
    }

    #[test]
    fn rejects_empty_path_list() {
        assert_eq!(validate_inputs(&[], 1.0), Err(ValidationError::EmptyPathList));
    }

    #[test]
    fn rejects_missing_file() {
        let paths = vec!["/no/such/file.png".to_string()];
        assert_eq!(
            validate_inputs(&paths, 1.0),
            Err(ValidationError::FileNotFound("/no/such/file.png".to_string()))
        );
    }

    #[test]
    fn rejects_unsupported_extension() {
        let dir = tempdir().unwrap();
        let p = touch(dir.path(), "note.txt");
        assert_eq!(
            validate_inputs(&[p.clone()], 1.0),
            Err(ValidationError::UnsupportedExtension(p))
        );
    }

    #[test]
    fn rejects_non_positive_or_non_finite_duration() {
        let dir = tempdir().unwrap();
        let paths = vec![touch(dir.path(), "a.png")];
        for d in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert_eq!(
                validate_inputs(&paths, d),
                Err(ValidationError::InvalidDuration),
                "duration {d}"
            );
        }
    }
}
