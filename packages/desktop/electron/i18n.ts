import type { UiLocale } from "@lyra/core";

export type NativeLocale = Exclude<UiLocale, "system">;

const zhCN = {
	"tray.show": "打开 Lyra",
	"tray.hide": "隐藏 Lyra",
	"tray.newChat": "新对话",
	"tray.recent": "最近会话",
	"tray.noChats": "还没有会话",
	"tray.pullRequests": "拉取请求",
	"tray.scheduled": "已安排",
	"tray.settings": "设置…",
	"tray.updates": "检查更新…",
	"tray.launchAtLogin": "开机时启动",
	"tray.quit": "退出 Lyra",
	"dialog.projectDirectory": "选择项目目录",
	"dialog.screenshotDirectory": "选择截图保存位置",
	"shortcut.taken": "截图全局快捷键 {shortcut} 没能注册，可能已被其他应用占用（比如微信的截图键）。可以在 设置 → 屏幕截图 里换一个。",
	"shortcut.invalid": "截图全局快捷键 {shortcut} 无法识别，没有注册。可以在 设置 → 屏幕截图 里重新录一个。",
	"terminal.unavailable": "终端无法启动：原生组件 node-pty 没能加载。Lyra 的其他功能不受影响。",
	"update.appImageNotWritable": "新版本没法写进 AppImage 所在的文件夹（{reason}）。把 AppImage 放到自己有写权限的位置，或者到发布页手动下载。",
	"update.adminDismissed": "没有获得管理员授权，更新没有安装。重试时会再次询问密码。",
	"update.installFailed": "安装没有完成：{reason}",
} as const;

type NativeMessageKey = keyof typeof zhCN;
type NativeCatalog = Record<NativeMessageKey, string>;

const catalogs: Record<NativeLocale, NativeCatalog> = {
	"zh-CN": zhCN,
	"zh-TW": {
		"tray.show": "開啟 Lyra", "tray.hide": "隱藏 Lyra", "tray.newChat": "新對話", "tray.recent": "最近對話", "tray.noChats": "還沒有對話", "tray.pullRequests": "拉取請求", "tray.scheduled": "已排程", "tray.settings": "設定…", "tray.updates": "檢查更新…", "tray.launchAtLogin": "開機時啟動", "tray.quit": "結束 Lyra", "dialog.projectDirectory": "選擇專案目錄", "dialog.screenshotDirectory": "選擇截圖儲存位置",
		"shortcut.taken": "截圖全域快速鍵 {shortcut} 無法註冊，可能已被其他應用程式占用（例如微信的截圖鍵）。可以在 設定 → 螢幕截圖 中換一個。",
		"shortcut.invalid": "截圖全域快速鍵 {shortcut} 無法辨識，沒有註冊。可以在 設定 → 螢幕截圖 中重新錄製。",
		"terminal.unavailable": "終端機無法啟動：原生元件 node-pty 無法載入。Lyra 的其他功能不受影響。",
		"update.appImageNotWritable": "新版本無法寫入 AppImage 所在的資料夾（{reason}）。請把 AppImage 放到自己有寫入權限的位置，或到發布頁手動下載。",
		"update.adminDismissed": "沒有取得管理員授權，更新沒有安裝。重試時會再次詢問密碼。",
		"update.installFailed": "安裝沒有完成：{reason}",
	},
	en: {
		"tray.show": "Open Lyra", "tray.hide": "Hide Lyra", "tray.newChat": "New chat", "tray.recent": "Recent chats", "tray.noChats": "No chats yet", "tray.pullRequests": "Pull requests", "tray.scheduled": "Scheduled", "tray.settings": "Settings…", "tray.updates": "Check for updates…", "tray.launchAtLogin": "Launch at login", "tray.quit": "Quit Lyra", "dialog.projectDirectory": "Choose project folder", "dialog.screenshotDirectory": "Choose screenshot folder",
		"shortcut.taken": "The global shortcut {shortcut} could not be registered — another app is probably using it (WeChat's screenshot key, for one). Pick another in Settings → Screenshots.",
		"shortcut.invalid": "The global shortcut {shortcut} is not a key combination this system recognises, so it was not registered. Record it again in Settings → Screenshots.",
		"terminal.unavailable": "The terminal cannot start: its native component, node-pty, failed to load. The rest of Lyra is unaffected.",
		"update.appImageNotWritable": "The new version could not be written next to the AppImage ({reason}). Move the AppImage somewhere you can write to, or download it from the release page.",
		"update.adminDismissed": "Administrator permission was not given, so the update was not installed. Retrying will ask again.",
		"update.installFailed": "The installation did not finish: {reason}",
	},
	fr: {
		"tray.show": "Ouvrir Lyra", "tray.hide": "Masquer Lyra", "tray.newChat": "Nouvelle discussion", "tray.recent": "Discussions récentes", "tray.noChats": "Aucune discussion", "tray.pullRequests": "Demandes de fusion", "tray.scheduled": "Planifiées", "tray.settings": "Réglages…", "tray.updates": "Rechercher des mises à jour…", "tray.launchAtLogin": "Ouvrir à la connexion", "tray.quit": "Quitter Lyra", "dialog.projectDirectory": "Choisir le dossier du projet", "dialog.screenshotDirectory": "Choisir le dossier des captures",
		"shortcut.taken": "Le raccourci global {shortcut} n’a pas pu être enregistré : une autre application l’utilise sans doute (la touche de capture de WeChat, par exemple). Choisissez-en un autre dans Réglages → Captures d’écran.",
		"shortcut.invalid": "Le raccourci global {shortcut} n’est pas une combinaison reconnue ; il n’a pas été enregistré. Enregistrez-le de nouveau dans Réglages → Captures d’écran.",
		"terminal.unavailable": "Le terminal ne peut pas démarrer : son composant natif, node-pty, n’a pas pu être chargé. Le reste de Lyra n’est pas concerné.",
		"update.appImageNotWritable": "La nouvelle version n’a pas pu être écrite à côté de l’AppImage ({reason}). Placez l’AppImage dans un dossier où vous pouvez écrire, ou téléchargez-la depuis la page de la version.",
		"update.adminDismissed": "L’autorisation d’administrateur n’a pas été accordée ; la mise à jour n’a pas été installée. Réessayer la redemandera.",
		"update.installFailed": "L’installation n’a pas abouti : {reason}",
	},
	ru: {
		"tray.show": "Открыть Lyra", "tray.hide": "Скрыть Lyra", "tray.newChat": "Новый чат", "tray.recent": "Недавние чаты", "tray.noChats": "Чатов пока нет", "tray.pullRequests": "Запросы на слияние", "tray.scheduled": "Запланировано", "tray.settings": "Настройки…", "tray.updates": "Проверить обновления…", "tray.launchAtLogin": "Запускать при входе", "tray.quit": "Выйти из Lyra", "dialog.projectDirectory": "Выберите папку проекта", "dialog.screenshotDirectory": "Выберите папку для снимков",
		"shortcut.taken": "Не удалось назначить глобальное сочетание клавиш {shortcut}: скорее всего, его уже занимает другое приложение (например, клавиша снимка экрана в WeChat). Выберите другое в разделе «Настройки → Снимки экрана».",
		"shortcut.invalid": "Глобальное сочетание клавиш {shortcut} не распознано и не назначено. Задайте его заново в разделе «Настройки → Снимки экрана».",
		"terminal.unavailable": "Терминал не запускается: не удалось загрузить его нативный компонент node-pty. Остальные функции Lyra работают.",
		"update.appImageNotWritable": "Не удалось записать новую версию рядом с AppImage ({reason}). Переместите AppImage в папку, доступную для записи, или скачайте её со страницы выпуска.",
		"update.adminDismissed": "Права администратора не получены, обновление не установлено. При повторной попытке пароль будет запрошен снова.",
		"update.installFailed": "Установка не завершилась: {reason}",
	},
	ko: {
		"tray.show": "Lyra 열기", "tray.hide": "Lyra 숨기기", "tray.newChat": "새 대화", "tray.recent": "최근 대화", "tray.noChats": "아직 대화가 없습니다", "tray.pullRequests": "Pull request", "tray.scheduled": "예약됨", "tray.settings": "설정…", "tray.updates": "업데이트 확인…", "tray.launchAtLogin": "로그인할 때 실행", "tray.quit": "Lyra 종료", "dialog.projectDirectory": "프로젝트 폴더 선택", "dialog.screenshotDirectory": "스크린샷 저장 폴더 선택",
		"shortcut.taken": "전역 단축키 {shortcut}을(를) 등록하지 못했습니다. 다른 앱(예: WeChat의 스크린샷 키)이 이미 사용 중일 수 있습니다. 설정 → 스크린샷에서 다른 키를 지정하세요.",
		"shortcut.invalid": "전역 단축키 {shortcut}을(를) 인식할 수 없어 등록하지 않았습니다. 설정 → 스크린샷에서 다시 지정하세요.",
		"terminal.unavailable": "터미널을 시작할 수 없습니다. 네이티브 구성 요소 node-pty를 불러오지 못했습니다. Lyra의 다른 기능에는 영향이 없습니다.",
		"update.appImageNotWritable": "새 버전을 AppImage가 있는 폴더에 쓸 수 없습니다({reason}). AppImage를 쓰기 권한이 있는 위치로 옮기거나 릴리스 페이지에서 직접 내려받으세요.",
		"update.adminDismissed": "관리자 권한을 받지 못해 업데이트를 설치하지 않았습니다. 다시 시도하면 비밀번호를 다시 묻습니다.",
		"update.installFailed": "설치를 완료하지 못했습니다: {reason}",
	},
	ja: {
		"tray.show": "Lyra を開く", "tray.hide": "Lyra を隠す", "tray.newChat": "新しい会話", "tray.recent": "最近の会話", "tray.noChats": "会話はまだありません", "tray.pullRequests": "プルリクエスト", "tray.scheduled": "予約済み", "tray.settings": "設定…", "tray.updates": "アップデートを確認…", "tray.launchAtLogin": "ログイン時に起動", "tray.quit": "Lyra を終了", "dialog.projectDirectory": "プロジェクトフォルダーを選択", "dialog.screenshotDirectory": "スクリーンショットの保存先を選択",
		"shortcut.taken": "グローバルショートカット {shortcut} を登録できませんでした。ほかのアプリ（WeChat のスクリーンショットキーなど）がすでに使っている可能性があります。設定 → スクリーンショット で別のキーを選んでください。",
		"shortcut.invalid": "グローバルショートカット {shortcut} は認識できないため登録しませんでした。設定 → スクリーンショット で登録し直してください。",
		"terminal.unavailable": "ターミナルを起動できません。ネイティブコンポーネント node-pty を読み込めませんでした。Lyra のほかの機能には影響ありません。",
		"update.appImageNotWritable": "新しいバージョンを AppImage と同じフォルダーに書き込めませんでした（{reason}）。AppImage を書き込み可能な場所に移すか、リリースのページから手動でダウンロードしてください。",
		"update.adminDismissed": "管理者の許可が得られなかったため、アップデートはインストールされていません。再試行するともう一度パスワードを求められます。",
		"update.installFailed": "インストールが完了しませんでした: {reason}",
	},
};

export function resolveNativeLocale(locale: UiLocale, systemLocale: string): NativeLocale {
	if (locale !== "system") return locale;
	const normalized = systemLocale.trim().replaceAll("_", "-").toLowerCase();
	if (normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-mo" || normalized.startsWith("zh-hant")) return "zh-TW";
	if (normalized === "zh" || normalized.startsWith("zh-")) return "zh-CN";
	if (normalized === "fr" || normalized.startsWith("fr-")) return "fr";
	if (normalized === "ru" || normalized.startsWith("ru-")) return "ru";
	if (normalized === "ko" || normalized.startsWith("ko-")) return "ko";
	if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
	return "en";
}

export function nativeTranslator(locale: UiLocale, systemLocale: string): (key: NativeMessageKey) => string {
	const catalog = catalogs[resolveNativeLocale(locale, systemLocale)];
	return (key) => catalog[key];
}
