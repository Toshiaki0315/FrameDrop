pub mod core;

use core::ffmpeg::OutputFormat;
use core::pipeline::prepare_job_as;
use core::preprocess::preprocess_images_with;
use core::validation::validate_inputs;
use serde::Serialize;
use std::process::Command;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct Progress {
    status: &'static str,
    current: usize,
    total: usize,
    /// The output size, once it is known (encoding and completed).
    width: Option<u32>,
    height: Option<u32>,
}

fn emit(app: &AppHandle, status: &'static str, current: usize, total: usize) {
    let _ = app.emit("conversion-progress", Progress { status, current, total, width: None, height: None });
}

fn emit_with_size(app: &AppHandle, status: &'static str, current: usize, total: usize, size: (u32, u32)) {
    let progress = Progress { status, current, total, width: Some(size.0), height: Some(size.1) };
    let _ = app.emit("conversion-progress", progress);
}

/// FFmpeg to use: `FRAMEDROP_FFMPEG`, else `PATH` / well-known install dirs.
fn ffmpeg_command() -> String {
    core::ffmpeg::ffmpeg_command(
        std::env::var("FRAMEDROP_FFMPEG").ok().as_deref(),
        std::env::var("PATH").ok().as_deref(),
        |p| p.is_file(),
    )
}

#[tauri::command]
async fn check_ffmpeg() -> bool {
    tauri::async_runtime::spawn_blocking(|| core::ffmpeg::probe_ffmpeg(&ffmpeg_command()))
        .await
        .unwrap_or(false)
}

fn read_image_size(path: &str) -> Result<(u32, u32), String> {
    image::image_dimensions(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_thumbnail(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        core::thumbnail::make_thumbnail(
            &path,
            core::thumbnail::THUMB_SIZE,
            core::thumbnail::quicklook_thumbnail,
            core::thumbnail::sips_downscale,
        )
        .map(|png| core::thumbnail::to_data_url(&png))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn generate_mp4(
    app: AppHandle,
    file_paths: Vec<String>,
    duration_per_image: f64,
    output_path: String,
    stamp: Option<core::stamp::StampSettings>,
    video_size: Option<core::sizing::VideoSize>,
    output_format: Option<String>,
    gif_loop: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let list_file = core::scratch::scratch_path("framedrop-list").with_extension("txt");
        let list_path = list_file.to_string_lossy().into_owned();
        if !core::ffmpeg::probe_ffmpeg(&ffmpeg_command()) {
            return Err("FFmpeg が見つかりません。brew install ffmpeg でインストールしてください".to_string());
        }
        let format = OutputFormat::from_request(output_format.as_deref(), gif_loop);
        let video_size = video_size.map(|v| v.validated()).transpose()?;
        validate_inputs(&file_paths, duration_per_image).map_err(|e| core::pipeline::ConvertError::Validation(e).to_string())?;
        let work_dir = core::scratch::scratch_path("framedrop-job");
        emit(&app, "started", 0, file_paths.len());
        let converted = preprocess_images_with(&file_paths, &work_dir, |cur, total| {
            emit(&app, "converting", cur, total)
        })
        .and_then(|paths| match &stamp {
            Some(settings) => core::stamp::apply_stamps_with(
                &paths,
                &work_dir,
                settings,
                &mut core::stamp::Rng::from_time(),
                |cur, total| emit(&app, "stamping", cur, total),
            ),
            None => Ok(paths),
        });
        let file_paths = match converted {
            Ok(p) => p,
            Err(e) => {
                let _ = std::fs::remove_dir_all(&work_dir);
                return Err(e);
            }
        };
        let job = match prepare_job_as(&file_paths, duration_per_image, &output_path, &list_path, video_size, format, read_image_size) {
            Ok(job) => job,
            Err(e) => {
                let _ = std::fs::remove_dir_all(&work_dir);
                return Err(e.to_string());
            }
        };
        let total = job.ordered_paths.len();
        std::fs::write(&list_file, &job.concat_list).map_err(|e| e.to_string())?;
        emit_with_size(&app, "encoding", 0, total, job.video_size);
        let output = Command::new(ffmpeg_command()).args(&job.ffmpeg_args).output();
        let _ = std::fs::remove_file(&list_file);
        let _ = std::fs::remove_dir_all(&work_dir);
        let output = output.map_err(|e| format!("ffmpeg を実行できません: {e}"))?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).into_owned());
        }
        emit_with_size(&app, "completed", total, total, job.video_size);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

const SETTINGS_MENU_ID: &str = "open-settings";

fn build_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    let l = core::menu_labels::labels("FrameDrop");
    let app_menu = Submenu::with_items(
        app,
        "FrameDrop",
        true,
        &[
            &P::about(app, Some(&l.about), None)?,
            &P::separator(app)?,
            &MenuItem::with_id(app, SETTINGS_MENU_ID, l.settings, true, Some("CmdOrCtrl+,"))?,
            &P::separator(app)?,
            &P::hide(app, Some(&l.hide))?,
            &P::hide_others(app, Some(l.hide_others))?,
            &P::show_all(app, Some(l.show_all))?,
            &P::separator(app)?,
            &P::quit(app, Some(&l.quit))?,
        ],
    )?;
    let edit_menu = Submenu::with_items(
        app,
        l.edit_menu,
        true,
        &[
            &P::undo(app, Some(l.undo))?,
            &P::redo(app, Some(l.redo))?,
            &P::separator(app)?,
            &P::cut(app, Some(l.cut))?,
            &P::copy(app, Some(l.copy))?,
            &P::paste(app, Some(l.paste))?,
            &P::select_all(app, Some(l.select_all))?,
        ],
    )?;
    let window_menu = Submenu::with_items(
        app,
        l.window_menu,
        true,
        &[
            &P::minimize(app, Some(l.minimize))?,
            &P::maximize(app, Some(l.maximize))?,
            &P::fullscreen(app, Some(l.fullscreen))?,
            &P::separator(app)?,
            &P::close_window(app, Some(l.close_window))?,
        ],
    )?;
    Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(build_menu)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == SETTINGS_MENU_ID {
                let _ = app.emit(SETTINGS_MENU_ID, ());
            }
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![generate_mp4, get_thumbnail, check_ffmpeg])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
