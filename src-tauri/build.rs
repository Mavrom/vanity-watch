fn main() {
    // tauri-build doesn't watch the icon files, so a changed icon would keep the
    // old one embedded in the exe until a clean build.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
