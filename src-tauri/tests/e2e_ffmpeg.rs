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
