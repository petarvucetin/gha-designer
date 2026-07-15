use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the spawned runner-sidecar child so it can be killed when the app exits.
struct Runner(Mutex<Option<CommandChild>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Start the bundled Node runner server (the /api backend) as a sidecar,
      // so the app is self-contained — no separate `npm run server` needed.
      let (mut rx, child) = app.shell().sidecar("gha-runner")?.spawn()?;
      app.manage(Runner(Mutex::new(Some(child))));
      tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
          match event {
            CommandEvent::Stdout(b) => log::info!("[runner] {}", String::from_utf8_lossy(&b).trim_end()),
            CommandEvent::Stderr(b) => log::warn!("[runner] {}", String::from_utf8_lossy(&b).trim_end()),
            _ => {}
          }
        }
      });
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if let tauri::RunEvent::Exit = event {
        if let Some(runner) = app.try_state::<Runner>() {
          if let Some(child) = runner.0.lock().unwrap().take() {
            let _ = child.kill();
          }
        }
      }
    });
}
