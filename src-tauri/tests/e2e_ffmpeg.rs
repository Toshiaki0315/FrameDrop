//! Requires ffmpeg/ffprobe on PATH. Run with: cargo test --test e2e_ffmpeg -- --ignored
use framedrop_lib::core::pipeline::prepare_job;
use std::process::Command;

#[test]
#[ignore]
fn generates_h264_mp4_without_audio_from_mixed_size_images() {
    let dir = tempfile::tempdir().unwrap();
    let mut paths = vec![];
    for (name, w, h) in [("a_wide.png", 640, 360), ("b_tall.png", 301, 480)] {
        let p = dir.path().join(name);
        let ok = Command::new("ffmpeg")
            .args(["-y", "-f", "lavfi", "-i", &format!("testsrc=size={w}x{h}:rate=1"), "-frames:v", "1"])
            .arg(&p)
            .output()
            .unwrap()
            .status
            .success();
        assert!(ok);
        paths.push(p.to_string_lossy().into_owned());
    }
    let out = dir.path().join("out.mp4").to_string_lossy().into_owned();
    let list = dir.path().join("list.txt");
    let job = prepare_job(&paths, 2.0, &out, &list.to_string_lossy(), |p| {
        image::image_dimensions(p).map_err(|e| e.to_string())
    })
    .unwrap();
    std::fs::write(&list, &job.concat_list).unwrap();
    let r = Command::new("ffmpeg").args(&job.ffmpeg_args).output().unwrap();
    assert!(r.status.success(), "{}", String::from_utf8_lossy(&r.stderr));

    let probe = Command::new("ffprobe")
        .args([
            "-v", "error", "-show_entries", "stream=codec_type,codec_name,pix_fmt,width,height:format=duration",
            "-of", "default=nw=1", &out,
        ])
        .output()
        .unwrap();
    let info = String::from_utf8_lossy(&probe.stdout).to_string();
    println!("{info}");
    assert!(info.contains("codec_name=h264"));
    assert!(info.contains("pix_fmt=yuv420p"));
    assert!(info.contains("width=640") && info.contains("height=480"));
    assert!(!info.contains("codec_type=audio"));
    let dur: f64 = info.lines().find_map(|l| l.strip_prefix("duration=")).unwrap().parse().unwrap();
    assert!((dur - 4.0).abs() < 0.3, "duration {dur}");
}

/// macOS only (uses `sips` to create HEIC/TIFF/etc. fixtures).
#[test]
#[ignore]
fn converts_every_supported_format_including_heic() {
    use framedrop_lib::core::preprocess::preprocess_images;
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path().join("base.png");
    assert!(Command::new("ffmpeg")
        .args(["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=1", "-frames:v", "1"])
        .arg(&base)
        .output()
        .unwrap()
        .status
        .success());
    let mut paths = vec![];
    for (i, (fmt, ext)) in [("jpeg", "jpeg"), ("gif", "gif"), ("bmp", "bmp"), ("tiff", "tiff"), ("heic", "heic")]
        .iter()
        .enumerate()
    {
        let dst = dir.path().join(format!("{i}_img.{ext}"));
        let r = Command::new("sips")
            .args(["-s", "format", fmt, base.to_str().unwrap(), "--out", dst.to_str().unwrap()])
            .output()
            .unwrap();
        assert!(r.status.success(), "sips failed for {fmt}");
        paths.push(dst.to_string_lossy().into_owned());
    }
    let work = dir.path().join("work");
    let prepared = preprocess_images(&paths, &work).unwrap();
    let out = dir.path().join("out.mp4").to_string_lossy().into_owned();
    let list = dir.path().join("list.txt");
    let job = prepare_job(&prepared, 1.0, &out, &list.to_string_lossy(), |p| {
        image::image_dimensions(p).map_err(|e| e.to_string())
    })
    .unwrap();
    std::fs::write(&list, &job.concat_list).unwrap();
    let r = Command::new("ffmpeg").args(&job.ffmpeg_args).output().unwrap();
    assert!(r.status.success(), "{}", String::from_utf8_lossy(&r.stderr));
    assert!(std::fs::metadata(&out).unwrap().len() > 0);
}

/// macOS only: real Quick Look / sips thumbnails for every supported format.
#[test]
#[ignore]
fn makes_thumbnails_for_every_supported_format() {
    use framedrop_lib::core::thumbnail::{make_thumbnail, quicklook_thumbnail, sips_downscale};
    let dir = tempfile::tempdir().unwrap();
    let base = dir.path().join("base.png");
    assert!(Command::new("ffmpeg")
        .args(["-y", "-f", "lavfi", "-i", "testsrc=size=1600x900:rate=1", "-frames:v", "1"])
        .arg(&base)
        .output()
        .unwrap()
        .status
        .success());
    for (fmt, ext) in [("png", "png"), ("jpeg", "jpg"), ("gif", "gif"), ("bmp", "bmp"), ("tiff", "tiff"), ("heic", "heic")] {
        let dst = dir.path().join(format!("img.{ext}"));
        assert!(Command::new("sips")
            .args(["-s", "format", fmt, base.to_str().unwrap(), "--out", dst.to_str().unwrap()])
            .output()
            .unwrap()
            .status
            .success());
        let src = dst.to_string_lossy().into_owned();
        let os = quicklook_thumbnail(&src, 240).is_some();
        let png = make_thumbnail(&src, 240, quicklook_thumbnail, sips_downscale).unwrap();
        let (w, h) = image::load_from_memory(&png).unwrap().to_rgb8().dimensions();
        println!("{ext}: os_thumbnail={os} {w}x{h}");
        assert!(w <= 240 && h <= 240 && w > 0 && h > 0, "{ext}: {w}x{h}");
    }
}

/// macOS only: stamps in every supported format are composited and the video is produced.
#[test]
#[ignore]
fn stamps_every_format_and_encodes_the_video() {
    use framedrop_lib::core::preprocess::preprocess_images;
    use framedrop_lib::core::stamp::{apply_stamps, Rng, StampSettings};
    let dir = tempfile::tempdir().unwrap();
    let ff = |args: &[&str], out: &std::path::Path| {
        assert!(Command::new("ffmpeg").args(["-y"]).args(args).arg(out).output().unwrap().status.success());
    };
    let base = dir.path().join("base.png");
    ff(&["-f", "lavfi", "-i", "color=c=blue:size=640x360:rate=1", "-frames:v", "1"], &base);
    let red = dir.path().join("red.png");
    ff(&["-f", "lavfi", "-i", "color=c=red:size=40x40:rate=1", "-frames:v", "1"], &red);

    for (fmt, ext) in [("jpeg", "jpg"), ("gif", "gif"), ("tiff", "tiff"), ("bmp", "bmp"), ("heic", "heic")] {
        let stamp = dir.path().join(format!("stamp.{ext}"));
        assert!(Command::new("sips")
            .args(["-s", "format", fmt, red.to_str().unwrap(), "--out", stamp.to_str().unwrap()])
            .output()
            .unwrap()
            .status
            .success());
        let settings = StampSettings { path: stamp.to_string_lossy().into_owned(), size: 48 };
        let work = dir.path().join(format!("work_{ext}"));
        let paths = vec![base.to_string_lossy().into_owned(), base.to_string_lossy().into_owned()];
        let prepared = preprocess_images(&paths, &work).unwrap();
        let stamped = apply_stamps(&prepared, &work, &settings, &mut Rng::from_time()).unwrap();

        let reddish = |p: &str| {
            image::open(p).unwrap().to_rgba8().pixels().filter(|px| px[0] > 200 && px[1] < 80 && px[2] < 80).count()
        };
        let (a, b) = (reddish(&stamped[0]), reddish(&stamped[1]));
        println!("{ext}: red pixels {a} / {b}");
        assert!(a > 1000 && b > 1000, "{ext}: stamp not visible ({a}, {b})");

        let out = dir.path().join(format!("out_{ext}.mp4")).to_string_lossy().into_owned();
        let list = dir.path().join(format!("list_{ext}.txt"));
        let job = prepare_job(&stamped, 1.0, &out, &list.to_string_lossy(), |p| {
            image::image_dimensions(p).map_err(|e| e.to_string())
        })
        .unwrap();
        std::fs::write(&list, &job.concat_list).unwrap();
        let r = Command::new("ffmpeg").args(&job.ffmpeg_args).output().unwrap();
        assert!(r.status.success(), "{ext}: {}", String::from_utf8_lossy(&r.stderr));
    }
}
