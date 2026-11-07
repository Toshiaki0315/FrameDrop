/// Japanese labels for the native menu bar (Tauri's defaults are English).
pub struct Labels {
    pub about: String,
    pub hide: String,
    pub quit: String,
    pub settings: &'static str,
    pub hide_others: &'static str,
    pub show_all: &'static str,
    pub undo: &'static str,
    pub redo: &'static str,
    pub cut: &'static str,
    pub copy: &'static str,
    pub paste: &'static str,
    pub select_all: &'static str,
    pub minimize: &'static str,
    pub maximize: &'static str,
    pub fullscreen: &'static str,
    pub close_window: &'static str,
    pub edit_menu: &'static str,
    pub window_menu: &'static str,
}

impl Labels {
    pub fn all(&self) -> Vec<&str> {
        vec![
            &self.about, &self.hide, &self.quit, self.settings, self.hide_others, self.show_all, self.undo,
            self.redo, self.cut, self.copy, self.paste, self.select_all, self.minimize,
            self.maximize, self.fullscreen, self.close_window, self.edit_menu, self.window_menu,
        ]
    }
}

pub fn labels(app_name: &str) -> Labels {
    Labels {
        about: format!("{app_name} について"),
        hide: format!("{app_name} を隠す"),
        quit: format!("{app_name} を終了"),
        settings: "設定…",
        hide_others: "ほかを隠す",
        show_all: "すべてを表示",
        undo: "取り消す",
        redo: "やり直す",
        cut: "切り取り",
        copy: "コピー",
        paste: "ペースト",
        select_all: "すべてを選択",
        minimize: "しまう",
        maximize: "拡大/縮小",
        fullscreen: "フルスクリーンにする",
        close_window: "ウインドウを閉じる",
        edit_menu: "編集",
        window_menu: "ウインドウ",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn has_japanese(s: &str) -> bool {
        s.chars().any(|c| matches!(c, '\u{3040}'..='\u{30ff}' | '\u{4e00}'..='\u{9fff}'))
    }

    #[test]
    fn every_menu_label_is_japanese() {
        let l = labels("FrameDrop");
        for text in l.all() {
            assert!(has_japanese(text), "not Japanese: {text}");
        }
    }

    #[test]
    fn app_specific_labels_include_the_app_name() {
        let l = labels("FrameDrop");
        assert_eq!(l.quit, "FrameDrop を終了");
        assert_eq!(l.hide, "FrameDrop を隠す");
        assert_eq!(l.about, "FrameDrop について");
    }

    #[test]
    fn menu_titles_are_japanese() {
        let l = labels("FrameDrop");
        assert_eq!((l.edit_menu, l.window_menu), ("編集", "ウインドウ"));
    }
}
