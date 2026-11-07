pub mod core;

use core::pipeline::prepare_job;
use serde::Serialize;
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct Progress {
    status: &'static str,
    current: usize,
    total: usize,
}

fn emit(app: &AppHandle, status: &'static str, current: usize, total: usize) {
    let _ = app.emit("conversion-progress", Progress { status, current, total });
}

fn read_image_size(path: &str) -> Result<(u32, u32), String> {
    image::image_dimensions(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn generate_mp4(
    app: AppHandle,
    file_paths: Vec<String>,
    duration_per_image: f64,
    output_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let list_file = std::env::temp_dir().join(format!("framedrop-{}.txt", std::process::id()));
        let list_path = list_file.to_string_lossy().into_owned();
        let job = prepare_job(&file_paths, duration_per_image, &output_path, &list_path, read_image_size)
            .map_err(|e| e.to_string())?;
        let total = job.sorted_paths.len();
        emit(&app, "started", 0, total);
        std::fs::write(&list_file, &job.concat_list).map_err(|e| e.to_string())?;
        emit(&app, "progress", 0, total);
        let output = Command::new("ffmpeg").args(&job.ffmpeg_args).output();
        let _ = std::fs::remove_file(&list_file);
        let output = output.map_err(|e| format!("ffmpeg を実行できません: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        emit(&app, "completed", total, total);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![generate_mp4])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
