# 更新日志

这个文件由 `pnpm release` 生成，条目来自提交信息。写得含糊的提交在这里也含糊，所以值得在提交时就写清楚。

只收录 0.8.0 及之后的版本：更早的提交信息还没有统一格式，勉强解析出来的条目比留白更容易误导。
那些版本的说明在 [GitHub Releases](https://github.com/kittors/Lyra/releases) 里。

## [0.9.23](https://github.com/kittors/Lyra/releases/tag/v0.9.23) - 2026-10-10
<!-- lyra:notes en -->

### Features

- **Conversations backed by SQLite storage.** Conversation persistence has transitioned from fragmented JSONL files and a rewrite-heavy index to a unified SQLite database. Interrupted streaming replies survive crashes without message loss, write queues and indexing races are eliminated, and deleting chats no longer discards spending totals. Existing historical sessions import smoothly on first startup with legacy records safely preserved.

- **Redesigned modern workspace frame.** The workspace window layout has been overhauled with a dedicated top bar and icon strip, merging the sidebar and main workspace into a coherent surface. On macOS, native vibrancy glass shines through the window frame (configurable in Appearance).

- **Polished conversation interface and streaming.** Streamed assistant responses now animate smoothly, pin and auto-scroll cleanly without trailing cards popping the scroll position, and tool calls collapse into a concise single-row summary. Typography, padding, message bubbles, and file links have been systematically tightened.

- **Centered welcome screen with adaptive layout.** The welcome view centers the input card right below the mascot with quick prompt capsules. Chat column width now adapts automatically to window panes (scaling from compact views to 1120px wide workspaces).

- **Refined settings and models view.** Model configuration is reorganized into clean provider cards with inline latency and capability test badges. Control radii and paddings across settings pages are unified to 8px.

### Improvements & Fixes

- **Thorough legacy data cleanup on deletion.** Deleting a conversation now cleanly purges its historical `.jsonl` log files and display caches across all project folders, preventing deleted chats from resurfacing after database resets.

- **Panel window docking and split flexibility.** The auxiliary dock panel defaults back to split layout with multi-tab support, allowing terminals and browser tabs to dock cleanly beside conversations.

- **Popup layering and window header alignment.** Previews and modal overlays no longer clip over the native window title bar, notice toasts center properly in full-screen pane mode, and window title bars no longer jump 1px when maximized.

- **Accurate provider branding and theme switching.** Search engines, code hosts, and AI model icons now use official source vectors. Dark theme accurately honors the in-app setting rather than falling back to OS appearance, and StepFun models display their dedicated icon.

- **Windows path normalization in CI tests.** Resolved test path normalization across Windows platforms, ensuring hover-reveal and styling suites pass cleanly on all runners.

<!-- lyra:notes zh-CN -->

<details>
<summary>中文（简体）</summary>

### 新功能

- **会话全面升级为 SQLite 存储**。底层存储告别过去分散的 JSONL 文件与整份重写的 index.json，改由单个 SQLite 数据库事务化持久化。流式回复即使中途异常崩溃也不再丢失文字，彻底消除了写队列和索引并发竞态；删除会话不再冲掉历史花销统计。原有旧会话在初次打开时无缝迁移导入，旧文件完整保留作备份。

- **全新工作区外框与界面布局**。主窗口重新组织为顶栏与图标栏联动结构，侧边栏与主内容区合成连贯面板。macOS 窗口铺设系统毛玻璃材质，侧栏自然透出窗口质感（外观设置中可按需开关）。

- **流式输出平滑滚动与对话视觉收敛**。流式回复出字更加平滑自然，到底部时匀速上移，迟到的卡片不再猛然把历史消息顶上去；单轮多个工具调用默认折叠为单行精简摘要。对话气泡、正文排版、Markdown 标题与文件链接色均经过系统化收敛。

- **居中自适应欢迎页与托盘输入框**。欢迎页吉祥物、大标题与托盘输入框居中排列，下方配有平滑落下的提示词胶囊；对话栏宽度新增「自动」自适应档位，大屏下最高展开至 1120px，窄屏下自然铺满。

- **设置页与模型配置梳理**。模型设置全面重构为服务商列表加分组卡片视图，连通性测试结果直接反馈在按钮上；全应用按钮圆角统一为两档，设置页控件规整收敛为 8px。

### 优化与修复

- **会话删除连同旧日志彻底清理**。删掉会话后同步清理旧版 `.jsonl` 日志文件与 `index.json` 索引记录，并清空历史展示缓存，避免重新导入时删过的会话再度出现。

- **工作区面板恢复分栏与多标签支持**。面板默认收进对话右侧多标签栏，终端、浏览器可自由分栏停靠在对话另一侧。

- **弹出层与顶栏层级修复**。文件改动预览等浮层不再遮盖窗口顶栏；窗格全屏时标题不再跳动 1px；通知 Toast 居中对齐窗口内容。

- **服务商图标与深色主题纠正**。搜索引擎、代码托管与模型图标全部替换为各家官网发布的原件矢量图；阶跃星辰模型不再误显为豆包图标；深色样式严格遵循应用内的主题选择，不再跟随系统被动切回。

- **Windows 平台测试路径兼容**。规范化 Windows 平台下文件扫描的反斜杠路径，确保全平台自动化测试稳定通过。

</details>

<!-- lyra:notes zh-TW -->

<details>
<summary>中文（繁體）</summary>

### 新功能

- **工作階段全面升級為 SQLite 儲存**。底層儲存告別過去分散的 JSONL 檔案與整份重寫的 index.json，改由單個 SQLite 資料庫事務化持久化。串流回覆即使中途異常崩潰也不再遺失文字，徹底消除了寫入佇列和索引並行競態；刪除工作階段不再沖掉歷史花費統計。原有舊工作階段在初次開啟時無縫遷移匯入，舊檔案完整保留作備份。

- **全新工作區外框與介面版面配置**。主視窗重新組織為頂端列與圖示列連動結構，側邊欄與主內容區合成連貫面板。macOS 視窗鋪設系統毛玻璃材質，側欄自然透出視窗質感（外觀設定中可按需開關）。

- **串流輸出平滑捲動與對話視覺收斂**。串流回覆出字更加平滑自然，到底部時勻速上移，遲到的卡片不再猛然把歷史訊息頂上去；單輪多個工具呼叫預設摺疊為單行精簡摘要。對話氣泡、內文排版、Markdown 標題與檔案連結色均經過系統化收斂。

- **置中自適應歡迎頁與托盤輸入框**。歡迎頁吉祥物、大標題與托盤輸入框置中排列，下方配有平滑落下的提示詞膠囊；對話欄寬度新增「自動」自適應檔位，大螢幕下最高展開至 1120px，窄螢幕下自然鋪滿。

- **設定頁與模型設定梳理**。模型設定全面重構為服務商列表加分組卡片檢視，連線測試結果直接回饋在按鈕上；全應用程式按鈕圓角統一為兩檔，設定頁控制項規整收斂為 8px。

### 最佳化與修復

- **工作階段刪除連同舊記錄徹底清理**。刪除工作階段後同步清理舊版 `.jsonl` 記錄檔與 `index.json` 索引記錄，並清空歷史展示快取，避免重新匯入時刪過的工作階段再度出現。

- **工作區面板恢復分欄與多分頁支援**。面板預設收進對話右側多分頁列，終端機、瀏覽器可自由分欄停靠在對話另一側。

- **彈出層與頂端列層級修復**。檔案變更預覽等浮動層不再遮蓋視窗頂端列；窗格全螢幕時標題不再跳動 1px；通知 Toast 置中對齊視窗內容。

- **服務商圖示與深色主題糾正**。搜尋引擎、程式碼代管與模型圖示全部替換為各家官網發布的原件向量圖；階躍星辰模型不再誤顯為豆包圖示；深色樣式嚴格遵循應用程式內的主題選擇，不再跟隨系統被動切回。

- **Windows 平台測試路徑相容**。規範化 Windows 平台下檔案掃描的反斜線路徑，確保全平台自動化測試穩定通過。

</details>

<!-- lyra:notes ja -->

<details>
<summary>日本語</summary>

### 新機能

- **SQLite による会話ストレージの刷新**。従来の断片化された JSONL ファイルと index.json の全体書き換えから、単一の SQLite データベースによるトランザクション管理へ移行しました。ストリーミング応答の途中で異常終了してもテキストが失われず、書き込みキューや競合が解消されました。会話を削除しても利用料金の合計が消えません。既存の履歴は初回起動時に安全に移行されます。

- **新設計のワークスペースフレーム**。メインウィンドウが専用のトップバーとアイコンバーによる構成へ一新され、サイドバーとコンテンツがシームレスな単一パネルに統合されました。macOS ではシステム標準のすりガラス効果が適用されます（外観設定でオフ可能）。

- **ストリーミング応答の滑らかな表示と視覚的な改善**。文字出力が滑らかになり、最下部スクロール時に自然に押し上げられ、遅れて届いたカードで履歴が跳ね上がる現象を抑えました。ツール呼び出しはデフォルトで1行の概要に折りたたまれます。

- **中央配置のウェルカム画面と自動幅調整**。マスコットとトレイ型入力欄が中央に配置され、プロンプトカプセルが並びます。会話欄の幅に「自動」が追加され、最大 1120px までウィンドウ幅に合わせて自動調整されます。

- **設定画面とモデル設定の整理**。モデル設定がプロバイダー一覧とグループカード形式に再構成され、接続テストの結果がボタン上に直接表示されます。角丸や余白が 8px 基準に統一されました。

### 改善と修正

- **削除時の過去ログ完全クリーンアップ**。会話削除時に過去の `.jsonl` ログやインデックス、表示キャッシュを確実に消去し、再インポート時に削除済み会話が復活する問題を防ぎました。

- **ドックパネルの分割表示とマルチタブ対応**。パネルがマルチタブ形式で会話の右側に収まり、ターミナルやブラウザーを会話の横に自由に並べて配置できるようになりました。

- **レイヤー重なりとヘッダー表示の修正**。ファイル変更プレビューなどのポップアップがウィンドウのトップバーに重ならなくなり、全画面表示時のタイトルの 1px のズレやトーストのセンタリングを修正しました。

- **公式ロゴの適用とダークテーマの同期**。検索エンジンやモデルのアイコンを各社公式のベクターデータに更新しました。ダークテーマが OS ではなくアプリ内の設定に従うよう修正されました。

- **Windows 向けテストパスの正規化**。Windows 環境でのファイルパス正規化に対応し、全プラットフォームでのテスト通過を保証しました。

</details>

<!-- lyra:notes ko -->

<details>
<summary>한국어</summary>

### 새로운 기능

- **대화 저장소 SQLite 전환**。기존의 분산된 JSONL 파일과 index.json 전체 재작성 방식에서 단일 SQLite 데이터베이스 기반으로 전환되었습니다. 스트리밍 응답 도중 갑작스럽게 프로세스가 종료되어도 대화가 유실되지 않으며, 대화를 삭제해도 누적 사용 금액이 함께 지워지지 않습니다. 기존 대화 기록은 최초 실행 시 안전하게 자동 마이그레이션됩니다.

- **워크스페이스 프레임 및 레이아웃 개편**。상단 바와 아이콘 바가 결합된 구조로 개편되어 사이드바와 콘텐츠 영역이 일관된 단일 패널로 정돈되었습니다. macOS 환경에서는 시스템 블러 효과가 창 틀에 자연스럽게 적용됩니다(모양 설정에서 해제 가능).

- **스트리밍 출력 부드러운 스크롤 및 대화 화면 다듬기**。스트리밍 답변 텍스트 출력이 부드러워졌으며, 스크롤 최하단 도달 시 자연스럽게 위로 이동하여 뒤늦게 렌더링된 카드로 인해 화면이 튀는 현상을 방지했습니다. 여러 도구 호출은 기본 한 줄 요약으로 깔끔하게 접힙니다.

- **중앙 정렬 시작 화면 및 대화 너비 자동 맞춤**。시작 화면의 마스코트와 트레이형 입력창이 중앙에 정렬되고 추천 프롬프트 캡슐이 배치됩니다. 대화 너비에 "자동" 설정이 추가되어 최대 1120px까지 창 크기에 맞게 조절됩니다.

- **설정 및 모델 설정 화면 정리**。모델 설정이 공급자 목록 및 그룹 카드 뷰로 전면 개편되어 연결 테스트 결과가 버튼 위에 바로 표시됩니다. 전체 설정 요소의 라운딩과 여백이 8px로 통일되었습니다.

### 개선 및 수정

- **대화 삭제 시 레거시 로그 완전 정리**。대화를 지울 때 구버전 `.jsonl` 로그 파일과 인덱스, 뷰 캐시까지 깔끔하게 제거하여 데이터베이스 재구성 시 삭제된 대화가 다시 복원되지 않도록 수정했습니다.

- **작업 공간 패널 분할 복원 및 멀티 탭 지원**。패널이 대화창 우측 다중 탭으로 정돈되어 터미널과 브라우저를 대화 옆에 분할하여 배치할 수 있습니다.

- **팝업 레이어 및 상단 바 정렬 오류 해결**。파일 변경 미리보기 등의 오버레이가 창 상단 바를 가리지 않으며, 창 최대화 시 타이틀이 1px 튀던 문제와 토스트 중앙 정렬을 바로잡았습니다.

- **공식 브랜드 아이콘 반영 및 다크 모드 수정**。검색 엔진 및 모델 아이콘을 각 서비스의 공식 벡터 이미지로 교체했습니다. 다크 테마가 OS 테마와 무관하게 앱 설정에 따라 정확히 유지됩니다.

- **Windows 환경 경로 호환성 개선**。Windows 플랫폼에서 역슬래시 파일 경로를 정규화하여 모든 테스트가 정상 통과하도록 처리했습니다.

</details>

<!-- lyra:notes fr -->

<details>
<summary>Français</summary>

### Fonctionnalités

- **Persistance des conversations sous SQLite.** Le stockage abandonne les multiples fichiers JSONL et les réécritures complètes d'index au profit d'une base de données SQLite transactionnelle. Les réponses en cours de streaming résistent aux plantages inattendus, et la suppression d'une conversation ne supprime plus l'historique des dépenses cumulées. Les anciennes sessions sont importées en toute sécurité au premier démarrage.

- **Cadre d'espace de travail modernisé.** La fenêtre principale intègre une barre supérieure dédiée et un ruban d'icônes, unifiant la barre latérale et la zone principale en un seul panneau fluide. Sous macOS, l'effet de flou natif sublime le contour de la fenêtre (désactivable dans les réglages d'apparence).

- **Défilement fluide du texte et interface resserrée.** L'apparition du texte en continu gagne en fluidité, l'auto-défilement vers le bas s'effectue sans à-coups et l'exécution d'outils successifs est condensée par défaut sur une seule ligne. Les bulles, les titres et les liens de fichiers ont été visuellement harmonisés.

- **Écran d'accueil centré et largeur adaptative.** L'écran d'accueil présente la mascotte et la zone de saisie centrées avec des capsules de suggestions. La largeur de la conversation s'ajuste désormais automatiquement à la taille de la fenêtre (jusqu'à 1120 px).

- **Refonte des paramètres et des modèles.** La configuration des modèles est réorganisée sous forme de cartes claires par fournisseur, affichant les tests de latence directement sur les boutons. Les arrondis et marges sont alignés sur 8 px.

### Améliorations et corrections

- **Nettoyage complet des anciens fichiers lors de la suppression.** Supprimer une conversation efface désormais ses fichiers de journalisation `.jsonl` et ses caches d'affichage résiduels dans tous les dossiers de projet, évitant que des échanges effacés ne réapparaissent lors d'une restauration.

- **Flexibilité du panneau latéral et onglets.** Le panneau secondaire se loge à nouveau à droite de la conversation sous forme d'onglets multiples, permettant d'afficher terminaux et navigateurs côte à côte avec la discussion.

- **Superposition des fenêtres et en-têtes.** Les fenêtres de prévisualisation ne recouvrent plus la barre de titre native, les notifications s'affichent au centre exact et le décalage de 1 px lors du passage en plein écran a été éliminé.

- **Icônes vectorielles officielles et thème sombre.** Les moteurs de recherche et modèles adoptent leurs logos vectoriels d'origine. Le thème sombre respecte fidèlement les préférences de l'application sans dépendre du système d'exploitation.

- **Normalisation des chemins sous Windows.** Les séparateurs de chemins dans les suites de tests automatisées sont uniformisés pour garantir une validation intégrale sous Windows.

</details>

<!-- lyra:notes ru -->

<details>
<summary>Русский</summary>

### Новые возможности

- **Хранение бесед в базе данных SQLite.** Хранилище переведено с разрозненных файлов JSONL и перезаписываемого index.json на транзакционную базу данных SQLite. Потоковые ответы ассистента больше не теряются при аварийном завершении, а удаление беседы не сбрасывает общую статистику расходов. Ранее созданные беседы автоматически переносятся при первом запуске.

- **Обновлённое обрамление рабочей области.** Интерфейс окна переработан с верхней панелью и вертикальной полосой значков, объединяя боковую панель и контент в цельную поверхность. На macOS задействован системный эффект матового стекла (отключается в настройках оформления).

- **Плавный вывод текста и компактные вызовы инструментов.** Потоковый вывод сообщений стал плавным, автопрокрутка к нижнему краю работает без рывков, а цепочки вызовов инструментов по умолчанию свернуты в одну строку. Стили сообщений, заголовки и ссылки приведены к единому стандарту.

- **Центрированный экран приветствия и адаптивная ширина.** Стартовый экран центрирует маскот и поле ввода, дополняя их капсулами быстрых подсказок. Добавлен «Автоматический» режим ширины беседы, динамически подстраивающийся под размеры окна (до 1120px).

- **Улучшенные настройки и профили моделей.** Меню моделей преобразовано в удобный список провайдеров с карточками, а статус проверки подключения отображается прямо на кнопках. Скругления элементов интерфейса унифицированы до 8px.

### Улучшения и исправления

- **Полная очистка устаревших файлов при удалении.** Удаление беседы теперь очищает старые файлы `.jsonl`, индексные записи и кэш во всех каталогах проектов, исключая возврат удалённых бесед при переиндексации.

- **Многовкладочная панель и разделение экранов.** Вспомогательная панель снова аккуратно сворачивается в правую колонку с вкладками, позволяя размещать терминалы и веб-страницы рядом с диалогом.

- **Исправление слоев и заголовков окон.** Всплывающие окна предпросмотра файлов больше не перекрывают верхнюю панель окна, устранён сдвиг заголовка на 1px в полноэкранном режиме, а уведомления центрируются строго по окну.

- **Официальные значки провайдеров и темная тема.** Иконки поисковых систем, сервисов и моделей заменены на официальные векторные оригиналы. Тёмная тема теперь строго следует выбору в приложении и не переключается от системных настроек.

- **Нормализация путей Windows в автотестах.** Унифицированы обратные слэши при поиске компонентов в тестах для надёжного прохождения на платформе Windows.

</details>

## [0.9.22](https://github.com/kittors/Lyra/releases/tag/v0.9.22) - 2026-09-29
<!-- lyra:notes en -->

### Features

- **Fork a conversation from any message.** A new "Fork from here" button on your own messages starts a fresh conversation containing everything up to that point, places that message (along with any attachments, images or referenced sessions) back into the input box ready to edit, and leaves the original conversation untouched. It can be triggered while a turn is running, respects previous context compaction boundaries, and carries over any mid-turn model switches.

- **Context menu for files in conversations.** Right-clicking any file row in the delivery card, the title bar of the diff panel, or a file link in markdown opens a menu with options to open it in your default editor (such as Zed, Cursor or VS Code), choose an application, reveal in Finder or File Explorer, and copy absolute or relative paths.

### Improvements & Fixes

- **Delivery card and changes panel stay in sync after undoing.** Undoing changes to a file from the changes panel (docked or popped out into its own window) immediately updates the delivery card so it no longer shows an invalid undo action that fails when clicked.

- **Notice toasts in popped-out windows return to center.** In detached panel windows and standalone conversation windows without a sidebar, notice toasts are now centered instead of shifting to the right by the width of a nonexistent sidebar.

- **Detached changes panel displays the selected file diff.** Popping out the file changes panel into an independent window now properly shows the selected file's diff and responds to file selection changes in the main window, rather than showing an empty state.

- **Testing connection on Chat Completions proxies and Gemini compatibility.** Testing a connection against a Chat Completions proxy no longer returns a 404. Gemini models on Chat Completions no longer return 400 errors when reasoning is disabled.

- **Typography and layout polish on Windows and Linux.** Windows font rendering now aligns Chinese punctuation and character sizing with macOS (avoiding SimSun fallbacks), light-mode gray text contrast is improved, and header corner radii and sidebar toggling behaviors are smoothed out.

<!-- lyra:notes zh-CN -->

<details>
<summary>中文（简体）</summary>

### 新功能

- **用户消息上可以「从这里分叉」了。** 在自己说过的一句话上点「从这里分叉」，新开一个会话装着它之前的全部历史，这句话（连同图片、附件、会话引用）回到新会话的输入框里，原会话一个字不动。在回合运行中也能分叉，保留已有的上下文压缩边界，并完整带走中途换过的模型设置。

- **对话里的文件支持右键菜单。** 在「已编辑文件」交付卡片的文件行、差异面板里每个文件的标题行、以及回复里的文件链接上点击右键，可以快速在默认编辑器（如 Zed、Cursor、VS Code）中打开、选择打开方式、在访达或资源管理器中定位，以及复制绝对或相对路径。

### 优化与修复

- **文件变更面板撤销后，交付卡片同步更新。** 在文件变更面板（停靠或弹出成独立窗口）中撤销某个文件的改动后，交付卡片立即同步最新状态，不再留着一个按下去就报错的「撤销」按钮。

- **弹出窗口与独立会话窗口中，提示条回到正中。** 在没有侧栏的面板窗口和独立会话窗口里，提示条不再错误让出不存在的侧栏宽度，居中显示在窗口正中央。

- **文件变更面板弹出成独立窗口后显示文件差异。** 弹出为独立窗口后，面板能正确显示选中文件的 diff 内容，且在主窗口切换文件时同步跟随更新，不再显示空状态。

- **Chat Completions 中转测试连接与 Gemini 兼容性修复。** 在 Chat Completions 端点上测试连接不再错误报 404；Chat Completions 下关闭推理的 Gemini 模型不再因 reasoning_effort 参数报错 400。

- **Windows 与 Linux 排版及界面细节对齐。** Windows 平台上的中文标点与字号对齐 macOS 显示效果（不再退回宋体），浅色主题下灰字对比度提升，顶部圆角与侧栏折叠动画更平滑。

</details>

<!-- lyra:notes zh-TW -->

<details>
<summary>中文（繁體）</summary>

### 新功能

- **使用者訊息上可以「從這裡分叉」了。** 在自己說過的一句話上點「從這裡分叉」，新開一個工作階段裝著它之前的所有歷史，這句話（連同圖片、附件、工作階段引用）回到新工作階段的輸入框中，原工作階段完全不動。在回合執行中也能分叉，保留已有的上下文壓縮邊界，並完整帶走中途換過的模型設定。

- **對話裡的檔案支援右鍵選單。** 在「已編輯檔案」交付卡片的檔案列、差異面板中每個檔案的標題列、以及回覆裡的檔案連結上點擊右鍵，可以快速在預設編輯器（如 Zed、Cursor、VS Code）中開啟、選擇開啟方式、在訪達或檔案總管中定位，以及複製絕對或相對路徑。

### 最佳化與修復

- **檔案變更面板撤銷後，交付卡片同步更新。** 在檔案變更面板（停靠或彈出成獨立視窗）中撤銷某個檔案的變更後，交付卡片立即同步最新狀態，不再留著一個按下去就報錯的「撤銷」按鈕。

- **彈出視窗與獨立工作階段視窗中，提示條回到正中。** 在沒有側欄的面板視窗和獨立工作階段視窗裡，提示條不再錯誤讓出不存在的側欄寬度，置中顯示在視窗正中央。

- **檔案變更面板彈出成獨立視窗後顯示檔案差異。** 彈出為獨立視窗後，面板能正確顯示選中檔案的 diff 內容，且在主視窗切換檔案時同步跟隨更新，不再顯示空狀態。

- **Chat Completions 中轉測試連線與 Gemini 相容性修復。** 在 Chat Completions 端點上測試連線不再錯誤報 404；Chat Completions 下關閉推理的 Gemini 模型不再因 reasoning_effort 參數報錯 400。

- **Windows 與 Linux 排版及介面細節對齊。** Windows 平台上的中文標點與字級對齊 macOS 顯示效果（不再退回宋體），淺色主題下灰字對比度提升，頂部圓角與側欄折疊動畫更平滑。

</details>

<!-- lyra:notes ja -->

<details>
<summary>日本語</summary>

### 新機能

- **ユーザーメッセージから「ここから分岐」できるようになりました。** 自分が送信したメッセージで「ここから分岐」をクリックすると、それ以前の履歴をすべて引き継いだ新しい会話が開きます。その発言（画像、添付ファイル、会話の参照を含む）は新しい会話の入力欄に戻り、元の会話はそのまま維持されます。ターンの実行中でも分岐可能で、圧縮境界を正しく引き継ぎ、途中で切り替えたモデルの設定もそのまま反映されます。

- **会話内のファイルに右クリックメニューを追加しました。** 変更ファイルカードの行、差分パネルの各ファイルの見出し行、返信内のファイルリンクを右クリックすると、デフォルトのエディター（Zed、Cursor、VS Code など）で開く、アプリケーションの選択、Finder やエクスプローラーでの表示、絶対パスや相対パスのコピーを行えます。

### 改善と修正

- **変更パネルでの取り消し後、配信カードが即座に同期されます。** ファイル変更パネル（ドッキングまたは独立ウィンドウ）でファイルの変更を取り消した際、配信カードの状態が即時更新され、クリックしても失敗する無効な「取り消し」ボタンが残らなくなりました。

- **ポップアウトしたウィンドウで通知トーストが中央に戻りました。** サイドバーのない独立したパネルウィンドウや単独会話ウィンドウで、存在しないサイドバー分の余白を避けることなく、ウィンドウの正確な中央に通知が表示されます。

- **独立ウィンドウにポップアウトしたファイル変更パネルで差分が正常に表示されます。** 独立ウィンドウとして分離した際も選択されたファイルの diff が正しく表示され、メインウィンドウでの選択変更にも連動するようになりました。空状態にはなりません。

- **Chat Completions プロキシでの接続テストと Gemini の互換性を修正しました。** Chat Completions エンドポイントでの接続テストが 404 で失敗しなくなりました。また、Chat Completions 経由で推論をオフにした Gemini モデルが reasoning_effort パラメーターによって 400 エラーになる問題を解決しました。

- **Windows および Linux でのタイポグラフィとレイアウトの改善。** Windows での句読点や文字サイズを macOS の表示に揃え（SimSun へのフォールバックを防止）、ライトテーマ時のグレー文字のコントラストを向上させ、ヘッダー角丸やサイドバー開閉アニメーションを整えました。

</details>

<!-- lyra:notes ko -->

<details>
<summary>한국어</summary>

### 새로운 기능

- **사용자 메시지에서 "여기서 갈라내기"가 가능해졌습니다.** 본인이 보낸 메시지에서 "여기서 갈라내기"를 누르면, 그 이전까지의 모든 기록을 담은 새 대화가 열립니다. 해당 메시지(이미지, 첨부 파일, 대화 참조 포함)는 새 대화의 입력창에 그대로 복원되며, 기존 대화는 전혀 변경되지 않습니다. 턴이 실행 중일 때도 갈라낼 수 있고, 이전의 컨텍스트 압축 경계를 유지하며, 대화 도중 바꾼 모델 설정도 함께 이어집니다.

- **대화 내 파일에 우클릭 메뉴가 추가되었습니다.** 전달 카드의 파일 목록, 변경 사항 패널의 파일 제목 줄, 답변 속 파일 링크에서 마우스 오른쪽 버튼을 누르면 기본 편집기(Zed, Cursor, VS Code 등)로 열기, 다른 앱으로 열기, Finder 또는 파일 탐색기에서 보기, 절대 경로 및 상대 경로 복사가 가능합니다.

### 개선 및 수정

- **파일 변경 패널에서 되돌린 후 전달 카드가 즉시 동기화됩니다.** 패널(도킹 또는 독립 창)에서 파일 변경을 되돌리면 전달 카드에 최신 상태가 즉시 반영되어, 누르면 오류가 나는 쓸모없는 "되돌리기" 버튼이 남아 있지 않습니다.

- **독립 창에서 알림 토스트가 다시 가운데로 배치됩니다.** 사이드바가 없는 독립 패널 창이나 단독 대화 창에서 존재하지 않는 사이드바 너비만큼 밀려나지 않고 창의 정중앙에 알림이 표시됩니다.

- **독립 창으로 분리한 파일 변경 패널이 파일 차이(diff)를 정상 표시합니다.** 독립 창으로 띄웠을 때 선택한 파일의 diff가 정상 출력되며, 메인 창에서 파일을 바꿀 때도 즉시 연동되어 빈 화면이 나타나지 않습니다.

- **Chat Completions 프록시 연결 테스트 및 Gemini 호환성 수정.** Chat Completions 엔드포인트에서 연결 테스트 시 404가 발생하지 않습니다. Chat Completions 환경에서 추론 강도를 끈 Gemini 모델이 reasoning_effort 매개변수로 인해 400 오류를 반환하던 문제를 해결했습니다.

- **Windows 및 Linux 서체 및 레이아웃 개선.** Windows에서 한자 및 문장 부호 렌더링을 macOS 수준으로 맞추고(바탕체 대체 방지), 라이트 모드 회색 텍스트 대비를 개선했으며 상단 모서리 라운딩과 사이드바 전환 동작을 매끄럽게 다듬었습니다.

</details>

<!-- lyra:notes fr -->

<details>
<summary>Français</summary>

### Fonctionnalités

- **Bifurquer une conversation depuis n'importe quel message.** Un nouveau bouton « Bifurquer d'ici » sur vos messages ouvre une nouvelle conversation reprenant l'historique complet jusqu'à ce point, replace votre message (avec ses images, pièces jointes et références) dans la zone de saisie prêt à être modifié, tout en laissant la conversation d'origine intacte. La bifurcation fonctionne pendant qu'un tour est en cours, conserve les limites de compactage de contexte et préserve les changements de modèle intervenus en cours de route.

- **Menu contextuel pour les fichiers dans les conversations.** Un clic droit sur une ligne de fichier dans la carte de livraison, sur le titre d'un fichier dans le panneau des différences ou sur un lien de fichier dans le texte ouvre un menu complet : ouvrir dans votre éditeur par défaut (Zed, Cursor, VS Code, etc.), choisir une application, afficher dans le Finder ou l'Explorateur de fichiers, et copier le chemin absolu ou relatif.

### Améliorations et corrections

- **Synchronisation immédiate après annulation dans le panneau des modifications.** Annuler les modifications d'un fichier depuis le panneau des différences (ancré ou détaché) met aussitôt à jour la carte de livraison, évitant d'afficher un bouton d'annulation périmé qui échoue au clic.

- **Centrage des notifications dans les fenêtres détachées.** Dans les fenêtres de panneau détachées et les fenêtres de conversation autonomes sans barre latérale, les notifications s'affichent désormais au centre exact de la fenêtre au lieu d'être décalées de la largeur d'une barre latérale inexistante.

- **Affichage des différences dans le panneau détaché.** Ouvrir le panneau des modifications de fichiers dans une fenêtre indépendante affiche correctement les différences du fichier sélectionné et suit les sélections de la fenêtre principale, au lieu de rester sur un état vide.

- **Test de connexion des proxys Chat Completions et compatibilité Gemini.** Tester la connexion sur un proxy Chat Completions ne renvoie plus d'erreur 404. Les modèles Gemini appelés via Chat Completions ne renvoient plus d'erreur 400 lorsque le raisonnement est désactivé.

- **Harmonisation de la typographie et de la mise en page sous Windows et Linux.** Le rendu typographique sous Windows aligne désormais la ponctuation et la taille des caractères sur macOS (évitant le repli sur SimSun), le contraste du texte gris en mode clair est rehaussé, et les arrondis de bordure ainsi que l'animation de la barre latérale sont affinés.

</details>

<!-- lyra:notes ru -->

<details>
<summary>Русский</summary>

### Новые возможности

- **Ответвление беседы от любого сообщения.** Новая кнопка «Ответвиться отсюда» на вашем сообщении открывает новую беседу со всей историей до этой точки, возвращает сообщение (включая изображения, вложения и ссылки на беседы) в поле ввода для правки и оставляет исходную беседу без изменений. Ответвление работает даже во время выполнения хода, сохраняет границы сжатия контекста и учитывает переключения моделей, сделанные в процессе.

- **Контекстное меню для файлов в беседах.** Щелчок правой кнопкой мыши по строке файла в карточке доставки, заголовку файла в панели изменений или ссылке на файл в тексте открывает меню: открыть в редакторе по умолчанию (Zed, Cursor, VS Code и др.), выбрать приложение, показать в Finder или Проводнике, а также скопировать абсолютный или относительный путь.

### Улучшения и исправления

- **Карточка доставки синхронизируется при отмене изменений.** Отмена изменений файла в панели изменений (закреплённой или открытой в отдельном окне) сразу обновляет карточку доставки, так что в ней больше не остаётся устаревшая кнопка отмены, вызывающая ошибку при нажатии.

- **Уведомления в отдельных окнах снова отображаются по центру.** В откреплённых окнах панелей и автономных окнах бесед уведомления центрируются ровно по окну, не смещаясь вправо на ширину отсутствующей боковой панели.

- **Откреплённая панель изменений отображает различия выбранного файла.** При открытии панели изменений файлов в отдельном окне корректно показываются различия для выбранного файла, а при смене файла в основном окне содержимое синхронно обновляется вместо пустого экрана.

- **Проверка подключения для прокси Chat Completions и совместимость с Gemini.** Проверка подключения к конечным точкам Chat Completions больше не возвращает ошибку 404. Модели Gemini при обращении через Chat Completions больше не завершаются ошибкой 400 при отключённом рассуждении.

- **Шрифты и интерфейс в Windows и Linux.** Отображение знаков препинания и размер символов в Windows согласованы с macOS (без переключения на SimSun), контраст серого текста в светлой теме повышен, а скругления заголовков и поведение боковой панели стали более плавными.

</details>
## [0.9.21](https://github.com/kittors/Lyra/releases/tag/v0.9.21) - 2026-09-28
<!-- lyra:notes en -->

### Improvements & Fixes

- **Running a command outside the sandbox is approved one call at a time.** The card that asks to leave the sandbox offered "Stop asking", and one click was a standing permission: that command then ran outside the sandbox in every mode, without asking again. The card now offers only "No" and "Allow once". Permissions of this kind remembered by earlier versions no longer apply and are no longer listed under Always allowed in Settings › Access. An approval request that arrives while you are in another conversation also keeps the agent's reason for when you come back.

<!-- lyra:notes zh-CN -->

<details>
<summary>中文（简体）</summary>

### 优化与修复

- **到沙箱外执行的命令，每次都单独问你。** 申请到沙箱外执行的卡片以前带「以后不再问」，点一下就成了长期许可：同一条命令此后在任何模式下都直接到沙箱外执行，不再问你。现在这张卡片只有「拒绝」和「允许一次」；旧版本记下的这类许可不再生效，也不再列在「访问授权」的「始终允许」里。你在别的会话时收到的授权请求，切回来后也不会丢掉智能体写的理由。

</details>

<!-- lyra:notes zh-TW -->

<details>
<summary>中文（繁體）</summary>

### 最佳化與修復

- **到沙箱外執行的命令，每次都單獨詢問你。** 申請到沙箱外執行的卡片以前有「以後不再問」，點一下就成了長期許可：同一條命令此後在任何模式下都直接到沙箱外執行，不再詢問你。現在這張卡片只有「拒絕」和「允許一次」；舊版本記下的這類許可不再生效，也不再列在「存取授權」的「始終允許」中。你在其他對話時收到的授權請求，切回來後也不會遺失智慧體寫的理由。

</details>

<!-- lyra:notes ja -->

<details>
<summary>日本語</summary>

### 改善と修正

- **サンドボックスの外で実行するコマンドは、毎回個別に確認します。** サンドボックスの外での実行を求めるカードには以前「今後は尋ねない」があり、一度押すと恒久的な許可になっていました。同じコマンドはその後どのモードでも、確認なしにサンドボックスの外で実行されていました。このカードには今「断る」と「一度だけ許可」しかありません。以前のバージョンが記録したこの種の許可は無効になり、「アクセス権」の「常に許可」にも表示されなくなりました。別の会話を開いている間に届いた承認リクエストも、戻ったときにエージェントが書いた理由を失わなくなりました。

</details>

<!-- lyra:notes ko -->

<details>
<summary>한국어</summary>

### 개선 및 수정

- **샌드박스 밖에서 실행할 명령은 매번 따로 묻습니다.** 샌드박스 밖 실행을 요청하는 카드에는 예전에 "앞으로 묻지 않기"가 있었고, 한 번 누르면 영구 허가가 되었습니다. 같은 명령이 이후 어떤 모드에서든 묻지 않고 샌드박스 밖에서 실행되었습니다. 이제 이 카드에는 "거절"과 "한 번만 허용"만 있습니다. 이전 버전이 기록한 이런 허가는 더 이상 적용되지 않으며, "접근 권한"의 "항상 허용" 목록에도 나오지 않습니다. 다른 대화를 보고 있는 동안 도착한 승인 요청도 돌아왔을 때 에이전트가 쓴 이유를 잃지 않습니다.

</details>

<!-- lyra:notes fr -->

<details>
<summary>Français</summary>

### Améliorations et corrections

- **Exécuter une commande hors du bac à sable se valide à chaque fois.** La carte qui demande à sortir du bac à sable proposait « Ne plus demander », et un clic valait autorisation permanente : la même commande s’exécutait ensuite hors du bac à sable, dans tous les modes, sans plus rien demander. La carte ne propose désormais que « Refuser » et « Autoriser une fois ». Les autorisations de ce type enregistrées par les versions précédentes ne s’appliquent plus et ne figurent plus dans « Toujours autorisé », dans Accès. Une demande d’approbation reçue pendant que vous étiez dans une autre conversation garde aussi la raison donnée par l’agent.

</details>

<!-- lyra:notes ru -->

<details>
<summary>Русский</summary>

### Улучшения и исправления

- **Команда вне песочницы подтверждается каждый раз отдельно.** В карточке запуска вне песочницы была кнопка «Больше не спрашивать», и одно нажатие становилось постоянным разрешением: та же команда потом выполнялась вне песочницы в любом режиме без вопросов. Теперь в этой карточке только «Отказать» и «Разрешить один раз». Такие разрешения, сохранённые прежними версиями, больше не действуют и не показываются в списке «Всегда разрешено» в разделе «Доступ». Запрос на подтверждение, пришедший, пока вы были в другой беседе, тоже сохраняет объяснение агента.

</details>

## [0.9.20](https://github.com/kittors/Lyra/releases/tag/v0.9.20) - 2026-09-27
<!-- lyra:notes en -->

### Features

- **The phone app is redesigned for touch.** Press and hold a conversation or a message and it lifts out of a blurred list with its menu beside it, and the phone taps back. Conversations sit in two-line rows above a floating bar with settings, search and a new chat. Every control in the composer is at least 44 points, the model's full name fits, and the reasoning effort is a small gauge. Uploads show a card with their progress, a cancel and a retry.

- **Large conversations and files get through to the phone.** Opening a big conversation through the relay server used to keep dropping the connection; it now opens in about a second. Sending 100 MB used to disconnect with the phone at 1.3 GB of memory; on the LAN it takes 5 seconds and the phone stays under 91 MB. Files stream to disk, resume after a dropped connection and can be up to 2 GB. Old and new versions of the desktop app, the phone app and the relay work with each other without pairing again.

- **Sub-agents stop at checkpoints, not at the end.** A sub-agent that reaches its step limit hands back what it did, what is left and what it would do next, and keeps its context, so it can carry on instead of being dispatched again from nothing. On the same task that took about 74% fewer input tokens. An unfinished sub-agent can be handed back to the main agent to continue with one click.

- **Sub-agents run side by side, and you can speak while they work.** Sub-agents that don't depend on each other go out together and the rest queue for a free slot; four used to run one after another. A message sent while the main conversation waits on them no longer sits for minutes: the conversation answers, the sub-agents finish in the background and their results come back to it. Requests carry a cache key, so a relay that pools accounts no longer misses the cache on each sub-agent's first requests. An approval card says which sub-agent is asking.

- **Switching models mid-turn takes effect on the next request.** A request stuck retrying on a broken upstream lets go and goes to the new model — no need to stop or edit the message.

- **The Plugin Market is one grid with one action per card,** filtered by kind and category. An MCP server that needs a key says which one and where to get it, and the key goes into the vault instead of settings.json. Installed plugins and skills update themselves (checked every 30 minutes, and it can be turned off), and a plugin's README is rendered.

- **Each agent has its own look.** Pick a shape and a colour in the agent's editor, or shuffle one; the sub-agent panel and menu, @-mentions and the settings pages show it.

- **Web pages the agent works in stay in the background.** The browser panel used to open over your work every time the agent clicked something; it now stays shut, and a card in the conversation shows a thumbnail, the title and an Open button.

### Improvements & Fixes

- **Windows and Linux: the sandbox actually confines commands.** On Windows it had never started — with Auto approve, every command reported that no sandbox backend was available. Constrained commands now run in PowerShell under a restricted token, and Linux systems without bubblewrap use Landlock.

- **With Auto approve, running a command outside the sandbox always asks you first.** The request used to go to the risk check, which could let `rm -rf` through without asking.

- **A command's result is read the way the shell means it.** `gh pr checks` exits with 8 while checks are still running — an answer, not a red cross; 13 of 59 "failures" in real sessions were answers like that. `read` and installer prompts no longer hang until the timeout, `server &` no longer blocks the call, and an app started from the Dock picks up your login shell's proxy, SSH agent and locale.

- **In Split view, each screen acts on its own conversation.** Drafts, sending, the branch menu, model and reasoning effort, "Run it in the terminal", file links, panels, the Side chat, the project menu and delivery review all followed whichever screen had focus; from the keyboard, a message or an undo could land in the conversation next to the one you were in.

- **The interface keeps to its language.** English no longer says "1 conversations" or "1 commits behind", and French and Russian choose the right form for each number. System notifications, scheduled-task notices, file and pull-request errors, dates and timestamps follow the interface language instead of staying in Chinese.

- **A scheduled task that fails now says so.** Its notices had never been shown. A failed run is written on its card under Scheduled, and a line above the composer points to it.

- **The skills, plugins, rules and commands pages count files, not lines.** With two skills installed, a page could say "4 skills have descriptions too short". Warnings now have a card of their own, and a list reordered by a rescan no longer draws the same row twice.

- **On Windows and Linux:** editing a CRLF file keeps its line endings; letter shortcuts follow the keyboard layout (AZERTY, Dvorak, Russian); Delete removes a file and Ctrl+C copies in the terminal; the interface no longer collapses to two font weights; Linux installs its updates, and Wayland no longer asks to share the screen at every launch.

- **On the phone:** every attachment sent from the phone failed; on iOS the page shrank to 68 points when the keyboard opened; over the LAN, no Copy button did anything.

<!-- lyra:notes zh-CN -->

<details>
<summary>中文（简体）</summary>

### 新功能

- **手机端按触控重新设计。** 长按会话或消息，它会从虚化的列表里浮起来，菜单出现在旁边，手机同时轻震一下。会话列表一条两行，底部浮着设置、搜索和新对话。输入框里每个控件至少 44 点，模型名显示完整，推理强度换成一个小仪表。上传有进度卡片，能取消、能重试。

- **大会话、大文件能送到手机上了。** 经中转服务器打开一个大会话，以前反复断线，现在一秒左右打开。发 100 MB 以前会断线，手机内存涨到 1.3 GB；现在局域网下 5 秒传完，手机内存不到 91 MB。文件边收边写盘，断线能续传，最大 2 GB。新旧版本的桌面端、手机端和中转可以混用，不用重新配对。

- **子 Agent 停在检查点，而不是停在终点。** 步数用完时，它交回做了什么、还剩什么、下一步打算做什么，上下文留着，可以接着跑，不用从零再派一次。同一件任务实测输入 token 少了约 74%。没跑完的子 Agent 点一下就能让主 Agent 接着跑它。

- **子 Agent 一起跑，跑的时候你也能说话。** 互不依赖的子 Agent 同一轮一起派出，超出并发上限的自动排队；以前四个会排成一串，一个接一个跑。主会话等子 Agent 时你发一句话，不用再等两分多钟：主会话先回你，子 Agent 在后台跑完，结果再交回来。请求带上缓存键，经号池中转时，子 Agent 开头几次请求不再次次错过缓存。授权卡片会写明是哪个子 Agent 在要。

- **一轮之内换模型，下一个请求就生效。** 卡在上游重试里的请求会当场放手，改由新模型接着回答，不用先停止或编辑消息。

- **插件市场改成一个网格，一张卡片一个动作**，可按种类和分类筛选。需要密钥的 MCP 服务器会说明要哪一个、去哪申请，密钥存进保险箱，不再写进 settings.json。装过的插件和技能自动跟上新版（每 30 分钟检查一次，可以关掉），插件的 README 会渲染出来。

- **每个智能体有了自己的形象。** 在智能体编辑页挑形状和颜色，或者随机换一个；子 Agent 面板和菜单、@ 提及、设置页里都显示它。

- **智能体打开的网页留在后台。** 以前智能体每点一下，浏览器面板就弹出来盖住你正在看的东西；现在面板保持关闭，对话里留一张带缩略图、标题和「打开」按钮的卡片。

### 优化与修复

- **Windows 和 Linux 上沙箱真正起作用了。** Windows 上它从来没启动成功过：开着「帮我批准」时，每条命令都提示没有可用的沙箱后端。现在受约束的命令在受限令牌下的 PowerShell 里执行；Linux 上没装 bubblewrap 的系统改用 Landlock。

- **开着「帮我批准」时，要到沙箱外执行的命令一律先问你。** 以前这类请求交给风险判定，`rm -rf` 可能不问就放行。

- **命令的结果按 shell 的本意来读。** 检查还没跑完时 `gh pr checks` 的退出码是 8，这是回答，不是红叉；真实会话里 59 条「失败」有 13 条是这种。`read` 和安装程序的确认提示不再挂到超时，`server &` 不再卡住调用；从程序坞启动也能拿到登录 shell 的代理、SSH agent 和语言环境。

- **分屏时每一屏只作用于自己的会话。** 草稿、发送、分支菜单、模型与推理强度、「在终端运行」、文件链接、面板、侧边聊天、项目菜单和交付审核，以前都跟着有焦点的那一屏走；用键盘操作时，一条消息或一次撤回可能落到旁边那个会话里。

- **界面语言一贯到底。** 英文不再出现「1 conversations」「1 commits behind」，法语和俄语也按数量选对词形。系统通知、定时任务提示、文件和拉取请求的报错、日期和时间都跟随界面语言，不再停在中文。

- **定时任务失败会说出来了。** 它的提示以前从来没显示过。现在失败写在「已安排」里的任务卡片上，输入框上方也有一行提示指过去。

- **技能、插件、规则、命令页按文件计数，不再按行。** 只装了两个技能，页面却可能写着「4 个技能的描述太短」。警告现在单独一张卡片，重新扫描后列表换了顺序，也不会把同一行画两遍。

- **Windows 和 Linux：** 编辑 CRLF 文件不再改掉原来的换行；字母快捷键按键盘布局识别（AZERTY、Dvorak、俄文）；Delete 删除文件，终端里 Ctrl+C 是复制；界面字重不再只剩两档；Linux 能装上自动更新，Wayland 不再每次启动都请求共享屏幕。

- **手机端：** 从手机发的附件以前全部失败；iOS 上键盘弹出后页面缩成 68 点高；局域网连接时，每个「复制」按钮都不起作用。

</details>

<!-- lyra:notes zh-TW -->

<details>
<summary>中文（繁體）</summary>

### 新功能

- **手機端依觸控重新設計。** 長按對話或訊息，它會從模糊的列表中浮起，選單出現在旁邊，手機同時輕震一下。對話列表一則兩行，底部浮著設定、搜尋與新對話。輸入框裡每個控制項至少 44 點，模型名稱完整顯示，推理強度改成一個小儀表。上傳有進度卡片，可以取消、可以重試。

- **大型對話與大檔案能送到手機上了。** 透過中繼伺服器開啟大型對話，以前會一再斷線，現在約一秒就開啟。傳送 100 MB 以前會斷線，手機記憶體漲到 1.3 GB；現在區域網路下 5 秒傳完，手機記憶體不到 91 MB。檔案邊接收邊寫入磁碟，斷線可以續傳，最大 2 GB。新舊版本的桌面端、手機端與中繼可以混用，不必重新配對。

- **子 Agent 停在檢查點，而不是停在終點。** 步數用完時，它會交回做了什麼、還剩什麼、下一步打算做什麼，並保留上下文，可以接著跑，不必從頭再派一次。同一項任務實測輸入 token 少了約 74%。沒跑完的子 Agent 點一下就能讓主 Agent 接著跑它。

- **子 Agent 一起跑，跑的時候你也能說話。** 互不相依的子 Agent 在同一輪一起派出，超過並行上限的自動排隊；以前四個會排成一串，一個接一個跑。主對話等待子 Agent 時你送出一句話，不必再等兩分多鐘：主對話先回應你，子 Agent 在背景跑完，結果再交回來。請求帶上快取鍵，經帳號池中繼時，子 Agent 開頭幾次請求不再次次錯過快取。授權卡片會寫明是哪個子 Agent 在要求。

- **一輪之內換模型，下一個請求就生效。** 卡在上游重試中的請求會當場放手，改由新模型接著回答，不必先停止或編輯訊息。

- **外掛市集改成一個網格，一張卡片一個動作**，可依種類與分類篩選。需要金鑰的 MCP 伺服器會說明要哪一把、去哪裡申請，金鑰存進保險箱，不再寫入 settings.json。安裝過的外掛與技能會自動跟上新版（每 30 分鐘檢查一次，可以關閉），外掛的 README 會完整呈現排版。

- **每個智慧體都有自己的形象。** 在編輯頁挑選形狀與顏色，或隨機換一個；子 Agent 面板與選單、@ 提及、設定頁都會顯示它。

- **智慧體開啟的網頁留在背景。** 以前智慧體每點一下，瀏覽器面板就彈出來蓋住你正在看的內容；現在面板保持關閉，對話中留下一張附縮圖、標題與「開啟」按鈕的卡片。

### 最佳化與修復

- **Windows 與 Linux 上的沙箱真正發揮作用。** Windows 上它從來沒有成功啟動過：開啟「自動核准」時，每一條命令都提示沒有可用的沙箱後端。現在受約束的命令會在受限權杖下的 PowerShell 中執行；沒有安裝 bubblewrap 的 Linux 改用 Landlock。

- **開啟「自動核准」時，要到沙箱外執行的命令一律先詢問你。** 以前這類請求交給風險判定，`rm -rf` 可能未經詢問就放行。

- **命令的結果依 shell 的本意解讀。** 檢查尚未跑完時，`gh pr checks` 的結束代碼是 8，這是回答，不是紅叉；真實對話裡 59 筆「失敗」有 13 筆屬於這種。`read` 與安裝程式的確認提示不再卡到逾時，`server &` 不再讓呼叫停住；從 Dock 啟動也能取得登入 shell 的代理伺服器、SSH agent 與語系設定。

- **分屏時，每個畫面只作用於自己的對話。** 草稿、送出、分支選單、模型與推理強度、「在終端機執行」、檔案連結、面板、側邊聊天、專案選單與交付審閱，以前都跟著取得焦點的那個畫面走；用鍵盤操作時，一則訊息或一次撤回可能落到旁邊那個對話裡。

- **介面語言從頭到尾一致。** 英文不再出現「1 conversations」「1 commits behind」，法文與俄文也會依數量選對詞形。系統通知、排程任務提示、檔案與拉取請求的錯誤、日期與時間都跟隨介面語言，不再停留在中文。

- **排程任務失敗時會說出來。** 它的提示以前從來沒有顯示過。現在失敗會寫在「已排程」的任務卡片上，輸入框上方也會有一行提示指過去。

- **技能、外掛、規則、命令頁依檔案計數，不再依行。** 只安裝兩個技能，頁面卻可能寫著「4 個技能的描述太短」。警告現在獨立成一張卡片，重新掃描後列表換了順序，也不會把同一行畫兩次。

- **Windows 與 Linux：** 編輯 CRLF 檔案不再改掉原本的換行；字母快速鍵依鍵盤配置辨識（AZERTY、Dvorak、俄文）；Delete 刪除檔案，終端機裡 Ctrl+C 是複製；介面字重不再只剩兩級；Linux 能裝上自動更新，Wayland 不再每次啟動都要求分享螢幕。

- **手機端：** 從手機傳送的附件以前全部失敗；iOS 上鍵盤彈出後頁面縮成 68 點高；區域網路連線時，每個「複製」按鈕都沒有反應。

</details>

<!-- lyra:notes ja -->

<details>
<summary>日本語</summary>

### 新機能

- **スマホ版をタッチ操作向けに作り直しました。** 会話やメッセージを長押しすると、ぼかした一覧から浮き上がり、横にメニューが開いて端末が軽く振動します。会話一覧は 2 行表示になり、下部に設定・検索・新しい会話のボタンが浮かびます。入力欄の操作部品はどれも 44pt 以上、モデル名は省略されずに表示され、推論の強度は小さなゲージで示します。アップロードには進行状況のカードが付き、キャンセルと再試行ができます。

- **大きな会話やファイルもスマホに届くようになりました。** 中継サーバー経由で大きな会話を開くと切断を繰り返していましたが、今は約 1 秒で開きます。100 MB の送信は以前は途中で切れ、スマホのメモリーが 1.3 GB まで膨らんでいました。今は LAN で 5 秒、メモリーは 91 MB 未満です。ファイルは受け取りながらディスクに書き込み、切断後は続きから再開し、最大 2 GB まで扱えます。新旧のデスクトップ版・スマホ版・中継サーバーが混在しても動き、ペアリングのやり直しは要りません。

- **サブエージェントは終点ではなくチェックポイントで止まります。** ステップの上限に達すると、やったこと・残っていること・次にやることを返し、文脈を保ったまま続きから再開できます。最初から出し直す必要はありません。同じ作業で入力トークンが約 74% 減りました。終わっていないサブエージェントは、ワンクリックでメインのエージェントに続きをやらせられます。

- **サブエージェントが並んで動き、その間も話しかけられます。** 互いに依存しないサブエージェントは同じ回でまとめて出され、上限を超えた分は自動で順番待ちになります。以前は 4 つが 1 つずつ順に動いていました。メインの会話がサブエージェントを待っている間に送ったメッセージも、2 分以上待たされることはなくなりました。会話が先に返事をし、サブエージェントはバックグラウンドで仕上げて結果を戻します。リクエストにキャッシュキーを付けたので、アカウントを共有する中継でも、各サブエージェントの最初のリクエストが毎回キャッシュを外すことはなくなりました。承認カードには、どのサブエージェントが求めているかが表示されます。

- **ターンの途中でモデルを切り替えると、次のリクエストから反映されます。** 上流の不調で再試行を繰り返していたリクエストはその場で手を離し、新しいモデルで送り直します。停止やメッセージの編集は要りません。

- **プラグインマーケットは、1 枚のカードに 1 つの操作を置いたグリッドになりました。** 種類とカテゴリーで絞り込めます。キーが必要な MCP サーバーは、どのキーをどこで取得するかを示し、キーは settings.json ではなく保管庫に入ります。インストール済みのプラグインとスキルは新しい版に自動で追随し（30 分ごとに確認、オフにもできます）、プラグインの README は整形して表示します。

- **エージェントごとに見た目を持てるようになりました。** 編集画面で形と色を選ぶか、ランダムに変えられます。サブエージェントのパネルとメニュー、@ メンション、設定画面に表示されます。

- **エージェントが開いた Web ページはバックグラウンドのままです。** 以前はエージェントがクリックするたびにブラウザーパネルが開き、作業中の画面を覆っていました。今はパネルは閉じたままで、会話にサムネイル・タイトル・「開く」ボタン付きのカードが残ります。

### 改善と修正

- **Windows と Linux でサンドボックスが実際に働くようになりました。** Windows では一度も起動しておらず、「自動承認」ではすべてのコマンドで使えるサンドボックスがないと表示されていました。制約付きのコマンドは制限トークンの下の PowerShell で実行します。bubblewrap のない Linux では Landlock を使います。

- **「自動承認」でも、サンドボックスの外で実行するコマンドは必ず先に確認します。** 以前はリスク判定に回され、`rm -rf` が確認なしで通ることがありました。

- **コマンドの結果をシェルの意図どおりに読みます。** チェックの実行中に `gh pr checks` が返す終了コード 8 は失敗ではなく答えです。実際のセッションでは「失敗」59 件のうち 13 件がこれでした。`read` やインストーラーの確認がタイムアウトまで固まることも、`server &` が呼び出しを止めることもなくなりました。Dock から起動しても、ログインシェルのプロキシ・SSH エージェント・ロケールを引き継ぎます。

- **分割表示では、各画面が自分の会話だけに作用します。** 下書き・送信・ブランチメニュー・モデルと推論の強度・「ターミナルで実行」・ファイルリンク・パネル・サイドチャット・プロジェクトメニュー・納品レビューは、フォーカスのある画面に従っていました。キーボード操作では、メッセージや取り消しが隣の会話に届くことがありました。

- **表示言語が最後までそろいます。** 英語で「1 conversations」「1 commits behind」と出なくなり、フランス語とロシア語も数に合った形を選びます。システム通知・予約タスクのお知らせ・ファイルやプルリクエストのエラー・日付と時刻も、中国語のまま残らず表示言語に従います。

- **予約タスクが失敗すると知らせるようになりました。** そのお知らせは一度も表示されていませんでした。失敗は「予約済み」のタスクカードに書かれ、入力欄の上にもそこを指す一行が出ます。

- **スキル・プラグイン・ルール・コマンドの画面は、行ではなくファイルを数えます。** スキルが 2 つしかないのに「4 つのスキルの説明が短すぎます」と出ることがありました。警告は専用のカードに分かれ、再スキャンで並びが変わっても同じ行を 2 回描くことはありません。

- **Windows と Linux：** CRLF のファイルを編集しても改行が変わりません。文字のショートカットはキーボード配列（AZERTY、Dvorak、ロシア語）どおりに効きます。Delete でファイルを削除し、ターミナルの Ctrl+C はコピーです。文字の太さが 2 段階に潰れなくなりました。Linux で自動更新が入り、Wayland で起動のたびに画面共有を求められることもなくなりました。

- **スマホ：** スマホから送った添付ファイルがすべて失敗していました。iOS ではキーボードを開くと画面の高さが 68pt に縮んでいました。LAN 接続では、どの「コピー」ボタンも反応しませんでした。

</details>

<!-- lyra:notes ko -->

<details>
<summary>한국어</summary>

### 새로운 기능

- **모바일 앱을 터치에 맞게 새로 만들었습니다.** 대화나 메시지를 길게 누르면 흐려진 목록 위로 떠오르고, 옆에 메뉴가 열리며 휴대폰이 짧게 진동합니다. 대화 목록은 두 줄로 표시되고, 아래쪽에 설정·검색·새 대화 버튼이 떠 있습니다. 입력창의 모든 컨트롤은 44pt 이상이고, 모델 이름은 잘리지 않으며, 추론 강도는 작은 게이지로 보여 줍니다. 업로드에는 진행 카드가 붙어 취소와 재시도를 할 수 있습니다.

- **큰 대화와 큰 파일도 휴대폰에 도착합니다.** 중계 서버를 거쳐 큰 대화를 열면 연결이 계속 끊겼는데, 이제 1초 정도면 열립니다. 100 MB를 보내면 연결이 끊기고 휴대폰 메모리가 1.3 GB까지 올라갔지만, 이제 LAN에서 5초가 걸리고 메모리는 91 MB 미만입니다. 파일은 받는 대로 디스크에 쓰고, 연결이 끊겨도 이어서 받으며, 최대 2 GB까지 됩니다. 이전 버전과 새 버전의 데스크톱 앱·모바일 앱·중계 서버를 섞어 써도 다시 페어링할 필요가 없습니다.

- **하위 에이전트는 끝이 아니라 체크포인트에서 멈춥니다.** 단계 한도에 닿으면 한 일·남은 일·다음에 할 일을 돌려주고 맥락을 그대로 가진 채 이어서 할 수 있습니다. 처음부터 다시 보낼 필요가 없습니다. 같은 작업에서 입력 토큰이 약 74% 줄었습니다. 끝나지 않은 하위 에이전트는 한 번 눌러 메인 에이전트에게 이어서 하게 할 수 있습니다.

- **하위 에이전트가 함께 돌고, 그동안에도 말을 걸 수 있습니다.** 서로 의존하지 않는 하위 에이전트는 같은 차례에 함께 보내지고, 한도를 넘는 것은 자동으로 대기합니다. 예전에는 네 개가 하나씩 차례로 돌았습니다. 메인 대화가 하위 에이전트를 기다리는 동안 보낸 메시지도 이제 2분 넘게 기다리지 않습니다. 대화가 먼저 답하고, 하위 에이전트는 백그라운드에서 마친 뒤 결과를 돌려줍니다. 요청에 캐시 키를 붙여, 계정을 나눠 쓰는 중계에서도 하위 에이전트의 첫 요청들이 매번 캐시를 놓치지 않습니다. 승인 카드에는 어느 하위 에이전트가 요청하는지 표시됩니다.

- **턴 중간에 모델을 바꾸면 다음 요청부터 적용됩니다.** 상위 서버 문제로 재시도에 걸린 요청은 그 자리에서 놓고 새 모델로 다시 보냅니다. 멈추거나 메시지를 고칠 필요가 없습니다.

- **플러그인 마켓은 카드 하나에 동작 하나를 둔 그리드가 되었습니다.** 종류와 분류로 거를 수 있습니다. 키가 필요한 MCP 서버는 어떤 키를 어디서 받는지 알려 주고, 키는 settings.json이 아니라 보관함에 들어갑니다. 설치한 플러그인과 스킬은 새 버전을 자동으로 따라가며(30분마다 확인, 끌 수 있음), 플러그인의 README는 서식을 갖춰 보여 줍니다.

- **에이전트마다 자기 모습이 생겼습니다.** 편집 화면에서 모양과 색을 고르거나 무작위로 바꿀 수 있고, 하위 에이전트 패널과 메뉴, @ 멘션, 설정 화면에 표시됩니다.

- **에이전트가 연 웹 페이지는 백그라운드에 머뭅니다.** 예전에는 에이전트가 무언가를 누를 때마다 브라우저 패널이 열려 보던 화면을 가렸습니다. 이제 패널은 닫힌 채로 있고, 대화에 미리보기·제목·"열기" 버튼이 있는 카드가 남습니다.

### 개선 및 수정

- **Windows와 Linux에서 샌드박스가 실제로 동작합니다.** Windows에서는 한 번도 시작되지 않았고, "자동 승인"에서는 모든 명령에 사용할 수 있는 샌드박스가 없다고 나왔습니다. 이제 제약된 명령은 제한 토큰 아래의 PowerShell에서 실행하고, bubblewrap이 없는 Linux에서는 Landlock을 씁니다.

- **"자동 승인"이어도 샌드박스 밖에서 실행할 명령은 반드시 먼저 묻습니다.** 예전에는 위험 판정으로 넘어가 `rm -rf`가 묻지 않고 통과할 수 있었습니다.

- **명령의 결과를 셸이 뜻한 대로 읽습니다.** 검사가 아직 도는 동안 `gh pr checks`가 돌려주는 종료 코드 8은 실패가 아니라 답입니다. 실제 세션에서 "실패" 59건 중 13건이 이런 경우였습니다. `read`나 설치 프로그램의 확인이 시간 초과까지 멈춰 있지 않고, `server &`가 호출을 붙잡지 않으며, Dock에서 실행해도 로그인 셸의 프록시·SSH 에이전트·로캘을 가져옵니다.

- **분할 보기에서 각 화면은 자기 대화에만 작용합니다.** 초안·전송·브랜치 메뉴·모델과 추론 강도·"터미널에서 실행"·파일 링크·패널·사이드 챗·프로젝트 메뉴·결과 검토가 모두 포커스가 있는 화면을 따라갔습니다. 키보드로 조작하면 메시지나 되돌리기가 옆 대화에 들어갈 수 있었습니다.

- **인터페이스 언어가 끝까지 일관됩니다.** 영어에서 "1 conversations", "1 commits behind"가 나오지 않고, 프랑스어와 러시아어도 수에 맞는 형태를 고릅니다. 시스템 알림·예약 작업 알림·파일과 풀 리퀘스트 오류·날짜와 시각도 중국어로 남지 않고 표시 언어를 따릅니다.

- **예약 작업이 실패하면 알려 줍니다.** 그 알림은 한 번도 표시된 적이 없었습니다. 이제 실패는 "예약됨"의 작업 카드에 적히고, 입력창 위에도 그곳을 가리키는 한 줄이 나옵니다.

- **스킬·플러그인·규칙·명령 화면은 줄이 아니라 파일을 셉니다.** 스킬이 두 개뿐인데 "스킬 4개의 설명이 너무 짧습니다"라고 나오기도 했습니다. 경고는 따로 카드에 모이고, 다시 스캔해 순서가 바뀌어도 같은 줄이 두 번 그려지지 않습니다.

- **Windows와 Linux:** CRLF 파일을 편집해도 줄바꿈이 바뀌지 않습니다. 글자 단축키는 키보드 배열(AZERTY, Dvorak, 러시아어)대로 동작합니다. Delete로 파일을 지우고, 터미널에서 Ctrl+C는 복사입니다. 글꼴 굵기가 두 단계로 뭉개지지 않습니다. Linux에서 자동 업데이트가 설치되고, Wayland에서 실행할 때마다 화면 공유를 묻지 않습니다.

- **모바일:** 휴대폰에서 보낸 첨부 파일이 모두 실패했습니다. iOS에서는 키보드를 열면 화면 높이가 68pt로 줄었습니다. LAN 연결에서는 어떤 "복사" 버튼도 반응하지 않았습니다.

</details>

<!-- lyra:notes fr -->

<details>
<summary>Français</summary>

### Nouvelles fonctionnalités

- **L’application mobile est repensée pour le tactile.** Un appui long sur une conversation ou un message la détache d’une liste floutée, ouvre son menu à côté et fait vibrer le téléphone. Les conversations tiennent sur deux lignes, au-dessus d’une barre flottante avec les réglages, la recherche et une nouvelle conversation. Chaque commande du champ de saisie mesure au moins 44 points, le nom du modèle s’affiche en entier et l’effort de raisonnement devient une petite jauge. Les envois ont une carte avec leur progression, un bouton pour annuler et un pour réessayer.

- **Les grosses conversations et les gros fichiers arrivent sur le téléphone.** Ouvrir une longue conversation par le serveur relais coupait la connexion encore et encore ; elle s’ouvre maintenant en une seconde environ. Envoyer 100 Mo coupait la connexion avec 1,3 Go de mémoire occupée sur le téléphone ; en réseau local, cela prend maintenant 5 secondes et le téléphone reste sous 91 Mo. Les fichiers s’écrivent sur le disque au fil de la réception, reprennent après une coupure et peuvent atteindre 2 Go. Anciennes et nouvelles versions de l’application de bureau, de l’application mobile et du relais fonctionnent ensemble sans nouvel appairage.

- **Les sous-agents s’arrêtent à des points de reprise, pas à la fin.** Arrivé à sa limite d’étapes, un sous-agent rend ce qu’il a fait, ce qui reste et ce qu’il ferait ensuite, et garde son contexte : il peut reprendre au lieu d’être relancé de zéro. Sur la même tâche, cela a demandé environ 74 % de jetons d’entrée en moins. Un sous-agent inachevé peut être confié en un clic à l’agent principal, qui le reprend.

- **Les sous-agents travaillent en même temps, et vous pouvez parler pendant ce temps.** Les sous-agents indépendants partent ensemble et les autres attendent une place libre ; avant, quatre s’exécutaient l’un après l’autre. Un message envoyé pendant que la conversation principale les attend n’attend plus deux minutes : la conversation répond, les sous-agents finissent en arrière-plan et leurs résultats lui reviennent. Les requêtes portent une clé de cache, si bien qu’un relais qui mutualise des comptes ne rate plus le cache aux premières requêtes de chaque sous-agent. La carte d’approbation indique quel sous-agent demande.

- **Changer de modèle en cours de tour vaut dès la requête suivante.** Une requête bloquée à réessayer sur un service en panne lâche prise et part vers le nouveau modèle, sans devoir arrêter ni modifier le message.

- **Le Marché des extensions devient une grille, une action par carte,** filtrable par type et par catégorie. Un serveur MCP qui demande une clé dit laquelle et où l’obtenir, et la clé va dans le coffre au lieu de settings.json. Les extensions et compétences installées suivent d’elles-mêmes les nouvelles versions (vérification toutes les 30 minutes, désactivable), et le README d’une extension s’affiche mis en forme.

- **Chaque agent a son apparence.** Choisissez une forme et une couleur dans son éditeur, ou tirez-en une au hasard ; le panneau et le menu des sous-agents, les mentions @ et les pages de réglages l’affichent.

- **Les pages web ouvertes par l’agent restent en arrière-plan.** Le panneau du navigateur s’ouvrait par-dessus votre travail à chaque clic de l’agent ; il reste maintenant fermé, et une carte dans la conversation montre une vignette, le titre et un bouton Ouvrir.

### Améliorations et corrections

- **Sous Windows et Linux, le bac à sable confine réellement les commandes.** Sous Windows, il ne s’était jamais lancé : en Validation automatique, chaque commande signalait qu’aucun bac à sable n’était disponible. Les commandes contraintes s’exécutent maintenant dans PowerShell sous un jeton restreint, et les systèmes Linux sans bubblewrap utilisent Landlock.

- **En Validation automatique, exécuter une commande hors du bac à sable demande toujours votre accord.** La demande passait par l’évaluation des risques, qui pouvait laisser passer `rm -rf` sans rien demander.

- **Le résultat d’une commande est lu comme le shell l’entend.** `gh pr checks` renvoie 8 tant que les vérifications tournent : c’est une réponse, pas une croix rouge ; 13 des 59 « échecs » relevés dans de vraies sessions étaient de ce genre. `read` et les invites d’installation ne restent plus bloqués jusqu’au délai, `server &` ne bloque plus l’appel, et l’application lancée depuis le Dock récupère le proxy, l’agent SSH et la langue de votre shell de connexion.

- **En Vue scindée, chaque écran agit sur sa propre conversation.** Brouillons, envoi, menu des branches, modèle et effort de raisonnement, « L’exécuter dans le terminal », liens de fichiers, panneaux, Discussion latérale, menu du projet et revue de livraison suivaient l’écran qui avait le focus ; au clavier, un message ou une annulation pouvait atterrir dans la conversation d’à côté.

- **L’interface garde sa langue jusqu’au bout.** L’anglais n’affiche plus « 1 conversations » ni « 1 commits behind », et le français comme le russe choisissent la bonne forme selon le nombre. Notifications système, avis des tâches planifiées, erreurs de fichiers et de demandes de fusion, dates et heures suivent la langue de l’interface au lieu de rester en chinois.

- **Une tâche planifiée qui échoue le signale désormais.** Ses avis n’avaient jamais été affichés. Un échec s’inscrit sur sa carte dans Planifiées, et une ligne au-dessus du champ de saisie y renvoie.

- **Les pages Compétences, Extensions, Règles et Commandes comptent des fichiers, pas des lignes.** Avec deux compétences installées, une page pouvait annoncer « 4 compétences ont une description trop courte ». Les avertissements ont maintenant leur propre carte, et une liste réordonnée par une nouvelle analyse ne dessine plus deux fois la même ligne.

- **Sous Windows et Linux :** modifier un fichier CRLF conserve ses fins de ligne ; les raccourcis à lettre suivent la disposition du clavier (AZERTY, Dvorak, russe) ; Suppr supprime un fichier et Ctrl+C copie dans le terminal ; l’interface ne se réduit plus à deux graisses ; Linux installe ses mises à jour, et Wayland ne demande plus à partager l’écran à chaque lancement.

- **Sur le téléphone :** toutes les pièces jointes envoyées depuis le téléphone échouaient ; sous iOS, la page se réduisait à 68 points de haut à l’ouverture du clavier ; en réseau local, aucun bouton Copier ne réagissait.

</details>

<!-- lyra:notes ru -->

<details>
<summary>Русский</summary>

### Новые возможности

- **Мобильное приложение переделано под касания.** Долгое нажатие на беседу или сообщение поднимает её над размытым списком, рядом открывается меню, а телефон коротко вибрирует. Беседы в списке занимают две строки, внизу плавает панель с настройками, поиском и новой беседой. Каждый элемент поля ввода не меньше 44 pt, название модели видно целиком, а глубина рассуждений показана маленькой шкалой. У загрузок есть карточка с прогрессом, отменой и повтором.

- **Большие беседы и файлы доходят до телефона.** Большая беседа через сервер-релей раньше снова и снова обрывала соединение, теперь она открывается примерно за секунду. Отправка 100 МБ раньше обрывалась, а телефон занимал 1,3 ГБ памяти; теперь по локальной сети это 5 секунд и меньше 91 МБ. Файлы пишутся на диск по мере получения, докачиваются после обрыва и могут весить до 2 ГБ. Старые и новые версии настольного приложения, мобильного приложения и релея работают друг с другом без повторного сопряжения.

- **Субагенты останавливаются на контрольных точках, а не в конце.** Дойдя до лимита шагов, субагент отдаёт, что сделал, что осталось и что собирался делать дальше, и сохраняет контекст — его можно продолжить, а не запускать заново с нуля. На той же задаче это заняло примерно на 74 % меньше входных токенов. Незавершённого субагента можно одним нажатием передать главному агенту, чтобы тот его продолжил.

- **Субагенты работают одновременно, а вы можете писать, пока они заняты.** Независимые субагенты запускаются вместе, остальные ждут свободного места; раньше четыре шли один за другим. Сообщение, отправленное, пока главная беседа ждёт субагентов, больше не висит по две минуты: беседа отвечает, субагенты доделывают работу в фоне, и их результаты возвращаются в неё. Запросы несут ключ кэша, поэтому релей с общим пулом аккаунтов больше не промахивается мимо кэша на первых запросах каждого субагента. Карточка подтверждения говорит, какой субагент просит.

- **Смена модели посреди хода действует со следующего запроса.** Запрос, застрявший на повторах из-за сбоя провайдера, отпускается и уходит к новой модели — не нужно ни останавливать, ни править сообщение.

- **Магазин плагинов стал сеткой, по одному действию на карточку,** с фильтрами по типу и категории. MCP-сервер, которому нужен ключ, говорит, какой и где его взять, а ключ хранится в хранилище, а не в settings.json. Установленные плагины и навыки сами обновляются до новых версий (проверка каждые 30 минут, можно отключить), а README плагина отображается с разметкой.

- **У каждого агента появился свой облик.** В редакторе агента выберите форму и цвет или случайный вариант; облик виден в панели и меню субагентов, в @-упоминаниях и на страницах настроек.

- **Веб-страницы, которые открывает агент, остаются в фоне.** Раньше панель браузера открывалась поверх вашей работы при каждом клике агента; теперь она остаётся закрытой, а в беседе появляется карточка с миниатюрой, заголовком и кнопкой «Открыть».

### Улучшения и исправления

- **В Windows и Linux песочница действительно ограничивает команды.** В Windows она ни разу не запускалась: при автоподтверждении каждая команда сообщала, что песочницы нет. Теперь ограниченные команды выполняются в PowerShell под урезанным токеном, а в Linux без bubblewrap используется Landlock.

- **При автоподтверждении команда вне песочницы всегда сначала спрашивает вас.** Раньше такой запрос уходил на оценку риска, и `rm -rf` мог пройти без вопроса.

- **Результат команды читается так, как его понимает shell.** `gh pr checks` возвращает 8, пока проверки ещё идут, — это ответ, а не красный крестик; 13 из 59 «ошибок» в реальных сессиях были именно такими. `read` и вопросы установщиков больше не висят до таймаута, `server &` не блокирует вызов, а приложение, запущенное из Dock, получает прокси, SSH-агент и локаль вашего логин-шелла.

- **В разделённом виде каждый экран работает со своей беседой.** Черновики, отправка, меню веток, модель и глубина рассуждений, «Выполнить в терминале», ссылки на файлы, панели, боковая беседа, меню проекта и проверка результата следовали за экраном в фокусе; с клавиатуры сообщение или отмена могли попасть в соседнюю беседу.

- **Интерфейс говорит на своём языке до конца.** По-английски больше нет «1 conversations» и «1 commits behind», а французский и русский выбирают нужную форму для каждого числа. Системные уведомления, сообщения запланированных задач, ошибки файлов и запросов на слияние, даты и время следуют языку интерфейса и не остаются на китайском.

- **Запланированная задача сообщает о сбое.** Её уведомления раньше вообще не показывались. Теперь сбой записан на карточке задачи в «Запланировано», а строка над полем ввода ведёт к ней.

- **Страницы навыков, плагинов, правил и команд считают файлы, а не строки.** При двух установленных навыках страница могла писать, что у 4 навыков слишком короткое описание. Предупреждения теперь в отдельной карточке, а список, переупорядоченный после пересканирования, больше не рисует одну строку дважды.

- **В Windows и Linux:** правка файла с CRLF сохраняет его переводы строк; буквенные сочетания клавиш следуют раскладке (AZERTY, Dvorak, русская); Delete удаляет файл, а Ctrl+C в терминале копирует; начертания шрифта больше не схлопываются до двух; Linux устанавливает обновления, а Wayland не просит доступ к экрану при каждом запуске.

- **На телефоне:** все вложения, отправленные с телефона, не доходили; в iOS при открытии клавиатуры страница сжималась до 68 pt; в локальной сети ни одна кнопка «Копировать» не срабатывала.

</details>

## [0.9.19](https://github.com/kittors/Lyra/releases/tag/v0.9.19) - 2026-09-21
<!-- lyra:notes en -->

### Features

- **Multi-folder projects.** A project is no longer tied to a single root directory. You can add multiple source folders to one project upon creation or edit them later through the project dialog. The model recognizes all folders as part of the project context and reads files across them without prompting.

- **Unified read permission boundary.** The separate read-only command table is retired in favor of one simple, predictable rule: reading inside the project or system roots runs automatically; reading outside the project asks for confirmation. SSH keys, cloud credentials, and sensitive configurations always prompt wherever they are located.

- **Granular storage management and usage insights in Settings.** A dedicated storage section visualizes disk space used by chat histories, cache files, and tool artifacts. You can clean up old sessions, clear temporary cache files, or purge data by retention periods.

### Improvements & Fixes

- **Graceful rewind to empty state.** Rewinding or undoing the only message in a conversation properly returns to the welcoming initial state with starters instead of leaving a blank canvas.

- **Unified provider model actions and refined inline code styling.** Model actions across different providers use consistent icon controls and layout. Inline code blocks in messages and tool outputs feature calibrated padding, subtle tinting, and balanced typographic contrast.

<!-- lyra:notes zh-CN -->

<details>
<summary>中文（简体）</summary>

### 新功能

- **多文件夹项目支持。** 一个项目不再限制在单个根目录。创建项目或在项目设置中，可以向同一项目添加多个源码文件夹。模型会自动识别并覆盖所有关联目录，直接读取和检索跨目录文件无需重复确认。

- **统一的文件读取安全边界。** 移除了容易误判的只读命令列表，改用清晰一致的判定原则：项目内以及系统常用目录的读取自动放行；项目外部路径的读取均需经过人工确认。对于 SSH 密钥、云服务凭据与敏感配置文件，无论放在何处都会弹出确认提示。

- **设置页新增存储管理与用量分析。** 设置中提供了详细的存储占用可视化，清晰列出会话日志、缓存文件与运行产物所占磁盘空间。支持按保留周期清理历史对话、清除临时缓存与一键释放磁盘空间。

### 优化与修复

- **撤回唯一消息时平滑恢复初始状态。** 撤回对话中的最后一条消息后，窗口会优雅回到包含推荐提问与起始提示的初始界面，不再留下一片空白。

- **统一服务商模型操作按钮与行内代码样式。** 各服务商模型卡片的刷新、编辑与删除动作按钮采用统一的图标控件与对齐规范；优化了转录中行内代码与代码块的内衬与字阶对比度。

</details>

<!-- lyra:notes zh-TW -->

<details>
<summary>中文（繁體）</summary>

### 新功能

- **多資料夾專案支援。** 專案不再侷限於單一根目錄。在建立專案或專案設定中，可以將多個原始碼資料夾納入同一個專案。模型會自動辨識並包含所有關聯資料夾，跨資料夾讀取與搜尋檔案無需重複確認。

- **統一的檔案讀取安全邊界。** 簡化讀取權限判斷規則：專案範圍內及系統常用目錄的讀取自動放行；讀取專案以外的路徑皆需經過人工確認。對於 SSH 金鑰、雲端憑證等敏感檔案，無論位於何處皆會跳出確認提示。

- **設定頁新增儲存空間管理。** 設定中新增儲存空間視覺化圖表，清楚呈現對話紀錄、快取檔案與工具產物所佔用的磁碟容量，並支援依時間保留期限清除歷史資料與釋放空間。

### 最佳化與修復

- **撤回唯一訊息時平滑回到初始狀態。** 撤回對話中僅有的第一則訊息後，介面會正常顯示帶有起始引導的初始畫面，不再留下一片空白。

- **統一模型服務商操作按鈕與行內代碼樣式。** 各服務商模型列表的操作按鈕統一採用一致的圖示與排版；調整對話中行內代碼的邊距與視覺對比度。

</details>

<!-- lyra:notes ja -->

<details>
<summary>日本語</summary>

### 新機能

- **複数フォルダープロジェクトのサポート。** 1つのプロジェクトが単一のディレクトリに縛られなくなりました。新規作成時やプロジェクト設定から複数のソースフォルダーを追加できます。モデルはすべてのフォルダーを認識し、確認なしで横断的に読み取りや検索を行えます。

- **ファイル読み取り権限の境界を統一。** 読み取り専用コマンドの個別判定を廃止し、シンプルで一貫したルールに刷新しました。プロジェクト内およびシステムルートの読み取りは自動許可され、プロジェクト外のファイル読み取りは確認を求めます。SSH 鍵やクラウドアカウント情報などの機密ファイルは、場所を問わず必ず確認を挟みます。

- **設定画面にストレージ管理機能を追加。** 会話履歴、キャッシュ、生成ファイルが占有するディスク容量を可視化しました。保持期間に応じた古い会話の整理や、一時キャッシュの削除を簡単に行えます。

### 改善と修正

- **最後のメッセージ取り消し時に初期画面へ正しく復帰。** 会話内の唯一のメッセージを取り消した際、空白画面にならず、ウェルカム表示と初期プロンプトへスムーズに戻るよう修正しました。

- **プロバイダーモデルの操作ボタン統一とインラインコードスタイルの調整。** モデル一覧のアクションボタンのレイアウトとアイコンを統一しました。また、チャット内のインラインコードの余白とコントラストを最適化しました。

</details>

<!-- lyra:notes ko -->

<details>
<summary>한국어</summary>

### 새로운 기능

- **다중 폴더 프로젝트 지원.** 프로젝트가 더 이상 단일 루트 디렉터리에 제한되지 않습니다. 프로젝트 생성 시 또는 프로젝트 설정에서 여러 소스 폴더를 하나의 프로젝트로 묶을 수 있습니다. 모델은 모든 폴더를 인식하여 별도 확인 없이 폴더 간 파일을 읽고 탐색합니다.

- **통합된 파일 읽기 보안 경계.** 읽기 전용 명령어 목록을 걷어내고 명확한 규칙으로 개편했습니다. 프로젝트 내부 및 시스템 루트 읽기는 자동으로 허용되며, 프로젝트 외부 경로를 읽을 때는 사용자 확인을 거칩니다. SSH 키와 클라우드 인증 정보 등 민감한 파일은 위치에 관계없이 항상 확인 창이 표시됩니다.

- **설정 화면에 저장 공간 관리 기능 추가.** 대화 기록, 임시 캐시, 도구 결과물이 차지하는 디스크 용량을 시각화하여 보여줍니다. 보관 기간에 따른 오래된 대화 정리 및 임시 캐시 삭제를 간편하게 수행할 수 있습니다.

### 개선 및 수정

- **유일한 메시지 취소 시 초기 화면으로 자연스럽게 복원.** 대화 내의 유일한 메시지를 되돌렸을 때 빈 화면으로 남지 않고, 시작 프롬프트가 포함된 초기 화면으로 원활하게 복귀합니다.

- **제공자 모델 작업 버튼 통일 및 인라인 코드 스타일 조정.** 모델 목록의 버튼 디자인과 배치를 일관되게 정돈하고, 메시지 내 인라인 코드 블록의 여백과 가독성을 다듬었습니다.

</details>

<!-- lyra:notes fr -->

<details>
<summary>Français</summary>

### Nouvelles fonctionnalités

- **Projets multi-dossiers.** Un projet ne se limite plus à un seul répertoire racine. Vous pouvez ajouter plusieurs dossiers sources lors de la création ou via les paramètres du projet. Le modèle prend en compte l'ensemble des dossiers et accède aux fichiers sans demander de confirmation superflue.

- **Frontière unifiée des permissions de lecture.** Remplacement de la liste des commandes en lecture seule par une règle claire et prévisible : les lectures dans le projet ou les répertoires système sont directes ; toute lecture en dehors du projet nécessite une approbation. Les clés SSH et identifiants cloud demandent toujours une confirmation, quel que soit leur emplacement.

- **Gestion du stockage dans les paramètres.** Visualisation claire de l'espace disque occupé par l'historique des conversations, les caches et les fichiers temporaires. Permet de purger les anciennes sessions selon une durée de rétention et de libérer facilement de l'espace.

### Améliorations et corrections

- **Retour fluide à l'état initial lors de l'annulation du seul message.** Supprimer ou annuler le premier et unique message d'une conversation réaffiche correctement l'écran d'accueil avec les suggestions au lieu d'une page blanche.

- **Harmonisation des boutons de modèles et ajustement du code en ligne.** Les actions sur les modèles adoptent des commandes et icônes cohérentes. Les blocs de code en ligne dans les messages bénéficient d'un contraste et d'espacements affinés.

</details>

<!-- lyra:notes ru -->

<details>
<summary>Русский</summary>

### Новые возможности

- **Поддержка нескольких папок в проекте.** Проект больше не ограничен одним корневым каталогом. При создании или в настройках проекта можно добавить несколько исходных папок. Модель видит все связанные каталоги и читает файлы между ними без лишних подтверждений.

- **Единые границы доступа на чтение файлов.** Отдельный список безопасных команд упразднён в пользу понятного правила: чтение файлов внутри проекта и системных папок разрешено автоматически; чтение файлов вне проекта требует подтверждения. Ключи SSH и конфигурации облачных сервисов всегда запрашивают подтверждение независимо от расположения.

- **Управление хранилищем в настройках.** Наглядная статистика занятого места на диске: история диалогов, временные файлы и кэш. Поддерживается удаление старых сессий по сроку давности и быстрая очистка кэша.

### Улучшения и исправления

- **Корректный возврат к начальному экрану при отмене единственного сообщения.** При удалении единственного сообщения диалог корректно возвращается к экрану приветствия с подсказками, а не остаётся пустым.

- **Унификация кнопок моделей и улучшение стиля инлайн-кода.** Действия с моделями провайдеров приведены к единому оформлению. Оптимизированы отступы и контраст шрифта для инлайн-кода в сообщениях.

</details>

### 新功能

- 完善设置项、用量统计、存储管理与界面体验 ([83099e4](https://github.com/kittors/Lyra/commit/83099e4177d09d5b33454ff7d04733379a3f69a4))
- 一个项目可以由几个源文件夹组成，创建和编辑走同一个弹窗 ([660947d](https://github.com/kittors/Lyra/commit/660947d334a3c55e7e84f762b4be5b8c576cb49e))
- **core**: 读取边界只留一条，越界读要经过人 ([c7cadd7](https://github.com/kittors/Lyra/commit/c7cadd7a97ff60954423d33659f141a980b3696b))

### 修复

- **core**: session move 保持 updatedAt 判定与 listSessions 一致 ([2da5fb6](https://github.com/kittors/Lyra/commit/2da5fb67c7b6ded64cca30eabcd43cf9a79062d6))
- **core**: 修复 session move 时 latestMeta 缓存键与 projectId 匹配 ([21a90d6](https://github.com/kittors/Lyra/commit/21a90d6031588c3600996cc2bfafaea4c39fa6ce))
- **core**: 修复 Windows 环境下的路径断言与 resolve 导入 ([faad993](https://github.com/kittors/Lyra/commit/faad993f37b8b0de54e8c6de3c1f6bd9f324ea45))
- **core**: 修正 store 中 move payload 类型的比较 ([af6e3f2](https://github.com/kittors/Lyra/commit/af6e3f2b0ca3dac921733863dbe41871efa515dd))
- **core**: 修复 session move 的 payload 解析与测试断言 ([2414b48](https://github.com/kittors/Lyra/commit/2414b48c60069cd809228e9f98ca6dd60fec7d79))
- **core**: 修复 session move 时 updatedAt 保持不变 ([1bf5c9c](https://github.com/kittors/Lyra/commit/1bf5c9cec9d9dc02807b50f9515b886d7707ef03))
- **core**: 修复 Windows 路径反斜杠下的密钥正则、prompt 断言及测试环境 ([3dc1559](https://github.com/kittors/Lyra/commit/3dc155928dbe0013a3150ee0b14347ef5df504e5))
- **desktop**: 不要导出仅在文件内部使用的类型 ([24be428](https://github.com/kittors/Lyra/commit/24be4283246b14993b4ed3f0c88fcbc4d533cec9))
- **desktop**: 撤回最后一条消息之后，回到空状态而不是一片空白 ([b11ddeb](https://github.com/kittors/Lyra/commit/b11ddeb86085c640a22a007e35b0217589c4de3f))

### 重构

- **desktop**: unify provider models header action buttons ([1bf3ffd](https://github.com/kittors/Lyra/commit/1bf3ffd8305f01a27ac056d9541c4fee1720ee45))

### 文档

- update README with split workspace, git modal, and layout details ([8a345e0](https://github.com/kittors/Lyra/commit/8a345e01432f2fd2f607f4ade070a189e37b6111))

## [0.9.18](https://github.com/kittors/Lyra/releases/tag/v0.9.18) - 2026-09-20

<!-- lyra:notes en -->

### Fixes

- **Commit and push dialog is now a focused modal with full branch control.** The commit interface is moved from a cramped popover overlapping the file list into a centered modal dialog with matching border radius and breathing room. The branch row now expands a full branch picker allowing instant selection or in-place branch creation that only commits and creates upon confirmation. The message input preserves generated drafts on retry, and the commit language selector remains permanently available without disappearing during typing.

- **Action buttons on file diff rows no longer overlap or crowd file names.** Revert and stage buttons now sit smoothly at the far right edge when hovering without pushing the diff addition/deletion numbers away or leaving empty gaps. Transitions are carefully sequenced so counts yield before buttons fade in, preventing double-drawn transparent artifacts.

- **User bubbles now render full Markdown, and side chat no longer displays internal attachment markers.** Messages in conversations format markdown blocks properly. Side chat now tracks separate display text so raw attachment headers (`### Attached file: ...`) intended for models are no longer exposed in the chat bubbles or restored into edit boxes.

- **Window title bars and captions properly proportioned on Windows.** Windows native titlebar overlay height now uses standard caption button heights (32px) rather than macOS traffic-light centering heights (44px), and the header bar background color is consistently applied to panel and session windows instead of blending into the content below.

- **Queue status spinner stays attached to the latest user bubble.** Spinning indicators follow the last user message rather than permanently sticking with an outdated "Waiting for previous response" notice when turns are queued or streaming.

- **The Git changes view remembers your tree vs. flat view preference.** Toggling between tree view and flat list is preserved across panel closes, workspace switches, branch checkouts, and app reloads.

- **Masked API keys in settings never overlap the visibility toggle button.** Long secret keys keep sufficient clearance from the show/hide eye button using flex layout, preventing text characters from drawing over the control.

<!-- lyra:notes zh-CN -->

<details>
<summary>中文（简体）</summary>

### 修复

- **Git 提交改动改为居中弹窗，分支可直接选择或新建。** 提交界面从此前遮挡半个面板与文件列表的挤压浮层，改为居中弹窗模态，采用与主输入框一致的圆角、描边与内衬呼吸感。分支行可直接展开本地分支列表或新建分支，确认提交时才执行切换；生成的提交信息写回输入框，生成语言切换按钮常驻，不再因开始打字就突兀消失或让输入框变矮。

- **文件改动列表行右侧按钮不再挤占文件名或留白。** 撤销与暂存按钮采用绝对定位与右边缘对齐，闲置时数字一直延伸到边框边缘，悬停时数字让位后按钮渐入，移开时按钮先走数字后回，消除同时半透明重叠的毛刺感。

- **用户消息气泡支持 Markdown 渲染，侧边聊天不再把附件内部记号展示在气泡中。** 用户消息整段按 Markdown 正常排版；侧边聊天接入独立显示文本与附件结构，模型专用的附件展开正文与文件头不会再泄露在气泡内，重新编辑也不会把附件代码反填进输入框。

- **Windows 顶栏与系统按钮高度恢复标准比例。** Windows/Linux 顶栏拆出专用的原生标题栏高度（32px），不再套用 macOS 红绿灯专用的 44px 高度，标题栏按钮恢复正常大小；面板与会话窗口补齐顶栏底色，消除内容顶住顶部的遮挡感。

- **转录末尾思考指示器精准跟随最后一条用户气泡。** 移除了容易造成状态卡死的「等上一条回复完成」提示，在排队或连续提问时，等待动画始终紧跟最新发送的气泡。

- **Git 改动列表记住树形与平铺视图偏好。** 切换为树形展示后偏好保存至本地，关闭面板、切换分支、切换会话或重启应用均不会意外重置回平铺。

- **设置页长密钥不再遮挡眼睛显隐按钮。** 密钥输入框与眼睛切换按钮统一使用 flex 排版布局，长密钥字符与圆点停在按钮左侧，避免长字符串将切换按钮盖住。

</details>

<!-- lyra:notes zh-TW -->

<details>
<summary>中文（繁體）</summary>

### 修復

- **Git 提交變更改為居中彈窗，分支可直接選取或新建。** 提交介面從先前遮擋半個面板與檔案清單的浮層，改為居中彈窗，採用與主輸入框一致的圓角、邊框與間距。分支列可直接展開本機分支清單或新建分支，按下提交時才執行切換；產生的提交訊息會寫回輸入框，語言切換按鈕常駐顯示，不再因開始打字而跳動或縮排。

- **檔案變更清單右側按鈕不再擠壓檔名或留白。** 復原與暫存按鈕採用絕對定位對齊右側邊緣，平時數字延伸至最右端，懸停時數字讓位後按鈕淡入，離開時按鈕先退後數字補回，避免兩者同時半透明重疊。

- **使用者訊息對話框支援 Markdown 呈現，側邊聊天不再顯示內部附件標記。** 使用者訊息依 Markdown 正常排版；側邊聊天分離顯示文字與附件資料，不再將給模型讀取的附件檔頭曝露在對話框中，重新編輯時也不會帶入附件原始碼。

- **Windows 頂欄與系統按鈕高度還原標準比例。** Windows/Linux 頂欄採用專屬原生高度（32px），不再誤套用 macOS 紅綠燈的 44px 高度；面板與對話視窗補齊標題列底色，內容不再被頂部邊界遮蓋。

- **佇列狀態指示器精準跟隨最後一筆使用者訊息。** 移除容易卡住的「等上一條回覆完成」文字，在連續傳送訊息時，載入中旋轉圖示永遠緊跟在最新的使用者對話框下方。

- **Git 變更清單記住樹狀與平鋪檢視偏好。** 切換為樹狀檢視後偏好自動儲存，關閉面板、切換分支或重啟應用均會維持設定。

- **設定頁長金鑰不再覆蓋眼睛顯隱按鈕。** 金鑰輸入框與顯隱切換按鈕統一採用 flex 排版，避免長金鑰字元覆蓋按鈕導致無法點擊。

</details>

<!-- lyra:notes ja -->

<details>
<summary>日本語</summary>

### 修正

- **Git コミット画面が中央モーダルダイアログになり、ブランチの切り替えや新規作成に対応しました。** ファイル一覧を覆っていた従来のポップオーバーから、メイン入力欄と統一感のある角丸と余白を持つ中央モーダルに変更しました。ブランチ行からローカルブランチの選択や新規ブランチ作成が可能になり、生成されたコミット文は入力欄に反映され、言語切り替えボタンも入力中常時表示されます。

- **変更ファイル一覧右端のボタン配置を整理しました。** 取り消し・ステージングボタンを右端に絶対配置し、待機時は増減数が端まで表示され、ホバー時は数値を先に隠してからボタンを表示する段階的な遷移にすることで、半透明の重複表示を防ぎました。

- **メッセージ吹き出しの Markdown 表示に対応し、サイドチャットの内部添付表記を隠しました。** 吹き出し内の Markdown が正しくレンダリングされるようになりました。サイドチャットでもモデル向けの展開記法（`### Attached file: ...`）が画面や再編集用テキストに混入しないよう分離しました。

- **Windows のタイトルバーとボタンの大きさを標準比率に修正しました。** Windows/Linux のヘッダー高さを標準の 32px に設定し、macOS 向けの 44px を適用していたことによるボタン肥大化を解消しました。また、パネルおよび会話ウィンドウにも適切なヘッダー背景色を適用しました。

- **処理中スピナーが常に最新のユーザーメッセージに追従するよう改善しました。** 状態が固まりやすかった「前の応答を待っています」表記を撤去し、キュー実行時もスピナーが最新メッセージの直下に自然に配置されます。

- **Git 変更一覧のツリー表示・フラット表示設定を保持するようにしました。** 表示形式の切り替えがローカルに保存され、パネルの開閉やブランチ切り替え、再起動後も状態を維持します。

- **設定画面の長い API キーが目のトグルボタンに被らないようレイアウトを修正しました。** flex レイアウトにより入力テキストがボタンの手前で収まるようになり、長いキーを入力してもボタンが覆われることがなくなりました。

</details>

<!-- lyra:notes ko -->

<details>
<summary>한국어</summary>

### 고친 것

- **Git 커밋 화면을 중앙 모달 다이얼로그로 개편하고 브랜치 생성 및 선택을 연결했습니다.** 파일 목록을 덮던 좁은 팝오버를 메인 입력창과 동일한 여백과 둥근 모서리를 가진 중앙 모달로 바꾸었습니다. 브랜치 행에서 로컬 브랜치 선택 및 새 브랜치 생성이 가능하며, 자동 생성된 커밋 메시지는 입력창에 표시되고 언어 선택 버튼도 입력 중 사라지지 않고 고정됩니다.

- **파일 변경 목록 우측 버튼들의 겹침과 여백 문제를 해결했습니다.** 되돌리기 및 스테이징 버튼을 우측 끝에 배치하여 평소에는 변경 수치가 끝까지 늘어나고, 마우스를 올리면 수치가 먼저 물러난 뒤 버튼이 나타나 반투명하게 겹치는 현상을 방지했습니다.

- **사용자 말풍선에 Markdown 렌더링을 적용하고 사이드 채팅의 내부 첨부 표기를 숨겼습니다.** 대화창의 Markdown이 정상적으로 표시됩니다. 사이드 채팅에서도 모델 전달용 첨부 헤더(`### Attached file: ...`)가 말풍선이나 편집창에 노출되지 않도록 표시 텍스트를 분리했습니다.

- **Windows 상단 바와 캡션 버튼 높이를 표준 규격으로 복원했습니다.** Windows/Linux 전용 헤더 높이(32px)를 분리하여 macOS용 44px로 인해 버튼이 커지던 문제를 고치고, 패널 및 세션 창 상단에도 일관된 배경색을 적용했습니다.

- **진행 스피너가 항상 마지막 사용자 말풍선 아래에 자연스럽게 위치합니다.** 멈춤 현상을 유발하던 「이전 응답 완료 대기」 문구를 제거하고, 큐에 대기 중일 때도 로딩 링이 최신 메시지 아래에 정확히 표시됩니다.

- **Git 변경 목록의 트리/플랫 보기 설정이 유지됩니다.** 트리 뷰 선택 시 상태가 저장되어 패널을 닫거나 브랜치를 전환하고 앱을 다시 열어도 설정이 그대로 유지됩니다.

- **설정 화면에서 긴 API 키가 눈 모양 토글 버튼을 가리지 않습니다.** flex 배치를 적용하여 입력 글자가 버튼 왼쪽에 안전하게 멈추도록 개선했습니다.

</details>

<!-- lyra:notes fr -->

<details>
<summary>Français</summary>

### Corrections

- **La boîte de commit et push devient une boîte de dialogue centrale avec gestion complète des branches.** L'interface de validation quitte le popover étroit qui chevauchait la liste des fichiers pour une boîte modale centrée adoptant les mêmes arrondis et marges que le champ principal. La ligne de branche permet de basculer vers une autre branche locale ou d'en créer une nouvelle à la validation ; le message généré s'inscrit dans le champ et le sélecteur de langue reste toujours visible pendant la saisie.

- **Les boutons d'action sur les lignes de fichiers modifiés ne se superposent plus.** Les boutons d'annulation et d'indexation sont positionnés à l'extrémité droite avec une transition soignée : au survol, les compteurs s'effacent avant l'apparition des boutons, évitant tout effet de chevauchement translucide.

- **Les bulles utilisateur prennent en charge le Markdown et le chat latéral masque les balises techniques.** Les messages affichent désormais correctement les blocs Markdown. Le chat latéral sépare le texte affiché des données brutes transmises aux modèles, évitant l'affichage des en-têtes de pièces jointes dans les bulles ou dans la zone d'édition.

- **Hauteur de barre de titre et des boutons système ajustée sous Windows.** La barre d'en-tête sous Windows/Linux adopte une hauteur standard de 32 px au lieu des 44 px hérités de macOS, redonnant aux boutons de contrôle leur taille normale. L'arrière-plan de la barre est également appliqué aux fenêtres de panneaux et de sessions.

- **L'indicateur d'activité reste accroché à la dernière bulle envoyée.** Suppression de la mention fragile « En attente de la réponse précédente » : l'anneau de chargement s'aligne toujours sous le message le plus récent, y compris en cas de messages consécutifs.

- **La vue des modifications Git conserve la préférence d'arborescence.** Le choix entre l'affichage en arborescence ou à plat reste mémorisé après la fermeture du panneau, le changement de branche ou le redémarrage.

- **Les clés secrètes longues dans les paramètres ne masquent plus l'icône de visibilité.** Une disposition flex garantit que le texte s'arrête avant le bouton œil, permettant de masquer ou afficher la clé sans gêne.

</details>

<!-- lyra:notes ru -->

<details>
<summary>Русский</summary>

### Исправления

- **Диалог фиксации и отправки стал центральным окном с полным управлением ветками.** Интерфейс коммита перенесён из тесного всплывающего окна, перекрывавшего список файлов, в центрированное модальное окно с такими же скруглениями и отступами, как у основного поля ввода. В строке ветки теперь можно выбрать локальную ветку или создать новую; сгенерированное сообщение выводится в поле ввода, а кнопка выбора языка не исчезает при начале набора.

- **Кнопки действий в строках изменений больше не перекрывают имя файла и счётчики.** Кнопки отката и индексации выровнены по правому краю: при наведении счётчики изменений скрываются до появления кнопок, что исключает полупрозрачное наложение элементов.

- **В сообщениях пользователя поддержан Markdown, а технические метки вложений скрыты в боковом чате.** Текст в пузырях форматируется по правилам Markdown. В боковом чате отделён текст для показа от данных модели, поэтому служебные заголовки вложений (`### Attached file: ...`) больше не отображаются в переписке и не попадают в поле редактирования.

- **Корректные пропорции заголовка окна и кнопок управления в Windows.** Высота заголовка для Windows/Linux уменьшена до стандартных 32 px вместо 44 px (использовавшихся для кнопок macOS), что вернуло кнопкам стандартный размер. Панели и окна разговоров получили фон заголовка, исключающий наплыв содержимого.

- **Индикатор обработки теперь прикреплён к последнему сообщению пользователя.** Удалена строка «Ожидание предыдущего ответа», приводившая к зависаниям: спиннер теперь всегда отображается под последним отправленным сообщением.

- **Список изменений Git запоминает выбор между деревом и плоским списком.** Выбранный режим отображения сохраняется при закрытии панели, переключении веток и перезапуске приложения.

- **Длинные ключи API в настройках не закрывают кнопку скрытия.** За счёт flex-разметки текст ввода останавливается перед кнопкой с иконкой глаза, позволяя свободно переключать видимость ключа.

</details>

## [0.9.17](https://github.com/kittors/Lyra/releases/tag/v0.9.17) - 2026-09-19

<!-- lyra:notes en -->

### Fixes

- **Panels moved themselves into windows of their own whenever the window got narrow — and never came back.** 0.9.16 introduced this deliberately, to stop text being squeezed: anything that no longer fitted opened separately. The threshold turned out to be an everyday one. A conversation plus one panel needs 720 px of dock; a new window is 980 px wide and the sidebar takes 272 of that, leaving 708. So the default window size was already past the line, and dragging a window narrower — or putting a second conversation on the screen — handed your terminal or your browser to a window of its own. Widening it again did nothing; each one had to be fetched back by hand, and a cold start threw them out again. Splitting the screen was worse: one resize could open a window for every panel on that screen plus one for the conversation, all stacked on the same spot. That route is gone. A dock too small for its panels now draws them squeezed, which is something you can see and undo by widening the window.

- **The side chat opened as an empty conversation in its own window, and would not send.** Everything it does — showing the transcript, sending what you type — reads the conversation it is attached to, and nothing in that window ever attached it. So the panel showed nothing, and the composer took your text and did nothing with it. The history was never lost; no one had asked for it.

- **A detached terminal started a new shell instead of reconnecting to yours.** The panel window mounts the terminal in its first frame, before the project directory has resolved, so it looked for a terminal in an empty directory, found none, and opened one. The server you had running was still there, and unreachable from that window. It now goes back to the shell it left, with its output.

- **The Git panel stopped refreshing once it was in a window of its own.** It worked out whether it was on screen by looking for itself in a dock that kind of window does not have, so the answer was always no — the first fetch and the five-minute poll never ran at all.

- **Clicking a file in a detached file tree did nothing.** The click now goes to the main window, which is where the file opens, and brings that window to the front.

### Changed

- **The browser no longer offers "Open in a new window."** A live page cannot be moved between windows: the new one loads it again from its address, which loses the scroll position, anything typed into a form, and whatever the page itself was holding. Offering the button and then throwing that away is worse than not offering it. Panels now declare whether they survive the move, and only the browser says no.

<!-- lyra:notes zh-CN -->

<details>
<summary>中文（简体）</summary>

### 修复

- **窗口一窄，面板就自己跑出去变成独立窗口，而且再也回不来。** 这是 0.9.16 特意加的，为的是别让文字被挤扁：放不下的就另开一个窗口。但那条线比想象中低得多——一个会话加一个面板要 720 px，而新窗口宽 980 px、侧边栏占掉 272，只剩 708。也就是说默认尺寸就已经过线了：把窗口拖窄一点，或者把第二个会话放上屏，终端或者浏览器就被送进了自己的窗口。再拖大也不会回来，得一个个去点「收回」，而下次开应用它们又会飞出去。分屏时更彻底：一次缩窗可能给那一屏的每个面板各开一个窗口，再加上会话本身一个，还全叠在同一个位置。这条路整个去掉了。dock 装不下面板时就画得挤一点——那是你看得见、拉宽窗口就能解决的事。

- **侧边聊天弹成独立窗口之后是空的，打了字也发不出去。** 它做的每件事——显示对话、把你打的字发出去——都要先知道自己接在哪个会话上，而那个窗口里从来没有人帮它接。于是面板空着，输入框收下文字然后什么也不做。记录一直都在，只是没人去取。

- **终端弹出去之后是一个新开的空 shell，不是你原来那个。** 面板窗口在第一帧就把终端挂上，那时项目目录还没解析出来，于是它在一个空目录里找终端，找不到，就新开了一个。你正跑着的服务还在，只是那个窗口里够不到。现在它会接回原来那个，连之前的输出一起。

- **Git 面板弹成独立窗口后就不再刷新了。** 它判断「我在不在屏幕上」的办法是去 dock 里找自己，而那种窗口根本没有 dock，所以答案永远是否——首次拉取和五分钟一次的轮询一次都没跑过。

- **在弹出去的文件树里点文件，什么也不会发生。** 现在这一下会转给主窗口，文件在那里打开，主窗口也会被带到前面。

### 变更

- **浏览器不再提供「在新窗口打开」。** 一个正开着的页面没法在窗口之间搬：新窗口只能按地址重新加载一遍，滚动位置、填了一半的表单、页面自己攥着的状态全都没了。给了按钮再把这些丢掉，比不给更糟。现在每个面板都要说明自己搬不搬得动，说不的只有浏览器。

</details>

<!-- lyra:notes zh-TW -->

<details>
<summary>中文（繁體）</summary>

### 修復

- **視窗一窄，面板就自己跑出去變成獨立視窗，而且再也回不來。** 這是 0.9.16 特意加的，為的是別讓文字被擠扁：放不下的就另開一個視窗。但那條線比想像中低得多——一個對話加一個面板要 720 px，而新視窗寬 980 px、側邊欄佔掉 272，只剩 708。也就是說預設尺寸就已經過線了：把視窗拖窄一點，或者把第二個對話放上螢幕，終端機或瀏覽器就被送進了自己的視窗。再拖大也不會回來，得一個個去點「收回」，而下次開應用它們又會飛出去。分割畫面時更徹底：一次縮小可能給那一畫面的每個面板各開一個視窗，再加上對話本身一個，還全疊在同一個位置。這條路整個拿掉了。dock 裝不下面板時就畫得擠一點——那是你看得見、拉寬視窗就能解決的事。

- **側邊聊天彈成獨立視窗之後是空的，打了字也送不出去。** 它做的每件事——顯示對話、把你打的字送出去——都要先知道自己接在哪個對話上，而那個視窗裡從來沒有人幫它接。於是面板空著，輸入框收下文字然後什麼也不做。紀錄一直都在，只是沒人去取。

- **終端機彈出去之後是一個新開的空 shell，不是你原來那個。** 面板視窗在第一個影格就把終端機掛上，那時專案目錄還沒解析出來，於是它在一個空目錄裡找終端機，找不到，就新開了一個。你正跑著的服務還在，只是那個視窗裡搆不到。現在它會接回原來那個，連之前的輸出一起。

- **Git 面板彈成獨立視窗後就不再重新整理了。** 它判斷「我在不在畫面上」的辦法是去 dock 裡找自己，而那種視窗根本沒有 dock，所以答案永遠是否——首次抓取和五分鐘一次的輪詢一次都沒跑過。

- **在彈出去的檔案樹裡點檔案，什麼也不會發生。** 現在這一下會轉給主視窗，檔案在那裡開啟，主視窗也會被帶到前面。

### 變更

- **瀏覽器不再提供「在新視窗開啟」。** 一個正開著的頁面沒辦法在視窗之間搬：新視窗只能按網址重新載入一遍，捲動位置、填了一半的表單、頁面自己攥著的狀態全都沒了。給了按鈕再把這些丟掉，比不給更糟。現在每個面板都要說明自己搬不搬得動，說不的只有瀏覽器。

</details>

<!-- lyra:notes ja -->

<details>
<summary>日本語</summary>

### 修正

- **ウィンドウを狭めると、パネルが勝手に別ウィンドウへ移り、戻ってきませんでした。** 0.9.16 で意図的に入れた動きです。文字が潰れないよう、収まらないものを別ウィンドウで開く——ただ、その境目が日常的すぎました。会話ひとつとパネルひとつで dock に 720 px 必要ですが、新しいウィンドウは幅 980 px、サイドバーが 272 px を取るので残りは 708 px。つまり既定のサイズで既に越えていたのです。少し狭めるか、二つ目の会話を画面に出すだけで、ターミナルやブラウザーが自分のウィンドウへ送られました。広げ直しても戻らず、ひとつずつ「元に戻す」を押す必要があり、次の起動でまた出ていきました。画面分割時はさらに徹底していて、一度のサイズ変更でその画面のパネルの数だけウィンドウが開き、会話の分も加わって、すべて同じ位置に重なりました。この経路をまるごと廃止しました。パネルが収まらない dock は、詰めて描きます——目に見えますし、広げれば直ります。

- **サイドチャットを別ウィンドウで開くと空で、入力しても送信できませんでした。** 会話の表示も送信も、どの会話に紐づいているかを先に知る必要がありますが、あのウィンドウでは誰もそれを結び付けていませんでした。パネルは空のまま、入力欄は文字を受け取って何もしません。履歴が消えていたわけではなく、誰も取りに行っていなかっただけです。

- **切り離したターミナルが、元のシェルではなく新しいシェルを開いていました。** パネルウィンドウは最初のフレームでターミナルを配置しますが、その時点ではプロジェクトのディレクトリがまだ解決されていません。空のディレクトリでターミナルを探し、見つからず、新しく開いていたのです。動かしていたサーバーはそのまま残り、そのウィンドウからは届きませんでした。今は離れたときのシェルに、出力ごと戻ります。

- **Git パネルは別ウィンドウに移ると更新を止めていました。** 「自分は画面に出ているか」を dock の中から自分を探して判断していましたが、その種類のウィンドウに dock はありません。答えは常に「いいえ」で、最初の取得も五分ごとの巡回も一度も走りませんでした。

- **切り離したファイルツリーでファイルを押しても何も起きませんでした。** その操作はメインウィンドウへ渡るようになり、ファイルはそちらで開き、ウィンドウも前面に出ます。

### 変更

- **ブラウザーの「新しいウィンドウで開く」をなくしました。** 開いているページはウィンドウ間を移動できません。新しい側はアドレスから読み込み直すだけで、スクロール位置も、途中まで入力したフォームも、ページ自身が抱えていた状態も失われます。ボタンを出しておいてそれらを捨てるのは、出さないより悪い判断です。各パネルは移動に耐えられるかを自分で宣言するようになり、いいえと答えるのはブラウザーだけです。

</details>

<!-- lyra:notes ko -->

<details>
<summary>한국어</summary>

### 고친 것

- **창을 좁히면 패널이 스스로 별도 창으로 나가고, 다시 돌아오지 않았습니다.** 0.9.16에서 일부러 넣은 동작입니다. 글자가 눌리지 않도록, 들어가지 않는 것은 따로 열었습니다. 그런데 그 경계가 너무 일상적이었습니다. 대화 하나와 패널 하나면 dock에 720 px이 필요한데, 새 창은 너비 980 px이고 사이드바가 272 px을 가져가 708 px만 남습니다. 기본 크기에서 이미 선을 넘어 있었던 셈입니다. 창을 조금 좁히거나 두 번째 대화를 화면에 올리기만 해도 터미널이나 브라우저가 자기 창으로 보내졌습니다. 다시 넓혀도 돌아오지 않아 하나씩 「되돌리기」를 눌러야 했고, 다음 실행 때 또 나갔습니다. 화면 분할에서는 더 심해서, 한 번 크기를 바꾸면 그 화면의 패널 수만큼 창이 열리고 대화 몫까지 더해져 모두 같은 자리에 겹쳤습니다. 이 경로를 통째로 없앴습니다. 패널이 들어가지 않는 dock은 이제 좁게 그립니다 — 눈에 보이고, 창을 넓히면 풀립니다.

- **사이드 채팅을 별도 창으로 열면 비어 있었고, 입력해도 보내지지 않았습니다.** 대화를 보여 주는 일도 입력을 보내는 일도, 어느 대화에 붙어 있는지 먼저 알아야 합니다. 그런데 그 창에서는 아무도 그것을 붙여 주지 않았습니다. 패널은 비어 있었고 입력창은 글자를 받고도 아무 일도 하지 않았습니다. 기록이 사라진 게 아니라, 아무도 가지러 가지 않았을 뿐입니다.

- **떼어 낸 터미널이 원래 셸 대신 새 셸을 열었습니다.** 패널 창은 첫 프레임에서 터미널을 붙이는데, 그때는 프로젝트 디렉터리가 아직 정해지지 않았습니다. 빈 디렉터리에서 터미널을 찾다가 못 찾고 새로 연 것입니다. 돌리고 있던 서버는 그대로 남았지만 그 창에서는 닿을 수 없었습니다. 이제는 떠날 때의 셸로, 그동안의 출력과 함께 돌아갑니다.

- **Git 패널은 자기 창으로 옮겨지면 새로 고침을 멈췄습니다.** 「내가 화면에 있나」를 dock 안에서 자신을 찾아 판단했는데, 그런 창에는 dock이 없습니다. 답은 늘 아니오였고, 첫 가져오기도 5분마다의 확인도 한 번도 돌지 않았습니다.

- **떼어 낸 파일 트리에서 파일을 눌러도 아무 일이 없었습니다.** 이제 그 동작은 메인 창으로 전달되어 거기서 파일이 열리고, 그 창이 앞으로 나옵니다.

### 바뀐 것

- **브라우저에는 「새 창에서 열기」가 더 이상 없습니다.** 열려 있는 페이지는 창 사이를 옮길 수 없습니다. 새 창은 주소로 다시 불러올 뿐이어서 스크롤 위치도, 쓰다 만 양식도, 페이지가 들고 있던 것도 모두 사라집니다. 버튼을 주고 그것들을 버리는 쪽이 안 주는 쪽보다 나쁩니다. 이제 각 패널이 옮겨 가도 되는지를 스스로 밝히고, 아니라고 답하는 것은 브라우저뿐입니다.

</details>

<!-- lyra:notes fr -->

<details>
<summary>Français</summary>

### Corrections

- **Dès que la fenêtre devenait étroite, les panneaux partaient d'eux-mêmes dans une fenêtre séparée — et ne revenaient jamais.** La 0.9.16 l'avait introduit exprès, pour que le texte ne soit pas écrasé : ce qui ne tenait plus s'ouvrait à part. Le seuil s'est avéré tout à fait ordinaire. Une conversation plus un panneau demandent 720 px de dock ; une nouvelle fenêtre fait 980 px de large et la barre latérale en prend 272, il en reste 708. La taille par défaut était donc déjà au-delà. Rétrécir un peu la fenêtre — ou mettre une deuxième conversation à l'écran — envoyait votre terminal ou votre navigateur dans une fenêtre à lui. L'élargir de nouveau ne changeait rien : il fallait aller les rechercher un par un, et au démarrage suivant ils repartaient. En écran partagé c'était pire : un seul redimensionnement pouvait ouvrir une fenêtre par panneau de cet écran, plus une pour la conversation, toutes empilées au même endroit. Ce chemin a été supprimé. Un dock trop petit pour ses panneaux les dessine désormais serrés — c'est visible, et élargir la fenêtre suffit.

- **Le chat latéral s'ouvrait vide dans sa propre fenêtre et n'envoyait rien.** Afficher la conversation comme envoyer ce que vous tapez suppose de savoir à quelle conversation il est rattaché, et personne ne l'y rattachait dans cette fenêtre. Le panneau restait vide et le champ acceptait le texte sans rien en faire. L'historique n'avait pas disparu : personne n'était allé le chercher.

- **Un terminal détaché ouvrait un nouveau shell au lieu de retrouver le vôtre.** La fenêtre de panneau monte le terminal dès sa première image, avant que le dossier du projet ne soit résolu : elle cherchait un terminal dans un dossier vide, n'en trouvait pas, et en ouvrait un. Le serveur que vous aviez lancé était toujours là, hors d'atteinte depuis cette fenêtre. Il retrouve maintenant le shell qu'il avait quitté, avec sa sortie.

- **Le panneau Git cessait de se rafraîchir une fois dans sa propre fenêtre.** Pour savoir s'il était à l'écran, il se cherchait dans un dock que ce type de fenêtre n'a pas : la réponse était toujours non, et ni la première récupération ni le relevé toutes les cinq minutes n'ont jamais eu lieu.

- **Cliquer un fichier dans une arborescence détachée ne faisait rien.** Le clic passe maintenant à la fenêtre principale, où le fichier s'ouvre, et cette fenêtre revient au premier plan.

### Changements

- **Le navigateur ne propose plus « Ouvrir dans une nouvelle fenêtre ».** Une page ouverte ne se déplace pas d'une fenêtre à l'autre : la nouvelle la recharge depuis son adresse, ce qui perd la position de défilement, un formulaire à moitié rempli et tout ce que la page gardait en mémoire. Proposer le bouton pour ensuite jeter tout cela est pire que ne pas le proposer. Chaque panneau déclare désormais s'il survit au déplacement ; seul le navigateur répond non.

</details>

<!-- lyra:notes ru -->

<details>
<summary>Русский</summary>

### Исправления

- **Стоило сузить окно — и панели сами уходили в отдельные окна, откуда уже не возвращались.** В 0.9.16 это было сделано намеренно, чтобы текст не сплющивался: то, что не помещалось, открывалось отдельно. Порог оказался совершенно будничным. Разговору и одной панели нужно 720 px дока; новое окно шириной 980 px, боковая панель забирает 272 — остаётся 708. То есть размер по умолчанию уже был за чертой. Достаточно было немного сузить окно или вывести на экран второй разговор, чтобы терминал или браузер уехали в собственное окно. Обратное расширение ничего не меняло: каждую панель приходилось возвращать вручную, а при следующем запуске они улетали снова. При разделённом экране выходило хуже: одно изменение размера открывало по окну на каждую панель этого экрана плюс окно для самого разговора — и все в одной и той же точке. Этот путь убран целиком. Док, в который панели не помещаются, теперь рисует их сжатыми — это видно, и лечится расширением окна.

- **Боковой чат открывался в своём окне пустым и ничего не отправлял.** И показ переписки, и отправка написанного требуют знать, к какому разговору он привязан, — а в том окне его никто не привязывал. Панель оставалась пустой, поле принимало текст и ничего с ним не делало. История никуда не девалась: за ней просто никто не пришёл.

- **Отделённый терминал открывал новую оболочку вместо вашей.** Окно панели подключает терминал на первом же кадре, когда каталог проекта ещё не определён: оно искало терминал в пустом каталоге, не находило и открывало новый. Запущенный вами сервер продолжал работать, но из этого окна был недоступен. Теперь терминал возвращается к той оболочке, которую покинул, вместе с её выводом.

- **Панель Git переставала обновляться, оказавшись в отдельном окне.** Она выясняла, видна ли она, поиском себя в доке, которого у такого окна нет: ответ всегда был «нет», и ни первая загрузка, ни пятиминутный опрос не выполнялись ни разу.

- **Щелчок по файлу в отделённом дереве файлов ничего не делал.** Теперь он уходит в главное окно — файл открывается там, и это окно выходит на передний план.

### Изменения

- **У браузера больше нет пункта «Открыть в новом окне».** Открытую страницу нельзя перенести между окнами: новое окно просто загрузит её заново по адресу, потеряв положение прокрутки, наполовину заполненную форму и всё, что страница держала в памяти. Дать кнопку и затем всё это выбросить — хуже, чем не давать её вовсе. Теперь каждая панель сама сообщает, переживёт ли она переезд; отвечает «нет» только браузер.

</details>

## [0.9.16](https://github.com/kittors/Lyra/releases/tag/v0.9.16) - 2026-09-19

<!-- lyra:notes en -->

### New

- **Keep up to four conversations in one window.** Each chat owns its tools; chats stay at least 420 px wide, tools at least 300 px, and anything that no longer fits opens in a separate window.

- **Drag browsers and terminals with their contents visible.** Rearrange them with the pointer or arrow keys, expand a panel within its chat, or open a separate window with pin and return controls. File windows keep open tabs and unsaved edits.

- **Number fields in Settings keep a draft while you type.** You can finish entering “16” before the value is checked against its limits.

### Fixes

- **Screenshot downloads still save when the clipboard is busy.** The confirmation shows the file path; a failed save keeps the selection for retry, using the current download directory.

- **Chats with large images open sooner, and expanding a section keeps your place.** Thumbnails are reused, and opening a section no longer jumps to the end of the conversation.

- **Switching conversations keeps the sidebar highlight on the selected chat.** Refreshing also restores its split layout and tools.

- **Windows previews keep their ports when connection probing fails.** The reasoning effort menu also responds after saving an agent.

- **Long branch names leave room for their action buttons.** Workspace and Local rows align their icons with the conversation list.

<!-- lyra:notes zh-CN -->

<details>
<summary>中文（简体）</summary>

### 新功能

- **一个窗口最多同时查看四个会话。** 每个会话有自己的工具；对话至少保留 420 px 宽，工具至少 300 px，缩小窗口后放不下的内容会转到独立窗口。

- **拖动浏览器和终端时，内容跟着容器一起移动。** 可以用鼠标或方向键调整位置，在当前会话内展开面板，也可以单独开窗、置顶、收回。文件面板切换窗口时保留标签和未保存修改。

- **设置里的数字可以输完再检查。** 输入「16」时，不会刚打出「1」就被改掉。

### 修复

- **剪贴板被占用时，下载截图仍会保存文件。** 成功后显示完整路径，失败时保留选区供重试，下载位置按当前设置生效。

- **带大图的会话打开更快，展开内容也不会跳到对话末尾。** 缩略图会复用，展开折叠区时保留阅读位置。

- **切换会话时，侧栏高亮停在选中的那一行。** 刷新后也会恢复分屏和各会话里的工具。

- **Windows 上探测连接表失败时，预览仍会显示端口。** 保存智能体后，推理强度菜单也能继续切换。

- **长分支名会给操作按钮留位置。** 工作区和本地分支的图标与会话列表对齐。

</details>

<!-- lyra:notes zh-TW -->

<details>
<summary>中文（繁體）</summary>

### 新功能

- **同一視窗最多查看四個對話。** 每個對話保有自己的工具；對話至少保留 420 px 寬，工具至少 300 px，縮小視窗後放不下的內容會另開視窗。

- **拖曳瀏覽器與終端機時，可以一直看見內容。** 支援滑鼠和方向鍵調整位置、在對話內展開面板，以及獨立視窗的置頂與收回。檔案面板移到其他視窗時，分頁和未儲存的修改都會保留。

- **設定裡的數字可以輸入完再檢查。** 輸入「16」時，不會才打出「1」就被改掉。

### 修復

- **剪貼簿被占用時，下載截圖仍會存成檔案。** 成功後顯示完整路徑，失敗時保留選取範圍供重試，下載位置依目前設定生效。

- **包含大圖的對話開啟更快，展開內容不再跳到末尾。** 縮圖會重複使用，展開摺疊區時保留閱讀位置。

- **切換對話時，側欄反白停在選取的那一列。** 重新整理後也會還原分割配置和各對話的工具。

- **Windows 無法取得連線清單時，預覽仍會顯示連接埠。** 儲存智能體後，推理強度選單也能繼續切換。

- **長分支名稱會為操作按鈕留出空間。** 工作區和本機分支的圖示與對話清單對齊。

</details>

<!-- lyra:notes ja -->

<details>
<summary>日本語</summary>

### 新機能

- **1つのウィンドウで最大4つの会話を表示できます。** ツールは会話ごとに配置され、会話は幅420 px、ツールは300 pxを下回らず、収まらなくなると別ウィンドウに移ります。

- **ブラウザやターミナルの内容を見ながらドラッグできます。** 矢印キーでの配置変更、会話内での拡大、別ウィンドウへの切り離し、最前面表示、元の場所への復帰に対応しました。ファイルのタブと未保存の編集内容も、ウィンドウを移る際に引き継ぎます。

- **設定の数値は入力し終えてから検証されます。** 「16」と入力する途中の「1」が勝手に変わることはありません。

### 修正

- **クリップボードが使用中でもスクリーンショットを保存できます。** 保存先を表示し、失敗した場合は選択範囲を残して再試行でき、変更後の保存先もすぐに反映されます。

- **大きな画像を含む会話が早く開きます。** サムネイルを再利用し、折りたたまれた内容を開いても会話の末尾へ飛ばなくなりました。

- **会話を切り替えたとき、サイドバーの選択表示が戻らなくなりました。** 再読み込み後も分割配置と各会話のツールを復元します。

- **Windowsで接続一覧を取得できなくても、プレビューのポートを表示します。** エージェントを保存した後も推論レベルを変更できます。

- **長いブランチ名が操作ボタンに重ならなくなりました。** ワークスペースとローカルのアイコン位置も会話一覧に合わせました。

</details>

<!-- lyra:notes ko -->

<details>
<summary>한국어</summary>

### 새로운 기능

- **한 창에서 대화를 최대 4개까지 볼 수 있습니다.** 도구는 각 대화에 속하며, 대화 너비는 420 px, 도구는 300 px 이상을 유지하고 공간이 부족하면 별도 창으로 옮깁니다.

- **브라우저와 터미널의 내용을 보면서 끌어 옮길 수 있습니다.** 방향키로 배치를 바꾸거나 대화 안에서 패널을 펼칠 수 있고, 별도 창에서 항상 위에 표시하거나 원래 위치로 돌려놓을 수도 있습니다. 파일 패널을 다른 창으로 옮겨도 열린 탭과 저장하지 않은 수정 사항은 유지됩니다.

- **설정의 숫자는 입력을 마친 뒤에 검사합니다.** “16”을 입력하는 중간에 “1”이 다른 값으로 바뀌지 않습니다.

### 수정

- **클립보드가 사용 중이어도 스크린샷 파일은 저장됩니다.** 저장 경로를 표시하고 실패하면 선택 영역을 유지해 다시 시도할 수 있으며, 변경한 다운로드 폴더도 바로 적용됩니다.

- **큰 이미지가 있는 대화가 더 빨리 열립니다.** 썸네일을 재사용하고, 접힌 내용을 펼쳐도 대화 끝으로 이동하지 않습니다.

- **대화를 전환할 때 사이드바 선택 표시가 이전 항목으로 돌아가지 않습니다.** 새로고침 후에도 분할 배치와 각 대화의 도구를 복원합니다.

- **Windows에서 연결 목록을 읽지 못해도 미리보기 포트는 표시됩니다.** 에이전트를 저장한 뒤에도 추론 강도를 바꿀 수 있습니다.

- **긴 브랜치 이름이 작업 버튼을 가리지 않습니다.** 작업 공간과 로컬 브랜치의 아이콘도 대화 목록에 맞춰 정렬했습니다.

</details>

<!-- lyra:notes fr -->

<details>
<summary>Français</summary>

### Nouveautés

- **Affichez jusqu’à quatre conversations dans une fenêtre.** Chaque conversation garde ses outils, avec une largeur minimale de 420 px pour le dialogue et de 300 px pour les outils ; ce qui ne tient plus s’ouvre dans une fenêtre séparée.

- **Déplacez le navigateur et le terminal sans perdre leur contenu de vue.** Utilisez la souris ou les flèches, agrandissez un panneau dans sa conversation ou détachez-le avec des commandes pour le garder au premier plan et le ramener. Les onglets et les modifications non enregistrées suivent les fichiers d’une fenêtre à l’autre.

- **Les champs numériques attendent la fin de la saisie.** Le « 1 » de « 16 » n’est plus corrigé avant que vous ayez terminé.

### Corrections

- **Le téléchargement d’une capture fonctionne même si le presse-papiers est occupé.** Le chemin du fichier s’affiche ; en cas d’échec, la sélection reste disponible pour réessayer avec le dossier actuellement configuré.

- **Les conversations contenant de grandes images s’ouvrent plus vite.** Les miniatures sont réutilisées et déplier une section ne vous envoie plus à la fin du dialogue.

- **La sélection de la barre latérale reste sur la conversation choisie.** Le rechargement restaure aussi la disposition et les outils de chaque conversation.

- **Sous Windows, l’aperçu affiche son port même si la lecture des connexions échoue.** Le niveau de raisonnement reste modifiable après l’enregistrement d’un agent.

- **Les noms de branche longs laissent de la place aux boutons.** Les icônes des branches locales et de l’espace de travail sont alignées avec celles des conversations.

</details>

<!-- lyra:notes ru -->

<details>
<summary>Русский</summary>

### Новое

- **В одном окне можно открыть до четырёх разговоров.** У каждого свои инструменты: ширина разговора не опускается ниже 420 px, инструмента ниже 300 px, а при нехватке места содержимое переносится в отдельное окно.

- **При перетаскивании браузера и терминала их содержимое остаётся видимым.** Положение можно менять мышью или стрелками, панель можно развернуть внутри разговора, вынести в окно, закрепить поверх других окон и вернуть обратно. Открытые вкладки файлов и несохранённые правки сохраняются при переносе между окнами.

- **Числовые поля проверяют значение после окончания ввода.** Первая цифра в «16» больше не заменяется до ввода второй.

### Исправления

- **Снимок экрана сохраняется, даже если буфер обмена занят.** После сохранения виден путь к файлу, а при ошибке выделение остаётся для повторной попытки с текущей папкой загрузок.

- **Разговоры с большими изображениями открываются быстрее.** Миниатюры используются повторно, а раскрытие свёрнутого блока больше не переносит к концу разговора.

- **Выделение в боковой панели остаётся на выбранном разговоре.** После перезагрузки восстанавливаются также расположение панелей и инструменты каждого разговора.

- **В Windows предпросмотр показывает порт, даже если не удалось прочитать список соединений.** После сохранения агента можно по-прежнему менять уровень рассуждения.

- **Длинные имена веток не перекрывают кнопки действий.** Значки локальных веток и рабочего пространства выровнены со списком разговоров.

</details>

## [0.9.15](https://github.com/kittors/Lyra/releases/tag/v0.9.15) - 2026-09-17

<!-- lyra:notes en -->

### New

- **Mermaid diagrams render in the conversation.** A mermaid fence draws as a diagram instead of a wall of source.

- **Built-in formatters for more languages.** Format on save can run Prettier or the language's own formatter shipped in the app (Go, Ruff, C/C++, Dart, Swift, PHP), without installing those toolchains first.

### Fixes

- **Opening a chat no longer freezes or blanks the window.** A twelve-megabyte message paints in one frame. A damaged transcript no longer takes the page down, and the run indicator does not stay stuck after the turn has finished.

- **Pull request icons no longer sit on top of each other.**

- **The Terminal still opens when Xcode's license is unsigned.** Compiling the terminal addon used to fail there; the app falls back to the command-line tools instead of a dead panel.

- **File links stay on one line.** You see the file name, with the full path on hover. Long paths used to wrap through the chip.

- **What's new in this version follows the interface language.** English shows English, Chinese shows Chinese, anything unlisted falls back to English.

<!-- lyra:notes zh-CN -->

<details>
<summary>中文（简体）</summary>

### 新功能

- **对话里的 mermaid 围栏会画成图。** 不再是一整墙源码。

- **更多语言能直接「保存时格式化」。** 可以走 Prettier，或应用里自带的那门语言的格式化器（Go、Ruff、C/C++、Dart、Swift、PHP），不用先装那些工具链。

### 修复

- **打开会话不再把窗口卡死或整页刷白。** 一条十二兆的消息也能在一帧里画完。坏掉的转录不再拖垮页面，一轮已经结束时也不会一直挂着「还在跑」。

- **拉取请求页的图标不再叠在一起。**

- **Xcode 许可没同意时，终端仍然打得开。** 以前编终端组件会失败；现在改走命令行工具，而不是留下一个死面板。

- **指向本地文件的链接收成单行。** 只显示文件名，完整路径在悬停提示里。长路径不再把胶囊折成两行。

- **「当前版本更新内容」跟界面语言走。** 英文出英文，中文出中文，没有写过的语言退回英文。

</details>

<!-- lyra:notes zh-TW -->

<details>
<summary>中文（繁體）</summary>

### 新功能

- **對話裡的 mermaid 圍欄會畫成圖。** 不再是一整牆原始碼。

- **更多語言能直接「儲存時格式化」。** 可以走 Prettier，或應用程式內建的該語言格式化器（Go、Ruff、C/C++、Dart、Swift、PHP），不用先裝那些工具鏈。

### 修復

- **打開對話不再把視窗卡死或整頁刷白。** 一條十二 MB 的訊息也能在一幀裡畫完。壞掉的轉錄不再拖垮頁面，一輪已經結束時也不會一直掛著「還在跑」。

- **拉取請求頁的圖示不再疊在一起。**

- **Xcode 授權沒同意時，終端機仍然打得開。** 以前編終端機元件會失敗；現在改走命令列工具，而不是留下一個死面板。

- **指向本機檔案的連結收成單行。** 只顯示檔名，完整路徑在懸停提示裡。長路徑不再把膠囊折成兩行。

- **「目前版本更新內容」跟介面語言走。** 英文出英文，中文出中文，沒有寫過的語言退回英文。

</details>

<!-- lyra:notes ja -->

<details>
<summary>日本語</summary>

### 新機能

- **会話内のmermaidフェンスが図として描画されます。** ソースの壁ではなく、図が出ます。

- **より多くの言語で「保存時に整形」できます。** Prettierか、アプリに同梱した各言語のフォーマッタ（Go、Ruff、C/C++、Dart、Swift、PHP）を使います。先にツールチェーンを入れる必要はありません。

### 修正

- **会話を開いてもウィンドウが固まったり真っ白になったりしません。** 12MBのメッセージも1フレームで描画します。壊れた転写でページが落ちず、ターンが終わったあとも実行中表示が残りません。

- **プルリクエストのアイコンが重ならなくなりました。**

- **Xcodeのライセンスに未同意でもターミナルが開きます。** 以前はアドオンのビルドに失敗していました。コマンドラインツールに切り替えて、死んだパネルのままにはしません。

- **ローカルファイルへのリンクは1行のままです。** ファイル名を表示し、フルパスはホバーに出ます。長いパスでチップが折り返さなくなりました。

- **「このバージョンの更新内容」は表示言語に従います。** 英語なら英語、中国語なら中国語。未収録の言語は英語に戻します。

</details>

<!-- lyra:notes ko -->

<details>
<summary>한국어</summary>

### 새로운 기능

- **대화의 mermaid 펜스가 그림으로 렌더링됩니다.** 소스 벽 대신 다이어그램이 나옵니다.

- **더 많은 언어에서 '저장할 때 서식'을 쓸 수 있습니다.** Prettier나 앱에 들어 있는 해당 언어 포맷터(Go, Ruff, C/C++, Dart, Swift, PHP)를 쓰며, 그 툴체인을 먼저 설치할 필요는 없습니다.

### 수정

- **대화를 열어도 창이 멈추거나 하얗게 죽지 않습니다.** 12 MB 메시지도 한 프레임에 그려집니다. 손상된 기록이 페이지를 무너뜨리지 않고, 턴이 끝났는데도 실행 중으로 남지 않습니다.

- **Pull Request 아이콘이 서로 겹치지 않습니다.**

- **Xcode 라이선스에 동의하지 않아도 터미널이 열립니다.** 예전에는 터미널 애드온 빌드가 실패했습니다. 이제 명령줄 도구로 넘어가며, 죽은 패널로 남지 않습니다.

- **로컬 파일 링크는 한 줄로 유지됩니다.** 파일 이름만 보이고, 전체 경로는 마우스 오버에 있습니다. 긴 경로가 칩을 두 줄로 접지 않습니다.

- **'이번 버전의 새로운 점'은 인터페이스 언어를 따릅니다.** 영어면 영어, 중국어면 중국어. 없는 언어는 영어로 돌아갑니다.

</details>

<!-- lyra:notes fr -->

<details>
<summary>Français</summary>

### Nouveautés

- **Les blocs mermaid s'affichent en diagramme dans la conversation.** Plus un mur de source.

- **Plus de langues peuvent utiliser « Formater à l'enregistrement ».** Prettier, ou le formateur de la langue livré dans l'application (Go, Ruff, C/C++, Dart, Swift, PHP), sans installer ces toolchains d'abord.

### Corrections

- **Ouvrir une discussion ne fige plus ni ne blanchit plus la fenêtre.** Un message de douze mégaoctets se dessine en une image. Une transcription abîmée ne fait plus tomber la page, et l'indicateur d'exécution ne reste plus coincé une fois le tour terminé.

- **Les icônes des demandes de fusion ne se superposent plus.**

- **Le Terminal s'ouvre encore si la licence Xcode n'est pas acceptée.** Compiler l'extension du terminal échouait. L'application bascule vers les outils en ligne de commande au lieu d'un panneau mort.

- **Les liens vers un fichier local restent sur une ligne.** Le nom du fichier s'affiche, le chemin complet est dans l'infobulle. Un long chemin ne plie plus la pastille.

- **« Nouveautés de cette version » suit la langue de l'interface.** L'anglais affiche l'anglais, le chinois le chinois, une langue absente revient à l'anglais.

</details>

<!-- lyra:notes ru -->

<details>
<summary>Русский</summary>

### Новое

- **Блоки mermaid в беседе рисуются как схемы.** Не стена исходника.

- **Больше языков можно «Форматировать при сохранении».** Prettier или встроенный форматтер языка (Go, Ruff, C/C++, Dart, Swift, PHP), без предварительной установки этих цепочек инструментов.

### Исправления

- **Открытие беседы больше не зависает и не обеляет окно.** Сообщение на двенадцать мегабайт рисуется за один кадр. Повреждённая расшифровка больше не роняет страницу, а индикатор выполнения не зависает после окончания хода.

- **Значки на странице запросов на слияние больше не накладываются друг на друга.**

- **«Терминал» открывается, даже если лицензия Xcode не принята.** Сборка дополнения терминала падала; приложение переключается на инструменты командной строки, а не оставляет мёртвую панель.

- **Ссылки на локальные файлы остаются в одну строку.** Видно имя файла, полный путь во всплывающей подсказке. Длинный путь больше не переносит капсулу.

- **«Что нового в этой версии» следует языку интерфейса.** Английский показывает английский, китайский китайский, не записанный язык возвращается к английскому.

</details>

## [0.9.14](https://github.com/kittors/Lyra/releases/tag/v0.9.14) - 2026-09-14

<!-- lyra:notes en -->

### New

- **A new "Keep computer awake while running" switch in General settings.** When enabled, Lyra prevents your display and system from sleeping due to idle timeout during long-running tasks. Closing the laptop lid still sleeps normally according to system power policies.

### Fixes

- **Standardised button styles across settings and toolbars.** Buttons for primary creation actions like "Add provider" and "Add model" clearly pair icons with text labels and visible borders. Toolbars, table row toggles, and icon-only actions are clean and borderless.

- **In pull request details, the redundant chat button is removed and agent review pre-populates your draft.** Clicking "Ask Agent to review" directly prepares the PR review prompt in the composer, focused and ready to send, without getting lost to workspace resets.

- **The Guide button at the bottom of settings shows its text label again.** The rocket icon now sits beside "Guide" rather than standing alone as an unlabelled icon.

- **Unified loading indicators into distinct shapes.** Running items in lists, task steps, and pipelines display a smooth dashed ring (StatusSpinner); clicked buttons and action spots show a clear arc on a faint track (ActionSpinner).

<!-- lyra:notes zh-CN -->

### 新功能

- **通用设置新增「运行期间不让电脑休眠」开关。** 开启后 Lyra 运行期间不息屏、不因闲置而进入睡眠，长任务跑一夜也不会中断。合盖操作仍遵循系统电源策略正常休眠。

### 修复

- **规范全应用按钮形态与层级。** 「添加服务商」「添加模型」等创建操作采用清晰的图文加框按钮；工具栏按钮、行内开关等纯图标动作保持无边框微交互。

- **Pull Request 详情页移除冗余的纯聊天按钮，让 Agent 审查会自动填好草稿。** 点击「让 Agent 审查」会将审阅提示词直接带入输入框并聚焦在末尾，修复了此前因工作目录初始化竞态导致草稿丢失的问题。

- **设置页左下角的「引导」按钮恢复文字标签。** 火箭图标旁恢复显示「引导」文案，不再是不明语义的孤立小图标。

- **统一全局加载动画。** 状态行、任务清单与流水线统一采用六段匀速旋转的虚线环（StatusSpinner）；按钮与交互动作采用带浅色底轨的亮弧（ActionSpinner），不再忽转忽闪。

<!-- lyra:notes zh-TW -->

### 新功能

- **一般設定新增「執行期間不讓電腦休眠」開關。** 開啟後 Lyra 執行期間不息屏、不因閒置進入睡眠，長任務跑整夜也不會中斷。闔蓋操作仍依系統電源策略正常休眠。

### 修復

- **規範全應用按鈕形態與層級。** 「新增服務商」「新增模型」等建立操作採用清晰的圖文加框按鈕；工具列按鈕、行內開關等純圖示動作保持無邊框微互動。

- **Pull Request 詳細資料頁移除多餘的純聊天按鈕，讓 Agent 審查會自動填入草稿。** 點選「讓 Agent 審查」會將審核提示詞直接帶入輸入框並聚焦於末尾，修復了此前因工作目錄初始化競態導致草稿遺失的問題。

- **設定頁左下角的「引導」按鈕恢復文字標籤。** 火箭圖示旁恢復顯示「引導」文案，不再是不明語意的孤立小圖示。

- **統一全域載入動畫。** 狀態列、任務清單與管線統一採用六段等分勻速旋轉的虛線環（StatusSpinner）；按鈕與操作互動採用帶淡色底軌的亮弧（ActionSpinner）。

<!-- lyra:notes ja -->

### 新機能

- **一般設定に「実行中にコンピュータをスリープさせない」設定を追加。** 有効にすると、長時間のタスク中でも画面オフやアイドルによるスリープを防ぎます。ノートPCの蓋を閉じた場合は、システム電源設定に従ってスリープします。

### 修正

- **各種ボタンのスタイルと階層を統一。** 「プロバイダーを追加」「モデルを追加」などの新規作成アクションはアイコン＋テキスト＋枠線で見やすく整理。ツールバーや行内トグルなどのアイコン単体ボタンは枠線のないすっきりしたスタイルに統一しました。

- **Pull Request 詳細の重複したチャットボタンを削除し、Agent によるレビュー依頼の下書き自動入力を改善。** 「Agent にレビューを依頼」をクリックするとレビュー用のプロンプトが入力欄に自動設定され、ワークスペース切り替えで消える不具合を修正しました。

- **設定画面左下の「ガイド」ボタンにテキスト表記を復元。** ロケットアイコンの横に「ガイド」ラベルが並び、分かりやすくなりました。

- **読み込みアニメーションの統一。** リストやタスク進行中の状態表示は等分割の点線リング（StatusSpinner）に、ボタン等の操作待機はうっすらとした軌道付きのアーク（ActionSpinner）に整理しました。

<!-- lyra:notes ko -->

### 새로운 기능

- **일반 설정에 '실행 중 컴퓨터 절전 모드 방지' 옵션 추가.** 켜 두면 긴 작업 도중 화면이 꺼지거나 유휴 상태로 잠들지 않습니다. 노트북 덮개를 닫는 동작은 시스템 전원 설정에 따라 정상 절전됩니다.

### 수정

- **전체 버튼 형태 및 시각적 위계 표준화.** '제공자 추가', '모델 추가' 등 생성 버튼은 아이콘+텍스트와 테두리로 명확하게 표시하고, 툴바 및 행 토글 등 단독 아이콘 버튼은 테두리 없이 깔끔하게 통일했습니다.

- **Pull Request 상세 보기에서 불필요한 채팅 버튼을 제거하고 Agent 검토 초안 자동 입력을 수정.** 'Agent에게 검토 요청' 클릭 시 검토 프롬프트가 입력창에 바로 채워지고, 작업 영역 전환으로 내용이 사라지던 문제를 해결했습니다.

- **설정 화면 하단 로켓 버튼에 '안내' 텍스트 복원.** 아이콘만 있던 버튼에 텍스트를 함께 배치하여 역할을 명확히 했습니다.

- **로딩 인디케이터 표준화.** 작업 목록 및 상태 표시는 일정한 점선 원(StatusSpinner)으로, 버튼 조작 대기는 궤도가 있는 부드러운 호(ActionSpinner)로 정돈했습니다.

<!-- lyra:notes fr -->

### Nouveautés

- **Nouvelle option « Empêcher la mise en veille pendant l'exécution » dans les paramètres généraux.** Lyra évite l'extinction de l'écran et la mise en veille pendant les longues tâches. Fermer le capot de l'ordinateur portable continue de mettre en veille conformément aux réglages système.

### Corrections

- **Harmonisation des styles de boutons.** Les actions de création comme « Ajouter un fournisseur » ou « Ajouter un modèle » affichent clairement icône, texte et bordure. Les barres d'outils et commutateurs d'icônes seuls adoptent un style épuré sans bordure.

- **Suppression du bouton de discussion redondant dans les détails de PR et remplissage automatique de la demande de revue.** Cliquer sur « Demander une revue par l'Agent » insère le prompt d'analyse directement dans la zone de saisie sans perte lors du changement d'espace.

- **Le bouton « Guide » en bas des paramètres retrouve son libellé textuel.** L'icône de fusée est à nouveau accompagnée du texte « Guide ».

- **Uniformisation des animations de chargement.** Anneau en pointillés régulier (StatusSpinner) pour les éléments en cours, arc sur rail discret (ActionSpinner) pour les retours d'actions sur boutons.

<!-- lyra:notes ru -->

### Новое

- **Новый переключатель «Не давать компьютеру уснуть во время работы» в основных настройках.** Lyra предотвращает отключение экрана и переход в спящий режим из-за бездействия во время выполнения длительных задач. Закрытие крышки ноутбука по-прежнему переводит устройство в сон в соответствии с системными политиками питания.

### Исправления

- **Стандартизация стилей кнопок.** Основные действия создания («Добавить провайдера», «Добавить модель») оформлены понятными кнопками с иконкой, текстом и рамкой. Кнопки панелей инструментов и переключатели внутри строк выполнены в лаконичном стиле без рамок.

- **Удалена лишняя кнопка чата в деталях Pull Request, исправлено заполнение черновика запроса на ревью.** Нажатие «Попросить Agent провести ревью» сразу помещает готовый запрос в поле ввода без сброса из-за инициализации рабочей папки.

- **Кнопка «Руководство» внизу панели настроек снова отображает поясняющий текст.** Рядом с иконкой ракеты возвращена надпись «Руководство».

- **Унификация индикаторов загрузки.** Пунктирное вращающееся кольцо (StatusSpinner) для фоновых процессов и задач, и мягкая дуга с фоновой дорожкой (ActionSpinner) для нажатых кнопок.

## [0.9.13](https://github.com/kittors/Lyra/releases/tag/v0.9.13) - 2026-09-14

<!-- lyra:notes en -->

### New

- **Side chat and the sub-agent box now put a file or image in the sentence, the same way the main box does.** A chip with an icon and a name sits in the text. The model can tell which file you mean. You can attach a picture when you steer a sub-agent.

- **When a row of tabs runs out of room, arrows appear at the ends.** File tabs, terminal tabs, account tabs, and the same kind of strip elsewhere. Click an arrow and the row moves, keeping a bit of what you just saw.

### Fixes

- **A crash in the window used to leave a grey pane and three traffic lights.** It now says what threw, offers a reload, and keeps your conversations and settings. The main process is still running.

- **Closing the window on a Mac puts it away. It does not throw the session out.** The conversation you had open, how far you had scrolled, and the message you had typed come back as they were. On Windows and Linux this happens when the status bar icon is there; without it, close still quits, so the app does not hide with no way back.

- **Dragging a pane past the window edge follows your hand again.** The card is clipped by the window. It used to stop at the edge while the pointer kept going.

- **The move handle sits on the top edge of the pane, in the middle of the card.** It no longer lands on the Windows caption buttons when the pane is narrow.

- **A broken line in the transcript no longer blanks the whole conversation.** A message with no role used to throw `Cannot read properties of undefined (reading 'role')` and take the screen with it.

<!-- lyra:notes zh-CN -->

### 新功能

- **侧边聊天和子 Agent 的输入框，现在也会把文件或图片放进句子里，和主输入框一样。** 一枚带图标和名字的标记坐在正文里，模型分得清你说的是哪一份。给子 Agent 纠偏时，也可以附上一张图。

- **标签挤不下时，两端会出现箭头。** 文件标签、终端标签、账号标签，以及同样那种横条。点一下，横条走一段，刚看过的还留一点。

### 修复

- **窗口里崩了，从前只剩一片灰和三颗红绿灯。** 现在会写出是谁抛的、给一颗重新加载，会话和设置都还在。主进程没停。

- **在 Mac 上关窗口，是把窗口收起来，不是把会话扔掉。** 开着的对话、滚到哪、打到一半的字，回来还是那样。Windows 和 Linux 上，有状态栏图标才这样收；没有图标时关掉就是退出，免得藏起来找不到。

- **拖面板越过窗口边缘时，卡片又跟着指针走了。** 探出去的部分被窗口裁掉。从前卡片停在边上，手还在往外走。

- **移动的那一杠在面板顶边，对着卡片正中。** 窄面板上不再压到 Windows 标题栏那几个按钮。

- **转录里坏掉的一行，不会再把整场对话刷白。** 一条没有 role 的消息从前会抛 `Cannot read properties of undefined (reading 'role')`，整页跟着没了。

<!-- lyra:notes zh-TW -->

### 新功能

- **側邊聊天和子 Agent 的輸入框，現在也會把檔案或圖片放進句子裡，和主輸入框一樣。** 一枚帶圖示和名字的標記坐在正文裡，模型分得清你說的是哪一份。給子 Agent 糾偏時，也可以附上一張圖。

- **標籤擠不下時，兩端會出現箭頭。** 檔案標籤、終端標籤、帳號標籤，以及同樣那種橫條。點一下，橫條走一段，剛看過的還留一點。

### 修復

- **視窗裡崩了，從前只剩一片灰和三顆紅綠燈。** 現在會寫出是誰拋的、給一顆重新載入，工作階段和設定都還在。主行程沒停。

- **在 Mac 上關視窗，是把視窗收起來，不是把工作階段扔掉。** 開著的對話、捲到哪、打到一半的字，回來還是那樣。Windows 和 Linux 上，有狀態列圖示才這樣收；沒有圖示時關掉就是結束，免得藏起來找不到。

- **拖面板越過視窗邊緣時，卡片又跟著指標走了。** 探出去的部分被視窗裁掉。從前卡片停在邊上，手還在往外走。

- **移動的那一槓在面板頂邊，對著卡片正中。** 窄面板上不再壓到 Windows 標題列那幾個按鈕。

- **轉錄裡壞掉的一行，不會再把整場對話刷白。** 一條沒有 role 的訊息從前會拋 `Cannot read properties of undefined (reading 'role')`，整頁跟著沒了。

<!-- lyra:notes ja -->

### 新機能

- **サイドチャットとサブエージェントの入力欄も、本文の中にファイルや画像を置きます。メインと同じです。** アイコンと名前のチップが文の中に座ります。モデルはどれを指しているか分かります。サブエージェントに指示を出すときも、絵を付けられます。

- **タブが幅に収まらないと、両端に矢印が出ます。** ファイル、ターミナル、アカウント、同じ形の横列です。押すと列が動き、今見ていたものが少し残ります。

### 修正

- **画面が落ちると、灰色と信号機の三つだけが残っていました。** 今は何が投げたかを書き、再読み込みを出し、会話と設定は残します。メインプロセスは止まっていません。

- **Mac で窓を閉じると、しまいます。セッションは捨てません。** 開いていた会話、どこまで読んだか、打ちかけの文が、そのまま戻ります。Windows と Linux では、ステータスバーのアイコンがあるときだけそうします。アイコンが無いときに閉じると終了します。隠れても戻れない状態にはしません。

- **ペインを窓の外へドラッグすると、また手に付いていきます。** はみ出した分は窓で切れます。これまでは縁で止まり、ポインターだけが先へ行っていました。

- **移動のしるしはペインの上端、カードの真ん中です。** 狭いペインで Windows のタイトルボタンに重なりません。

- **壊れた一行で会話全体が白くなりません。** role の無いメッセージが `Cannot read properties of undefined (reading 'role')` を投げ、画面ごと消えていました。

<!-- lyra:notes ko -->

### 새로운 기능

- **사이드 챗과 하위 에이전트 입력칸도 이제 파일이나 이미지를 문장 안에 넣습니다. 메인과 같습니다.** 아이콘과 이름이 붙은 칩이 글 안에 앉습니다. 모델이 어느 파일인지 구분합니다. 하위 에이전트에게 길을 알려 줄 때도 그림을 붙일 수 있습니다.

- **탭이 자리에 안 들어가면 양끝에 화살표가 나옵니다.** 파일 탭, 터미널 탭, 계정 탭, 같은 모양의 가로줄입니다. 누르면 줄이 움직이고, 방금 본 것이 조금 남습니다.

### 수정

- **창이 무너지면 회색과 신호등 세 개만 남았습니다.** 지금은 무엇이 던졌는지 쓰고, 새로 고침을 주며, 대화와 설정은 그대로입니다. 메인 프로세스는 살아 있습니다.

- **Mac에서 창을 닫으면 치워 둡니다. 세션을 버리지 않습니다.** 열려 있던 대화, 어디까지 읽었는지, 쓰다 만 글이 그대로 돌아옵니다. Windows와 Linux에서는 상태 표시줄 아이콘이 있을 때만 이렇게 합니다. 아이콘이 없으면 닫는 것이 종료입니다. 숨겨 두고 못 찾게 하지 않습니다.

- **패널을 창 밖으로 끌면 다시 손을 따라갑니다.** 나간 부분은 창에 잘립니다. 이전에는 카드가 가장자리에서 멈추고 포인터만 나갔습니다.

- **옮기는 막대는 패널 맨 위, 카드 한가운데에 있습니다.** 좁은 패널에서 Windows 제목 단추 위에 앉지 않습니다.

- **깨진 한 줄 때문에 대화 전체가 하얘지지 않습니다.** role이 없는 메시지가 `Cannot read properties of undefined (reading 'role')`를 던지고 화면을 가져갔습니다.

<!-- lyra:notes fr -->

### Nouveautés

- **La discussion latérale et la boîte du sous-agent mettent maintenant un fichier ou une image dans la phrase, comme la boîte principale.** Une pastille avec une icône et un nom s'assoit dans le texte. Le modèle sait de quel fichier vous parlez. On peut joindre une image en guidant un sous-agent.

- **Quand une rangée d'onglets n'a plus de place, des flèches apparaissent aux bouts.** Onglets de fichiers, de terminal, de comptes, et la même bande ailleurs. Un clic avance la rangée et laisse un peu de ce qu'on venait de voir.

### Corrections

- **Un plantage dans la fenêtre ne laissait qu'un panneau gris et trois feux.** Elle dit maintenant ce qui a levé, propose de recharger, et garde les conversations et les réglages. Le processus principal tourne encore.

- **Fermer la fenêtre sur un Mac la range. Ça ne jette pas la session.** La conversation ouverte, jusqu'où on avait défilé, et le message tapé reviennent comme on les a laissés. Sous Windows et Linux, c'est ainsi quand l'icône de la barre d'état est là ; sans elle, fermer quitte encore, pour ne pas cacher une appli sans issue.

- **Glisser un volet hors de la fenêtre suit à nouveau la main.** La carte est coupée par la fenêtre. Elle s'arrêtait au bord pendant que le pointeur continuait.

- **La poignée de déplacement est sur le bord haut du volet, au milieu de la carte.** Elle ne tombe plus sur les boutons de titre Windows quand le volet est étroit.

- **Une ligne cassée dans la transcription n'efface plus toute la conversation.** Un message sans rôle levait `Cannot read properties of undefined (reading 'role')` et emportait l'écran.

<!-- lyra:notes ru -->

### Новое

- **Боковая беседа и поле субагента теперь кладут файл или картинку в предложение, как главное поле.** Метка с значком и именем сидит в тексте. Модель понимает, о каком файле речь. К указанию субагенту можно приложить картинку.

- **Когда ряду вкладок не хватает места, по краям появляются стрелки.** Вкладки файлов, терминала, аккаунтов и такая же полоса в других местах. Нажатие сдвигает ряд и оставляет чуть-чуть того, что только что было видно.

### Исправления

- **Падение в окне оставляло серую панель и три светофора.** Теперь написано, что выбросило, есть перезагрузка, беседы и настройки на месте. Главный процесс ещё работает.

- **Закрытие окна на Mac убирает его. Сессию не выбрасывает.** Открытая беседа, до куда долистали, и недописанное сообщение возвращаются как были. В Windows и Linux так только если есть значок в строке состояния; без него закрытие по-прежнему выход, чтобы приложение не спряталось без дороги назад.

- **Перетаскивание панели за край окна снова идёт за рукой.** Карточка обрезается окном. Раньше она вставала у края, а указатель шёл дальше.

- **Ручка переноса на верхнем крае панели, по центру карточки.** На узкой панели она больше не садится на кнопки заголовка Windows.

- **Сломанная строка в расшифровке больше не белит всю беседу.** Сообщение без role бросало `Cannot read properties of undefined (reading 'role')` и уносило экран.

## [0.9.12](https://github.com/kittors/Lyra/releases/tag/v0.9.12) - 2026-09-13

<!-- lyra:notes en -->

### New

- **The same release now has an Android APK and an iOS IPA.** `Lyra-<version>-android.apk` installs directly. `Lyra-<version>-ios-unsigned.ipa` is unsigned: sign it with Sideloadly, AltStore, or Xcode (a free Apple ID is enough), then install. The phone app is a shell. It talks to Lyra on your computer. Sessions, models, and keys stay there.

- **Linux arm64 is in the release.** Raspberry Pi, Ampere machines, and a Linux VM on a Mac can take `Lyra-<version>-arm64.AppImage` or `Lyra-<version>-arm64.deb`. Before this, the updater on those machines said "you're up to date" because it could not find a file for that architecture.

- **A file or image in the message is a chip: icon plus name, sitting in the sentence.** It is no longer a row above the text. Right-click opens the file or shows it in the folder. The caret cannot walk into the chip.

- **`read` can pull the words out of Word, Excel, PowerPoint, and PDF.** Drop one of those on a chat, or point the agent at the path, and it reads the text instead of treating the file as opaque.

- **Switching the interface language moves the words that stayed the same to their new place, instead of cutting.** The language list uses each language's own name. Every language in that list can be formatted; ones that cannot are not listed.

### Fixes

- **After you sent a message, the chips lost their background, and right-click opened an empty box.** The marks were still there. They just no longer looked or behaved like chips.

- **Typing Chinese collapsed a chip back into a string of brackets.** Composing a sentence around a file mark turned the mark into the raw token, and the file dropped out of the message.

- **The icon sat on top of the file name when punctuation squeezed the line, and the caret could still walk into the chip.** Those two were the same layout: the mark did not reserve a box the caret had to skip.

- **Several items on the attachment menu were grey because the path was never fetched.** Open and Reveal did nothing. They looked disabled. They were waiting on a path nobody asked for.

- **The fade at the top of the sidebar was usually missing.** It only painted on one scroll state, so most of the time the list ran straight into the header.

- **The usage chart jumped instead of moving.** The animation finished in a frame, so the page looked like it had no motion at all.

- **When the dock ran out of width, it covered the conversation.** The layout flattened into one full-width strip instead of keeping the chat as its own column.

- **Dragging a pane past the window edge made the card vanish.** The pointer left the window and the card followed it out.

- **Menu separators vanished in the dark theme.** Their contrast was computed against the page, not the menu.

- **Delete on an archived chat did nothing.** The confirm dialog left with the context menu, so the click never landed.

- **On Windows, a remote that asked for a login left the sync buttons stuck.** The panel waited until the command timed out, and sometimes left a credentials window behind. It now fails at once and says to set the credentials up in a terminal first.

<!-- lyra:notes zh-CN -->

### 新功能

- **同一个 release 里有安卓安装包和 iOS 安装包。** `Lyra-<版本>-android.apk` 直接装。`Lyra-<版本>-ios-unsigned.ipa` 没签名：用 Sideloadly、AltStore 或 Xcode 自己签一遍再装，免费 Apple ID 就够。手机端只是个壳，连的是你电脑上的 Lyra，会话、模型和密钥都在那边。

- **Linux arm64 进产物了。** 树莓派、Ampere 机器、Mac 上的 Linux 虚拟机可以下 `Lyra-<版本>-arm64.AppImage` 或 `Lyra-<版本>-arm64.deb`。以前这些机器上点更新，界面说的是「已是最新」，因为它找不到自己架构的文件。

- **消息里的文件或图片变成一枚标记：图标加名字，坐在句子里。** 不再单独占输入框上面那一排。右键可以打开文件，也可以指出它在文件夹里的位置。光标进不去这枚标记。

- **`read` 读得到 Word、Excel、PowerPoint 和 PDF 里的字。** 把这类文件丢进对话，或者让 agent 去读那条路径，它读的是正文，而不是把文件当成一块不认识的东西。

- **切换界面语言时，没变的词会走到新位置，而不是整页硬切。** 语言列表用的是每种语言自己的名字。列表里出现的每一种都能格式化；格不了的不会出现在列表里。

### 修复

- **发出去之后，那几枚标记的底没了，右键弹出来的是个空框。** 标记还在，只是不再长得像、也不再表现得像一枚芯片。

- **打中文的时候，句子里的标记塌回成一串方括号。** 在文件标记旁边组句，标记会变成原始记号，文件从这条消息里掉出去。

- **标点一挤，图标就压在文件名上，而且光标仍进得去标记里面。** 这两件是同一件事：标记没有给自己留出光标必须跳过的那一块。

- **附件菜单上那几行是灰的，因为路径一次都没取到。** 「打开」和「在文件夹中显示」点了没反应。看起来像禁用，其实是在等一条没人去取的路径。

- **侧边栏顶上那道虚化，大部分时候根本不存在。** 它只在一种滚动状态下会画，所以列表常常直接顶到标题上。

- **用量图那一下太快，看着就是没动画。** 动画在一帧里走完，页面像是硬切过去的。

- **面板放不下时盖住会话。** 布局被拍成一条全宽的带子，对话不再自己占一列。

- **拖面板时指针移出窗口，卡片跟着跑出去消失。** 指针离开窗口，卡片也跟着离开。

- **菜单分隔线在暗色下看不见。** 对比度是照着页面算的，不是照着菜单。

- **归档会话右键「删除」点了没反应。** 确认框被菜单一起带走，那一次点击落在空处。

- **Windows 上，远端要登录时，同步按钮会一直停住。** 面板等到命令超时，有时还会留下一个凭据窗口。现在立刻失败，并说明要先在终端里配好凭据。

<!-- lyra:notes zh-TW -->

### 新功能

- **同一個 release 裡有 Android 安裝包和 iOS 安裝包。** `Lyra-<版本>-android.apk` 直接裝。`Lyra-<版本>-ios-unsigned.ipa` 沒有簽名：用 Sideloadly、AltStore 或 Xcode 自己簽過再裝，免費 Apple ID 就夠。手機端只是個殼，連的是你電腦上的 Lyra，工作階段、模型和金鑰都在那邊。

- **Linux arm64 進產物了。** 樹莓派、Ampere 機器、Mac 上的 Linux 虛擬機可以下載 `Lyra-<版本>-arm64.AppImage` 或 `Lyra-<版本>-arm64.deb`。以前這些機器上點更新，介面說的是「已是最新」，因為它找不到自己架構的檔案。

- **訊息裡的檔案或圖片變成一枚標記：圖示加名字，坐在句子裡。** 不再單獨占輸入框上面那一排。右鍵可以開啟檔案，也可以指出它在資料夾裡的位置。游標進不去這枚標記。

- **`read` 讀得到 Word、Excel、PowerPoint 和 PDF 裡的字。** 把這類檔案丟進對話，或讓 agent 去讀那條路徑，它讀的是正文，而不是把檔案當成一塊不認識的東西。

- **切換介面語言時，沒變的詞會走到新位置，而不是整頁硬切。** 語言清單用的是每種語言自己的名字。清單裡出現的每一種都能格式化；格不了的不會出現在清單裡。

### 修復

- **送出去之後，那幾枚標記的底沒了，右鍵彈出來的是個空框。** 標記還在，只是不再長得像、也不再表現得像一枚晶片。

- **打中文的時候，句子裡的標記塌回成一串方括號。** 在檔案標記旁邊組句，標記會變成原始記號，檔案從這條訊息裡掉出去。

- **標點一擠，圖示就壓在檔案名上，而且游標仍進得去標記裡面。** 這兩件是同一件事：標記沒有替自己留出游標必須跳過的那一塊。

- **附件選單上那幾行是灰的，因為路徑一次都沒取到。** 「開啟」和「在檔案夾中顯示」點了沒反應。看起來像停用，其實是在等一條沒人去取的路徑。

- **側邊欄頂上那道虛化，大部分時候根本不存在。** 它只在一種捲動狀態下會畫，所以清單常常直接頂到標題上。

- **用量圖那一下太快，看起來就是沒有動畫。** 動畫在一幀裡走完，頁面像是硬切過去的。

- **面板放不下時蓋住工作階段。** 版面被拍成一條全寬的帶子，對話不再自己占一欄。

- **拖面板時指標移出視窗，卡片跟著跑出去消失。** 指標離開視窗，卡片也跟著離開。

- **選單分隔線在暗色下看不見。** 對比是照著頁面算的，不是照著選單。

- **封存工作階段右鍵「刪除」點了沒反應。** 確認框被選單一起帶走，那一次點擊落在空處。

- **Windows 上，遠端要登入時，同步按鈕會一直停住。** 面板等到命令逾時，有時還會留下一個憑證視窗。現在立刻失敗，並說明要先在終端機裡配好憑證。

<!-- lyra:notes ja -->

### 新機能

- **同じリリースにAndroidのAPKとiOSのIPAが入ります。** `Lyra-<バージョン>-android.apk` はそのままインストールできます。`Lyra-<バージョン>-ios-unsigned.ipa` は未署名です。Sideloadly、AltStore、またはXcodeで自分で署名してから入れてください。無料のApple IDで足ります。モバイルアプリは殻です。つながる先は手元のLyraで、セッション、モデル、鍵はそちらにあります。

- **Linuxのarm64用パッケージがリリースに入りました。** Raspberry Pi、Ampereのマシン、Mac上のLinux仮想マシンは `Lyra-<バージョン>-arm64.AppImage` か `Lyra-<バージョン>-arm64.deb` を使います。これまでは、そのアーキテクチャのファイルが無いので、更新を押しても「最新です」とだけ出ていました。

- **メッセージの中のファイルや画像は、アイコンと名前のチップとして文の中に座ります。** 入力欄の上の一段ではなくなりました。右クリックでファイルを開くか、フォルダーでの位置を示します。キャレットはこのチップの中に入れません。

- **`read`がWord、Excel、PowerPoint、PDFの文字を読めます。** 会話に載せても、パスを渡しても、中身のテキストを読みます。知らない塊としては扱いません。

- **表示言語を切り替えると、変わっていない語は新しい位置へ動きます。ページごと差し替わるのではありません。** 言語一覧は、それぞれの言語の自家の名前です。一覧に出る言語はどれも整形できます。整形できないものは一覧に出しません。

### 修正

- **送信したあと、チップの地がなくなり、右クリックは空の枠だけでした。** 印は残っていました。チップとしては見えず、チップとしては動きませんでした。

- **日本語や中国語を入力すると、文中のチップが角括弧の列に戻っていました。** ファイルの印のそばで変換すると、印が生のトークンになり、ファイルがメッセージから落ちます。

- **約物が詰まるとアイコンがファイル名に重なり、キャレットはチップの中に入れたままです。** どちらも同じレイアウトです。印が、キャレットが飛ばなければならない箱を確保していませんでした。

- **添付メニューの数行が灰色なのは、パスを一度も取っていなかったからです。** 「開く」も「フォルダーに表示」も無反応でした。無効に見えて、誰も取りに行かないパスを待っていました。

- **サイドバー上端のぼかしは、ほとんどの場合ありませんでした。** あるスクロール状態でしか描かれないので、一覧が見出しに突き当たっていました。

- **使用量のグラフが一瞬で切り替わり、動きが無いように見えました。** アニメーションが 1 フレームで終わっていました。

- **ドックの幅が足りなくなると、会話を覆いました。** レイアウトが全幅の一本になり、会話が自分の列を失いました。

- **ペインをドラッグしてポインターがウィンドウの外へ出ると、カードが消えていました。** ポインターが窓を離れ、カードもついて出ていました。

- **ダークテーマではメニューの区切り線が見えませんでした。** コントラストをメニューではなくページに対して計算していました。

- **アーカイブした会話の右クリック「削除」が無反応でした。** 確認ダイアログがメニューと一緒に消え、クリックが空に落ちていました。

- **Windows では、ログインを求めるリモートで同期ボタンが止まったままでした。** パネルはコマンドが時間切れになるまで待ち、資格情報の窓が残ることもありました。今はすぐ失敗し、先に端末で資格情報を用意するよう知らせます。

<!-- lyra:notes ko -->

### 새로운 기능

- **같은 릴리스에 Android APK와 iOS IPA가 들어갑니다.** `Lyra-<버전>-android.apk`는 바로 설치합니다. `Lyra-<버전>-ios-unsigned.ipa`는 서명되어 있지 않습니다. Sideloadly, AltStore 또는 Xcode로 직접 서명한 뒤 설치하세요. 무료 Apple ID면 됩니다. 휴대폰 앱은 껍데기입니다. 연결하는 대상은 컴퓨터의 Lyra이고, 세션·모델·키는 그쪽에 있습니다.

- **Linux arm64 패키지가 릴리스에 들어갑니다.** 라즈베리 파이, Ampere 기기, Mac의 Linux 가상 머신은 `Lyra-<버전>-arm64.AppImage` 또는 `Lyra-<버전>-arm64.deb`를 받으면 됩니다. 이전에는 그 아키텍처 파일이 없어서, 업데이트를 눌러도 "이미 최신"이라고만 나왔습니다.

- **메시지의 파일이나 이미지는 아이콘과 이름이 붙은 칩으로 문장 안에 앉습니다.** 입력칸 위 한 줄을 차지하지 않습니다. 오른쪽 클릭으로 파일을 열거나 폴더에서 위치를 보여 줍니다. 캐럿은 이 칩 안으로 들어가지 못합니다.

- **`read`가 Word, Excel, PowerPoint, PDF 안의 글을 읽습니다.** 대화에 올리든 경로를 넘기든, 알 수 없는 덩어리가 아니라 본문을 읽습니다.

- **인터페이스 언어를 바꾸면, 그대로인 단어는 새 위치로 움직입니다. 페이지를 통째로 갈아끼우지 않습니다.** 언어 목록은 각 언어 자신의 이름입니다. 목록에 있는 언어는 모두 서식을 맞출 수 있습니다. 맞출 수 없는 언어는 목록에 올리지 않습니다.

### 수정

- **보낸 뒤에 칩의 바탕이 사라지고, 오른쪽 클릭은 빈 상자만 열었습니다.** 표시는 남아 있었습니다. 칩처럼 보이지도, 칩처럼 동작하지도 않았습니다.

- **한글이나 중국어를 입력하면 문장 속 칩이 대괄호 나열로 무너졌습니다.** 파일 표시 옆에서 조합하면 표시가 원본 토큰이 되고, 파일이 메시지에서 빠집니다.

- **문장 부호가 줄을 밀어 넣으면 아이콘이 파일 이름 위에 겹치고, 캐럿은 여전히 칩 안으로 들어갔습니다.** 둘 다 같은 레이아웃입니다. 표시가 캐럿이 건너뛰어야 할 칸을 잡아 두지 않았습니다.

- **첨부 메뉴의 몇 줄이 회색인 이유는 경로를 한 번도 가져오지 않았기 때문입니다.** 열기와 폴더에서 보기가 반응이 없었습니다. 비활성처럼 보였지만, 아무도 가져오지 않은 경로를 기다리고 있었습니다.

- **사이드바 맨 위 흐림은 대부분 존재하지 않았습니다.** 한 가지 스크롤 상태에서만 그려져, 목록이 제목에 바로 붙었습니다.

- **사용량 그래프가 한순간에 바뀌어 애니메이션이 없는 것처럼 보였습니다.** 애니메이션이 한 프레임 만에 끝났습니다.

- **독 너비가 모자라면 대화를 덮었습니다.** 레이아웃이 가로 전체 한 줄이 되어, 대화가 자기 열을 잃었습니다.

- **패널을 끌다가 포인터가 창 밖으로 나가면 카드가 사라졌습니다.** 포인터가 창을 떠나고 카드도 따라 나갔습니다.

- **어두운 테마에서 메뉴 구분선이 보이지 않았습니다.** 대비를 메뉴가 아니라 페이지 기준으로 계산했습니다.

- **보관한 대화의 오른쪽 클릭 "삭제"가 반응이 없었습니다.** 확인 상자가 메뉴와 함께 사라져, 클릭이 빈곳에 떨어졌습니다.

- **Windows에서 로그인을 요구하는 원격을 만나면 동기화 버튼이 멈춘 채로 있었습니다.** 패널은 명령이 시간 초과될 때까지 기다렸고, 자격 증명 창이 남는 일도 있었습니다. 지금은 바로 실패하고, 터미널에서 먼저 자격 증명을 맞추라고 말합니다.

<!-- lyra:notes fr -->

### Nouveautés

- **La même version contient un APK Android et un IPA iOS.** `Lyra-<version>-android.apk` s'installe directement. `Lyra-<version>-ios-unsigned.ipa` n'est pas signé : signez-le avec Sideloadly, AltStore ou Xcode (un identifiant Apple gratuit suffit), puis installez-le. L'application téléphone n'est qu'une coquille. Elle parle à Lyra sur l'ordinateur. Les sessions, les modèles et les clés restent là-bas.

- **Linux arm64 est dans la version.** Un Raspberry Pi, une machine Ampere ou une machine virtuelle Linux sur un Mac prennent `Lyra-<version>-arm64.AppImage` ou `Lyra-<version>-arm64.deb`. Avant, sur ces machines, « Vérifier les mises à jour » répondait que tout était à jour, faute de fichier pour cette architecture.

- **Un fichier ou une image dans le message est une pastille : icône et nom, dans la phrase.** Ce n'est plus une rangée au-dessus du texte. Un clic droit ouvre le fichier ou le montre dans le dossier. Le curseur ne peut pas entrer dans la pastille.

- **`read` lit le texte d'un Word, d'un Excel, d'un PowerPoint et d'un PDF.** Déposez le fichier dans la conversation, ou donnez le chemin : l'agent lit le texte, il ne traite plus le fichier comme une brique opaque.

- **Changer la langue de l'interface déplace les mots inchangés vers leur nouvelle place, au lieu de tout recouper.** La liste des langues utilise le nom de chaque langue. Toutes les langues de cette liste peuvent être formatées ; celles qui ne le peuvent pas n'y figurent pas.

### Corrections

- **Après l'envoi, les pastilles perdaient leur fond, et le clic droit ouvrait un cadre vide.** Les marques étaient encore là. Elles n'avaient plus l'air ni le comportement d'une pastille.

- **Saisir du chinois (ou composer autour d'une marque) repliait la pastille en une suite de crochets.** La marque redevenait le jeton brut, et le fichier sortait du message.

- **Quand la ponctuation serrait la ligne, l'icône recouvrait le nom du fichier, et le curseur pouvait encore entrer dans la pastille.** Les deux viennent du même dessin : la marque ne se réservait pas la case que le curseur doit sauter.

- **Plusieurs lignes du menu des pièces jointes étaient grises parce que le chemin n'était jamais demandé.** Ouvrir et Afficher dans le dossier ne faisaient rien. Elles avaient l'air désactivées. Elles attendaient un chemin que personne n'allait chercher.

- **Le flou en haut de la barre latérale manquait presque toujours.** Il n'était peint que dans un état de défilement, donc la liste butait souvent contre le titre.

- **Le graphique d'utilisation sautait au lieu de bouger.** L'animation tenait en une image, la page avait l'air figée.

- **Quand le dock manquait de largeur, il recouvrait la conversation.** La mise en page devenait une bande pleine largeur, et la conversation perdait sa colonne.

- **Glisser un volet hors de la fenêtre faisait disparaître la carte.** Le pointeur quittait la fenêtre, la carte le suivait.

- **Les séparateurs de menu disparaissaient en thème sombre.** Leur contraste était calculé sur la page, pas sur le menu.

- **« Supprimer » sur une conversation archivée ne faisait rien.** La boîte de confirmation partait avec le menu, le clic tombait dans le vide.

- **Sous Windows, un distant qui demandait une connexion laissait les boutons de synchronisation bloqués.** Le panneau attendait la fin du délai, et une fenêtre d'identifiants restait parfois ouverte. Ça échoue tout de suite, et ça dit de configurer les identifiants dans un terminal d'abord.

<!-- lyra:notes ru -->

### Новое

- **В том же выпуске есть APK для Android и IPA для iOS.** `Lyra-<версия>-android.apk` ставится сразу. `Lyra-<версия>-ios-unsigned.ipa` не подписан: подпишите его в Sideloadly, AltStore или Xcode (бесплатного Apple ID достаточно) и затем установите. Телефонное приложение — оболочка. Оно говорит с Lyra на компьютере. Сессии, модели и ключи остаются там.

- **В выпуске есть сборка Linux arm64.** Raspberry Pi, машины Ampere и виртуальная машина Linux на Mac берут `Lyra-<версия>-arm64.AppImage` или `Lyra-<версия>-arm64.deb`. Раньше на этих машинах проверка обновлений отвечала «уже последняя», потому что файла своей архитектуры не было.

- **Файл или картинка в сообщении — это метка: значок и имя, внутри предложения.** Это больше не отдельный ряд над текстом. Правый щелчок открывает файл или показывает его в папке. Курсор в метку не заходит.

- **`read` читает текст из Word, Excel, PowerPoint и PDF.** Положите такой файл в беседу или укажите путь — агент читает текст, а не смотрит на файл как на незнакомый кусок.

- **Смена языка интерфейса переносит неизменившиеся слова на новое место, а не перерезает страницу.** В списке языков — собственное имя каждого языка. Любой язык из этого списка можно форматировать; те, которые нельзя, в список не попадают.

### Исправления

- **После отправки у меток пропадала подложка, а правое меню открывало пустую рамку.** Метки оставались. Они больше не выглядели и не вели себя как чипы.

- **Набор китайского складывал метку обратно в цепочку скобок.** Набор вокруг файловой метки превращал её в сырой токен, и файл выпадал из сообщения.

- **Когда пунктуация сжимала строку, значок наезжал на имя файла, а курсор всё ещё заходил внутрь метки.** Это один и тот же макет: метка не оставляла себе ячейку, которую курсор обязан перескочить.

- **Несколько пунктов меню вложений были серыми, потому что путь ни разу не запрашивался.** «Открыть» и «Показать в папке» ничего не делали. Они выглядели выключенными. Они ждали путь, который никто не ходил брать.

- **Размытие у верхнего края боковой панели почти всегда отсутствовало.** Оно рисовалось только в одном состоянии прокрутки, поэтому список часто упирался прямо в заголовок.

- **График использования прыгал, а не двигался.** Анимация укладывалась в один кадр, страница казалась без движения.

- **Когда док не умещался по ширине, он закрывал беседу.** Вёрстка сплющивалась в одну полосу на всю ширину, и беседа теряла свою колонку.

- **Если при перетаскивании панели указатель уходил за окно, карточка пропадала.** Указатель покидал окно, карточка уходила за ним.

- **Разделители меню пропадали в тёмном оформлении.** Контраст считался относительно страницы, а не меню.

- **«Удалить» у архивной беседы не срабатывало.** Окно подтверждения уходило вместе с меню, щелчок попадал в пустоту.

- **В Windows удалённый репозиторий, который просил вход, оставлял кнопки синхронизации застывшими.** Панель ждала, пока команда истечёт по времени, и иногда оставалось окно учётных данных. Теперь это сразу ошибка, и сказано сначала настроить учётные данные в терминале.

## [0.9.11](https://github.com/kittors/Lyra/releases/tag/v0.9.11) - 2026-09-12

<!-- lyra:notes zh-CN -->

### 修复

- **子智能体提交结果后不再空转。** 子智能体调用 `yield` 交付之后，会话循环仍会向模型追加一轮请求。这轮请求没有接收方：答案就是刚才交付的那个对象，模型此时无话可说，返回的空回答被判定为上游故障并进入重试。在「一直重试」设置下，同一个请求可以重复发送数百次，而已经生成好的结果始终送不到调用方。现在交付即结束，空回答另有自己的重试上限（4 次）；断线与服务端错误的重试策略不变。

- **子智能体重连时，界面会说明它在等什么。** 此前重连过程在界面上没有任何提示，唯一的迹象是一个持续转动的任务。现在面板与状态条会显示重试次数和失败原因，重试不计入工具调用次数。按下停止时，子智能体已经产出的内容也会保留在面板上。

- **运行时的 token 统计与速度计入子智能体。** 运行指示器此前只统计主智能体自身的消耗：派发四个子智能体后，显示的数值与实际相差一个数量级；主智能体等待期间，速度读数会停在极低的水平。会话列表与用量统计页此前已正确统计，不受影响。同时移除了三处重复显示的「本次编排合计」。

- **默认主题改为跟随系统。** 主进程在读不到设置时按系统外观绘制启动屏，而默认值将未选择过主题的用户一律视为深色。两者不一致，在浅色系统上表现为启动瞬间的闪烁。已在设置中选择过主题的用户不受影响。

- **五个工具恢复可用。** recall、rule、learn、lsp、web_search 此前在桌面端从未提供给模型。

- **「禁止命令联网」开关现在真正生效。** 此前这个设置可以配置，但没有传递到命令执行的一层。

- **删除工作树不会再误删普通目录。** 当传入的路径不是 git 工作树时，`git worktree remove` 失败后的兜底逻辑会递归删除该目录。现在只删除 git 自身列出的工作树，相关接口补充了项目路径校验。

- **修复两处流式响应处理。** Anthropic 链路会把中断的流当作完整回答；两条 OpenAI 链路在上游停止响应时会无限等待。

- **上下文压缩的三项参数在桌面端恢复传递。**

<!-- lyra:notes zh-TW -->

### 修復

- **子智慧體提交結果後不再空轉。** 子智慧體呼叫 `yield` 交付之後，工作階段迴圈仍會向模型追加一輪請求。這輪請求沒有接收方：答案就是剛才交付的那個物件，模型此時無話可說，回傳的空回答被判定為上游故障並進入重試。在「一直重試」設定下，同一個請求可以重複傳送數百次，而已經產生好的結果始終送不到呼叫方。現在交付即結束，空回答另有自己的重試上限（4 次）；斷線與伺服器錯誤的重試策略不變。

- **子智慧體重新連線時，介面會說明它在等什麼。** 此前重新連線的過程在介面上沒有任何提示，唯一的跡象是一個持續轉動的任務。現在面板與狀態列會顯示重試次數和失敗原因，重試不計入工具呼叫次數。按下停止時，子智慧體已經產出的內容也會保留在面板上。

- **執行時的 token 統計與速度計入子智慧體。** 執行指示器此前只統計主智慧體自身的消耗：派發四個子智慧體後，顯示的數值與實際相差一個數量級；主智慧體等待期間，速度讀數會停在極低的水準。工作階段清單與用量統計頁此前已正確統計，不受影響。同時移除了三處重複顯示的「本次編排合計」。

- **預設佈景主題改為跟隨系統。** 主行程在讀不到設定時按系統外觀繪製啟動畫面，而預設值將未選擇過佈景主題的使用者一律視為深色。兩者不一致，在淺色系統上表現為啟動瞬間的閃爍。已在設定中選擇過佈景主題的使用者不受影響。

- **五個工具恢復可用。** recall、rule、learn、lsp、web_search 此前在桌面端從未提供給模型。

- **「禁止命令連網」開關現在真正生效。** 此前這個設定可以設定，但沒有傳遞到命令執行的那一層。

- **刪除工作樹不會再誤刪一般目錄。** 當傳入的路徑不是 git 工作樹時，`git worktree remove` 失敗後的備援邏輯會遞迴刪除該目錄。現在只刪除 git 自身列出的工作樹，相關介面補上了專案路徑檢查。

- **修復兩處串流回應處理。** Anthropic 鏈路會把中斷的串流當作完整回答；兩條 OpenAI 鏈路在上游停止回應時會無限等待。

- **上下文壓縮的三項參數在桌面端恢復傳遞。**

<!-- lyra:notes en -->

### Fixes

- **A sub-agent no longer spins after delivering its result.** Once a sub-agent called `yield`, the session loop still sent one more request to the model. That request has no recipient — the answer is the object just delivered — so the model had nothing left to say, and the empty reply that came back was classified as an upstream failure and retried. Under the "retry indefinitely" setting the same request could go out hundreds of times while the finished result never reached the caller. Delivery now ends the run, and empty replies carry a retry ceiling of their own (four). Retry behaviour for dropped connections and server errors is unchanged.

- **While a sub-agent is reconnecting, the interface says what it is waiting for.** Reconnection used to be invisible; the only sign was a task that kept spinning. The pane and the status line now show the attempt count and the reason, and retries are not counted as tool calls. Stopping a sub-agent also keeps whatever it had already produced.

- **Token counts and speed during a run include sub-agents.** The running indicator counted only the main agent's own usage: with four sub-agents dispatched, the figure sat an order of magnitude below the real one, and the rate reading dropped to near zero while the main agent waited. The session list and the usage page already counted correctly and are unaffected. Three duplicate "orchestration total" readouts have been removed.

- **The default theme now follows the system.** With no setting present the main process paints the boot screen from the system appearance, while the default treated anyone who had never chosen a theme as dark. On a light system the mismatch showed as a flash at startup. Anyone who has chosen a theme is unaffected.

- **Five tools are available again.** recall, rule, learn, lsp and web_search were never offered to the model on desktop.

- **The "no network for commands" switch now takes effect.** The setting could be configured but was not passed down to the layer where commands run.

- **Removing a worktree no longer deletes an ordinary directory.** When the path given was not a git worktree, the fallback after `git worktree remove` failed deleted that directory recursively. Only worktrees git itself lists are removed now, and the related endpoints check that the path is inside a project.

- **Two stream-handling fixes.** The Anthropic path treated a truncated stream as a complete reply; the two OpenAI paths waited indefinitely when the upstream stopped responding.

- **Three context-compaction parameters are passed through again on desktop.**

<!-- lyra:notes ja -->

### 修正

- **サブエージェントが結果を提出したあとに空回りしなくなりました。** サブエージェントが `yield` で結果を提出したあとも、セッションループはモデルへのリクエストをもう一度送っていました。このリクエストには受け取り手がありません。答えは提出済みのオブジェクトそのものであり、モデルには言うことが残っていないため、返ってくる空の応答が上流の障害と判定されて再試行に入ります。「無制限に再試行」の設定では同じリクエストが数百回送られ、その間、完成済みの結果は呼び出し元に届きませんでした。提出をもって実行を終了するようにし、空の応答には独自の再試行上限（4 回）を設けました。接続断とサーバーエラーの再試行方針は変わりません。

- **サブエージェントの再接続中、何を待っているかが画面に表示されます。** これまで再接続は画面上に何の手がかりもなく、回り続けるタスクだけが唯一の兆候でした。パネルとステータス行に再試行の回数と理由が出るようになり、再試行はツール呼び出し回数に数えません。停止した場合も、そのサブエージェントがすでに出力した内容はパネルに残ります。

- **実行中のトークン数と速度にサブエージェント分を含めるようにしました。** 実行インジケーターはメインエージェント自身の消費しか数えていませんでした。サブエージェントを四つ動かすと表示値は実際より一桁小さく、メインエージェントの待機中は速度表示がほぼ止まった値のままでした。セッション一覧と使用量ページはすでに正しく集計しており、影響はありません。あわせて、重複していた三か所の「オーケストレーション合計」表示を削除しました。

- **既定のテーマをシステム連動に変更しました。** 設定が無い場合、メインプロセスはシステムの外観に合わせて起動画面を描画しますが、既定値はテーマを選んだことのない利用者をすべてダークとして扱っていました。ライト設定のシステムでは、この食い違いが起動時のちらつきとして現れます。設定でテーマを選んだことのある利用者に影響はありません。

- **五つのツールが再び利用できます。** recall、rule、learn、lsp、web_search はデスクトップ版でモデルに提示されていませんでした。

- **「コマンドのネットワークを禁止」スイッチが実際に効くようになりました。** 設定はできるものの、コマンドを実行する層まで渡っていませんでした。

- **ワークツリーの削除で通常のディレクトリを消してしまうことがなくなりました。** 渡されたパスが git のワークツリーでない場合、`git worktree remove` の失敗後のフォールバックがそのディレクトリを再帰的に削除していました。現在は git 自身が列挙したワークツリーだけを削除し、関連するエンドポイントでもパスがプロジェクト内にあるかを確認します。

- **ストリーム処理の修正を二件。** Anthropic 系統は途中で切れたストリームを完全な応答として扱っていました。OpenAI 系統の二つは、上流が応答を止めた場合に無限に待ち続けていました。

- **コンテキスト圧縮の三つのパラメータがデスクトップ版で再び渡されるようになりました。**

<!-- lyra:notes ko -->

### 수정

- **서브 에이전트가 결과를 제출한 뒤 공회전하지 않습니다.** 서브 에이전트가 `yield`로 결과를 제출한 뒤에도 세션 루프는 모델에 요청을 한 번 더 보냈습니다. 이 요청에는 받는 쪽이 없습니다. 답은 방금 제출한 객체 자체이므로 모델은 더 할 말이 없고, 돌아오는 빈 응답이 업스트림 장애로 분류되어 재시도에 들어갑니다. "무제한 재시도" 설정에서는 같은 요청이 수백 번 나가는 동안 이미 완성된 결과가 호출한 쪽에 전달되지 못했습니다. 이제 제출과 함께 실행이 끝나며, 빈 응답에는 별도의 재시도 상한(4회)을 두었습니다. 연결 끊김과 서버 오류의 재시도 정책은 그대로입니다.

- **서브 에이전트가 재연결 중일 때 무엇을 기다리는지 화면에 표시됩니다.** 그동안 재연결은 화면에 아무런 단서가 없었고, 계속 돌아가는 작업 표시만이 유일한 흔적이었습니다. 이제 패널과 상태 줄에 재시도 횟수와 실패 이유가 표시되며, 재시도는 도구 호출 횟수에 포함되지 않습니다. 중지한 경우에도 서브 에이전트가 이미 만들어 둔 내용은 패널에 남습니다.

- **실행 중 토큰 집계와 속도에 서브 에이전트가 포함됩니다.** 실행 표시기는 메인 에이전트 자신의 사용량만 집계했습니다. 서브 에이전트를 넷 띄우면 표시되는 값이 실제보다 한 자릿수 작았고, 메인 에이전트가 기다리는 동안 속도 표시는 거의 0에 머물렀습니다. 세션 목록과 사용량 페이지는 이미 올바르게 집계하고 있어 영향이 없습니다. 아울러 중복으로 표시되던 세 곳의 "오케스트레이션 합계"를 제거했습니다.

- **기본 테마를 시스템 설정에 따르도록 변경했습니다.** 설정이 없을 때 메인 프로세스는 시스템 외관에 맞춰 시작 화면을 그리지만, 기본값은 테마를 고른 적이 없는 사용자를 모두 다크로 취급했습니다. 라이트 시스템에서는 이 불일치가 시작 시 깜빡임으로 나타납니다. 설정에서 테마를 고른 적이 있는 사용자는 영향을 받지 않습니다.

- **다섯 개 도구를 다시 사용할 수 있습니다.** recall, rule, learn, lsp, web_search는 데스크톱에서 모델에 제공된 적이 없었습니다.

- **"명령의 네트워크 차단" 스위치가 실제로 동작합니다.** 설정은 가능했지만 명령이 실행되는 계층까지 전달되지 않았습니다.

- **워크트리 삭제가 일반 디렉터리를 지우지 않습니다.** 전달된 경로가 git 워크트리가 아닐 때, `git worktree remove` 실패 후의 대체 처리가 그 디렉터리를 재귀적으로 삭제했습니다. 이제 git이 직접 나열한 워크트리만 삭제하며, 관련 엔드포인트에서도 경로가 프로젝트 안에 있는지 확인합니다.

- **스트림 처리 수정 두 건.** Anthropic 경로는 중간에 끊긴 스트림을 완전한 응답으로 취급했습니다. OpenAI 두 경로는 업스트림이 응답을 멈추면 무한히 기다렸습니다.

- **컨텍스트 압축의 세 가지 매개변수가 데스크톱에서 다시 전달됩니다.**

<!-- lyra:notes fr -->

### Corrections

- **Un sous-agent ne tourne plus à vide après avoir livré son résultat.** Une fois `yield` appelé, la boucle de session envoyait encore une requête au modèle. Cette requête n'a pas de destinataire : la réponse est l'objet qui vient d'être livré, le modèle n'a donc plus rien à dire, et la réponse vide qui revenait était classée comme panne amont puis réessayée. Avec le réglage « réessayer indéfiniment », la même requête pouvait partir des centaines de fois sans que le résultat déjà produit n'atteigne jamais l'appelant. La livraison met désormais fin à l'exécution, et les réponses vides ont leur propre plafond de réessais (quatre). La politique de réessai pour les coupures de connexion et les erreurs serveur est inchangée.

- **Pendant la reconnexion d'un sous-agent, l'interface indique ce qui est attendu.** La reconnexion n'apparaissait nulle part ; seul un indicateur de tâche qui continuait de tourner la trahissait. Le panneau et la ligne d'état affichent maintenant le nombre de tentatives et la raison de l'échec, et les réessais ne comptent pas comme des appels d'outil. À l'arrêt, ce que le sous-agent avait déjà produit reste affiché.

- **Le comptage des jetons et la vitesse en cours d'exécution incluent les sous-agents.** L'indicateur ne comptait que la consommation de l'agent principal : avec quatre sous-agents lancés, la valeur affichée était inférieure d'un ordre de grandeur, et la vitesse restait proche de zéro pendant que l'agent principal attendait. La liste des sessions et la page d'utilisation comptaient déjà correctement et ne sont pas concernées. Trois affichages redondants du « total d'orchestration » ont été retirés.

- **Le thème par défaut suit désormais le système.** Sans réglage enregistré, le processus principal dessine l'écran de démarrage d'après l'apparence du système, alors que la valeur par défaut considérait comme sombre tout utilisateur n'ayant jamais choisi de thème. Sur un système clair, cet écart se voyait comme un clignotement au démarrage. Les utilisateurs ayant choisi un thème ne sont pas concernés.

- **Cinq outils sont de nouveau disponibles.** recall, rule, learn, lsp et web_search n'avaient jamais été proposés au modèle sur le bureau.

- **L'option « interdire le réseau aux commandes » prend maintenant effet.** Le réglage était configurable mais n'était pas transmis à la couche qui exécute les commandes.

- **La suppression d'un worktree n'efface plus un répertoire ordinaire.** Lorsque le chemin fourni n'était pas un worktree git, le repli après l'échec de `git worktree remove` supprimait ce répertoire de façon récursive. Seuls les worktrees que git lui-même répertorie sont désormais supprimés, et les points d'entrée concernés vérifient que le chemin se trouve dans un projet.

- **Deux corrections sur le traitement des flux.** La voie Anthropic traitait un flux interrompu comme une réponse complète ; les deux voies OpenAI attendaient indéfiniment lorsque l'amont cessait de répondre.

- **Trois paramètres de compression du contexte sont de nouveau transmis sur le bureau.**

<!-- lyra:notes ru -->

### Исправления

- **Субагент больше не работает вхолостую после выдачи результата.** После вызова `yield` цикл сессии всё равно отправлял модели ещё один запрос. У этого запроса нет получателя: ответом является только что переданный объект, модели больше нечего сказать, а приходивший пустой ответ классифицировался как сбой вышестоящего сервиса и уходил в повтор. При настройке «повторять бесконечно» один и тот же запрос мог уйти сотни раз, а готовый результат так и не доходил до вызывающей стороны. Теперь выдача завершает выполнение, а у пустых ответов есть собственный предел повторов (четыре). Политика повторов при обрыве связи и ошибках сервера не изменилась.

- **Во время переподключения субагента интерфейс сообщает, чего он ждёт.** Раньше переподключение никак не отображалось — единственным признаком была бесконечно вращающаяся задача. Теперь панель и строка состояния показывают номер попытки и причину сбоя, а повторы не учитываются как вызовы инструментов. При остановке всё, что субагент уже успел выдать, остаётся в панели.

- **Подсчёт токенов и скорость во время работы учитывают субагентов.** Индикатор считал только расход самого основного агента: при четырёх запущенных субагентах показываемое значение было на порядок меньше реального, а показатель скорости держался у нуля, пока основной агент ждал. Список сессий и страница статистики считали правильно и не затронуты. Также убраны три дублирующих показа «итога оркестровки».

- **Тема по умолчанию теперь следует за системой.** Без сохранённой настройки основной процесс рисует экран запуска по системному оформлению, тогда как значение по умолчанию считало тёмной тему для всех, кто её ни разу не выбирал. В светлой системе это расхождение выглядело как мерцание при запуске. Тех, кто выбрал тему в настройках, изменение не затрагивает.

- **Пять инструментов снова доступны.** recall, rule, learn, lsp и web_search никогда не передавались модели в настольной версии.

- **Переключатель «запретить командам доступ к сети» теперь действительно работает.** Настройку можно было задать, но она не доходила до слоя, где выполняются команды.

- **Удаление рабочего дерева больше не стирает обычный каталог.** Если переданный путь не был рабочим деревом git, запасная ветка после неудачи `git worktree remove` удаляла этот каталог рекурсивно. Теперь удаляются только рабочие деревья, перечисленные самим git, а соответствующие точки входа проверяют, что путь находится внутри проекта.

- **Два исправления в обработке потоков.** В ветке Anthropic оборванный поток считался полным ответом; две ветки OpenAI бесконечно ждали, если вышестоящий сервис переставал отвечать.

- **Три параметра сжатия контекста снова передаются в настольной версии.**

## [0.9.10](https://github.com/kittors/Lyra/releases/tag/v0.9.10) - 2026-09-11

<!-- lyra:notes zh-CN -->

### 新功能

- **方向键往回翻自己说过的话**。输入框里按 ↑ 翻出上一句，再按往更早翻，↓ 往回走；翻过最近那条，就回到原来那句还没打完的草稿——草稿必须回得来，否则「想看看上次是怎么说的」这个念头，代价是丢掉手里正写着的半句话。框里最上沿标一行「历史 1/4」，翻到哪儿一眼看得见。

  当初那条附了图或文件的，图和文件也跟着回来。翻回来的是整条消息，而不是那条消息里的一句话——只给字的话，一句「这张图里有什么」翻出来就成了没有指代对象的问题。

  方向键在这个输入框里本来就有三个主人（@ 的名单、/ 的命令单、排队消息的挪动），所以历史排在最后一个，而且只在光标已经贴着头或尾的时候才接管：消息有好几行时，↑ 的本分仍然是把光标挪到上一行。

### 修复

- **一条读不出来的记录，不再让人失去整个窗口**。上一版修同一句崩溃（`Cannot read properties of undefined (reading 'role')`）时只堵了写入口，渲染端一行没动，所以承诺只兑现了一半：坏记录少了几条来路，可一旦真的出现，界面照样整个白掉——有人在 Windows 上长时间跑任务时又撞到了同一句。这一版补上另一半：读不出来的那一条就地换成一条画得出来的，**位置不动**。位置必须保住，因为压缩标记、命令记录、抖动行全是指进这个数组的下标，抽掉一条它们就整体错位一格，画出一份对不上的转录比崩更难发现。读会话那条路上也装了同一道闸——那里一抛出来，会话会**永远停在「正在加载对话…」**，一句报错都不给。
- **附件上那个取下的叉，改成鼠标移上去才出现，而且浮在缩略图的右上角上**，不再常驻在图里面。它盖着的正是人想看的那张图；一排缩略图配一排叉，最显眼的东西成了「删掉我」，而这排东西本来是拿来看的。

<!-- lyra:notes zh-TW -->

### 新功能

- **方向鍵往回翻自己說過的話**。輸入框裡按 ↑ 翻出上一句，再按往更早翻，↓ 往回走；翻過最近那條，就回到原來那句還沒打完的草稿——草稿必須回得來，否則「想看看上次是怎麼說的」這個念頭，代價是丟掉手裡正寫著的半句話。框裡最上沿標一行「歷史 1/4」，翻到哪兒一眼看得見。

  當初那條附了圖或檔案的，圖和檔案也跟著回來。翻回來的是整條訊息，而不是那條訊息裡的一句話——只給字的話，一句「這張圖裡有什麼」翻出來就成了沒有指涉對象的問題。

  方向鍵在這個輸入框裡本來就有三個主人（@ 的名單、/ 的命令單、排隊訊息的挪動），所以歷史排在最後一個，而且只在游標已經貼著頭或尾的時候才接管：訊息有好幾行時，↑ 的本分仍然是把游標挪到上一行。

### 修復

- **一條讀不出來的記錄，不再讓人失去整個視窗**。上一版修同一句崩潰（`Cannot read properties of undefined (reading 'role')`）時只堵了寫入口，繪製端一行沒動，所以承諾只兌現了一半：壞記錄少了幾條來路，可一旦真的出現，介面照樣整個白掉——有人在 Windows 上長時間跑任務時又撞到了同一句。這一版補上另一半：讀不出來的那一條就地換成一條畫得出來的，**位置不動**。位置必須保住，因為壓縮標記、命令記錄、抖動行全是指進這個陣列的索引，抽掉一條它們就整體錯位一格，畫出一份對不上的逐字稿比崩更難發現。讀工作階段那條路上也裝了同一道閘——那裡一拋出來，工作階段會**永遠停在「正在載入對話…」**，一句錯誤都不給。
- **附件上那個取下的叉，改成滑鼠移上去才出現，而且浮在縮圖的右上角上**，不再常駐在圖裡面。它蓋著的正是人想看的那張圖；一排縮圖配一排叉，最顯眼的東西成了「刪掉我」，而這排東西本來是拿來看的。

<!-- lyra:notes en -->

### New

- **The arrow keys go back through what you have said.** Press ↑ in the composer for your previous message, again for the one before that, ↓ to come back; past the most recent one you land on the half-written draft you started with. The draft has to come back — otherwise the thought "let me see how I put it last time" costs you the sentence you are in the middle of writing. A line along the top inside the field reads "History 1/4", so where you are is never a guess.

  If that message had an image or a file attached, those come back with it. What you get back is the whole message rather than one sentence out of it: with only the words, "what is in this picture" returns as a question with nothing to point at.

  The arrow keys already had three owners here — the @ list, the / command list, and reordering queued messages — so history goes last, and only takes over once the caret is already at the very start or the very end. In a message several lines long, ↑ still does its usual job of moving the caret up a line.

### Fixes

- **One unreadable record no longer costs you the whole window.** The previous fix for this crash (`Cannot read properties of undefined (reading 'role')`) only closed the ways in; nothing changed on the rendering side, so the promise was half kept. Fewer bad records got written, but one that did still took the interface down — someone running a long task on Windows hit the same error again. This version adds the other half: a record that cannot be read is replaced in place by one that can be drawn, **keeping its position**. The position has to hold, because compaction marks, command runs and hiccup rows are all indices into that array; drop one and every one of them shifts by a place, and a transcript that quietly disagrees with itself is harder to notice than a crash. The same gate now sits on the read path, where a throw used to leave the session stuck on "loading conversation…" forever, saying nothing at all.
- **The remove button on an attachment now appears when you hover it, and sits on the thumbnail's top corner** instead of inside the picture. It used to be pinned there permanently, covering the very image you were looking at; a row of thumbnails came with a row of crosses, which made "delete me" the most prominent thing about a strip you are meant to be looking at.

<!-- lyra:notes ja -->

### 新機能

- **方向キーで自分が書いた文をさかのぼれるようになりました。** 入力欄で ↑ を押すと一つ前の文が、もう一度押すとさらに前の文が戻ってきます。↓ は逆向きで、いちばん新しいものを通り越すと、書きかけだった下書きに戻ります。下書きが戻ってくることは必須です——そうでないと「前はどう書いたっけ」と思っただけで、いま書いている途中の一文を失うことになります。入力欄の内側いちばん上に「履歴 1/4」と出るので、どこまで戻ったかは見ればわかります。

  その文に画像やファイルが付いていた場合、それらも一緒に戻ります。戻ってくるのはメッセージ全体であって、その中の一文ではありません——文字だけでは、「この画像には何が写っていますか」が指す先のない問いになってしまいます。

  この入力欄では方向キーにすでに三つの持ち主がいます（@ の一覧、/ のコマンド一覧、順番待ちメッセージの入れ替え）。ですから履歴はいちばん後ろに並び、しかもカーソルが先頭か末尾に着いているときだけ引き受けます。数行あるメッセージでは、↑ は今までどおりカーソルを一行上へ動かします。

### 修正

- **読み取れない記録が一つあっても、ウィンドウ全体を失うことはなくなりました。** 同じクラッシュ（`Cannot read properties of undefined (reading 'role')`）を前回直したときは書き込み口を塞いだだけで、描画側には一行も手を入れていませんでした。約束は半分しか果たされておらず、壊れた記録の入口は減ったものの、いざ現れれば画面はやはり真っ白になります——Windows で長時間タスクを回していた方が、また同じ文言に行き当たりました。今回もう半分を補いました。読めない記録は、**位置をそのままに**、描ける一行へその場で置き換えます。位置を守る必要があるのは、圧縮の目印・コマンドの記録・回線の乱れの行が、すべてこの配列への添字だからです。一つ抜けばすべてが一つずつずれ、静かに食い違った記録はクラッシュより気づきにくくなります。同じ関門は読み込み側にも置きました。そちらで例外が出ると、その会話は**「会話を読み込んでいます…」のまま永久に止まり**、何も言ってくれませんでした。
- **添付ファイルの取り消しボタンは、カーソルを重ねたときだけ現れ、サムネイルの右上の角に載るようになりました。** 以前は画像の中に出しっぱなしで、まさに見たいその絵を覆っていました。サムネイルが並べば×も並び、本来は眺めるためのその一列で、いちばん目立つものが「消す」になっていました。

<!-- lyra:notes ko -->

### 새 기능

- **방향키로 자기가 썼던 말을 거슬러 올라갑니다.** 입력창에서 ↑를 누르면 바로 앞 메시지가, 한 번 더 누르면 그 앞의 것이 돌아옵니다. ↓는 반대 방향이고, 가장 최근 것을 지나치면 쓰다 만 초안으로 돌아옵니다. 초안은 반드시 돌아와야 합니다 — 그러지 않으면 "지난번엔 어떻게 썼더라" 하는 생각의 대가가 지금 쓰던 문장을 잃는 일이 됩니다. 입력창 안쪽 맨 위에 "기록 1/4"이라고 적혀 있어, 어디까지 왔는지는 보면 압니다.

  그 메시지에 이미지나 파일이 붙어 있었다면 그것들도 함께 돌아옵니다. 돌아오는 건 메시지 전체이지 그 안의 한 문장이 아닙니다 — 글자만 돌아오면 "이 사진에 뭐가 있나요"는 가리킬 대상이 없는 질문이 되어 버립니다.

  이 입력창에서 방향키에는 이미 주인이 셋 있습니다(@ 목록, / 명령 목록, 대기 중인 메시지 순서 바꾸기). 그래서 기록은 맨 뒤에 서고, 커서가 이미 맨 앞이나 맨 끝에 닿아 있을 때만 넘겨받습니다. 여러 줄짜리 메시지에서 ↑는 여전히 커서를 한 줄 위로 옮기는 제 일을 합니다.

### 수정

- **읽을 수 없는 기록 하나 때문에 창 전체를 잃지 않습니다.** 같은 오류(`Cannot read properties of undefined (reading 'role')`)를 지난번에 고칠 때는 쓰는 입구만 막았고 그리는 쪽은 한 줄도 손대지 않았습니다. 약속은 절반만 지켜진 셈이라, 망가진 기록이 들어올 길은 줄었지만 일단 생기면 화면은 여전히 통째로 하얘졌습니다 — Windows에서 오래 도는 작업을 하던 분이 같은 문장을 또 만났습니다. 이번에 나머지 절반을 채웠습니다. 읽히지 않는 기록은 **자리를 그대로 둔 채** 그릴 수 있는 한 줄로 그 자리에서 바뀝니다. 자리를 지켜야 하는 이유는 압축 표시, 명령 기록, 끊김 줄이 전부 그 배열의 색인이기 때문입니다. 하나를 빼면 전부 한 칸씩 밀리고, 조용히 어긋난 기록은 아예 죽는 것보다 알아채기 어렵습니다. 같은 관문을 읽는 쪽에도 두었습니다. 거기서 예외가 나면 그 대화는 **"대화를 불러오는 중…"에서 영영 멈춰** 아무 말도 하지 않았습니다.
- **첨부 파일의 제거 버튼이 마우스를 올렸을 때만 나타나고, 썸네일 오른쪽 위 모서리에 걸치도록 바뀌었습니다.** 전에는 그림 안에 늘 박혀 있어서 정작 보려던 그 그림을 가렸습니다. 썸네일이 늘어서면 ×도 함께 늘어서서, 보라고 만든 줄에서 가장 눈에 띄는 것이 "지우기"가 되어 있었습니다.

<!-- lyra:notes fr -->

### Nouveautés

- **Les flèches remontent ce que vous avez déjà écrit.** Dans la zone de saisie, ↑ rappelle votre message précédent, encore une fois celui d'avant, ↓ revient en arrière ; passé le plus récent, vous retombez sur le brouillon inachevé d'où vous étiez parti. Ce brouillon doit revenir : sans cela, l'envie de « voir comment je l'avais formulé » coûte la phrase que vous êtes en train d'écrire. Une ligne en haut, à l'intérieur du champ, indique « Historique 1/4 » : où vous en êtes ne se devine pas.

  Si ce message avait une image ou un fichier joint, ils reviennent avec lui. Ce qui revient est le message entier, pas une phrase qui en est extraite : avec les seuls mots, « qu'y a-t-il sur cette image » redevient une question qui ne désigne rien.

  Les flèches avaient déjà trois propriétaires ici — la liste du @, celle des commandes /, et le réordonnancement des messages en file. L'historique passe donc en dernier, et ne prend la main que lorsque le curseur est déjà tout au début ou tout à la fin. Dans un message de plusieurs lignes, ↑ fait toujours son travail habituel : monter d'une ligne.

### Corrections

- **Un enregistrement illisible ne coûte plus la fenêtre entière.** Le correctif précédent pour ce plantage (`Cannot read properties of undefined (reading 'role')`) n'avait fermé que les entrées ; rien n'avait bougé du côté de l'affichage, la promesse n'était donc tenue qu'à moitié. Les mauvais enregistrements se faisaient plus rares, mais l'un d'eux suffisait encore à faire tomber l'interface — quelqu'un l'a de nouveau rencontré sous Windows, sur une tâche longue. Cette version ajoute l'autre moitié : un enregistrement qu'on ne peut pas lire est remplacé sur place par un qui s'affiche, **en gardant sa position**. Elle doit tenir, car les marques de compression, les commandes et les lignes de coupure sont toutes des indices dans ce tableau ; en retirer un les décale tous d'un rang, et une transcription qui se contredit en silence se repère moins bien qu'un plantage. La même barrière est maintenant posée du côté de la lecture, où une exception laissait la conversation bloquée sur « chargement de la conversation… » indéfiniment, sans rien dire.
- **Le bouton de retrait d'une pièce jointe n'apparaît plus qu'au survol, et se pose sur le coin supérieur droit de la vignette** au lieu d'être dedans. Il y était affiché en permanence, masquant précisément l'image que vous regardiez ; une rangée de vignettes s'accompagnait d'une rangée de croix, et « supprimer » devenait l'élément le plus visible d'une bande faite pour être regardée.

<!-- lyra:notes ru -->

### Новое

- **Стрелки листают то, что вы уже писали.** В поле ввода ↑ возвращает предыдущее сообщение, ещё раз — то, что было до него, ↓ идёт обратно; за самым свежим вас ждёт недописанный черновик, с которого всё начиналось. Черновик обязан возвращаться: иначе мысль «а как я это сформулировал в прошлый раз» стоит вам той фразы, которую вы пишете сейчас. Строка вверху, внутри поля, показывает «История 1/4» — где вы находитесь, не приходится угадывать.

  Если к тому сообщению были приложены картинка или файл, они возвращаются вместе с ним. Возвращается сообщение целиком, а не одна фраза из него: с одними словами «что на этой картинке» снова становится вопросом, которому не на что указать.

  У стрелок в этом поле уже есть три хозяина — список по @, список команд по /, и перестановка сообщений в очереди. Поэтому история идёт последней и берёт управление только тогда, когда курсор уже стоит в самом начале или в самом конце. В сообщении из нескольких строк ↑ по-прежнему делает своё обычное дело — поднимает курсор на строку выше.

### Исправления

- **Одна нечитаемая запись больше не стоит вам целого окна.** Прошлое исправление той же ошибки (`Cannot read properties of undefined (reading 'role')`) закрыло только входы; со стороны отрисовки не изменилось ничего, и обещание оказалось выполнено наполовину. Испорченных записей стало меньше, но одной по-прежнему хватало, чтобы уронить интерфейс, — в Windows на долгой задаче человек снова наткнулся на ту же строку. Эта версия добавляет вторую половину: запись, которую не удаётся прочитать, заменяется на месте той, которую можно нарисовать, **с сохранением позиции**. Позиция должна устоять: отметки сжатия, записи команд и строки обрывов — всё это индексы в том же массиве, убери один элемент, и они сдвинутся на шаг, а расшифровка, которая тихо расходится сама с собой, заметна хуже, чем падение. Тот же заслон теперь стоит и на чтении, где исключение оставляло беседу **навсегда на «загрузка беседы…»** и ничего не сообщало.
- **Крестик для снятия вложения теперь появляется при наведении и садится на правый верхний угол миниатюры**, а не внутрь картинки. Раньше он висел там постоянно и закрывал ровно то изображение, на которое вы смотрели; за рядом миниатюр шёл ряд крестиков, и «удалить» оказывалось самым заметным в полосе, которую полагается разглядывать.

## [0.9.9](https://github.com/kittors/Lyra/releases/tag/v0.9.9) - 2026-09-11

<!-- lyra:notes zh-CN -->

### 新功能

- **PDF 里的字，现在读得出来**。从前拖一份 PDF 进输入框，得到的是一句「内容无法作为文本读取」——而那句话在能力上并不成立：Word、Excel、PPT 的解析一直都在仓库里，只是从来没有人调用它。现在这几种格式连同 PDF 一起，按页把正文抽出来交给模型，一份一百页的文档也答得了「部署那节写了什么」，并且说得出在第几页。整页是图的扫描件单独说一句「里面没有可提取的文字」，不和「格式不支持」合并：一个是换个格式再来，一个是这份文件里本来就没有字，需要的是 OCR。
- **中文 PDF 抽出来的字，模型认得出了**。PDF 里的字形按字体自己的编码表走。实测一份中文白皮书，抽出来的「白皮书」其实是康熙部首区的「⽩⽪书」——人眼完全看不出区别，对模型却是另外几个字符，于是问「白皮书里写了什么」，问题里的字和文档里的字对不上。
- **附件在输入框上方和气泡旁边，长成同一个样子**。从前同一份文件在两处画法不同，图片更是缩略图和文件名各出现一遍，一个是像素一个是紫色图标，看不出说的是同一个东西。图片和文档现在各自成组，不再混在一行里高矮不齐。编辑已经发出的消息，也不会再把那排附件抹掉——改的是措辞，附件本来就该留着。
- **回复里的文件链接旁边，多了两个出口**。点链接还是在内置面板里打开，读 .md、.ts 这类那是最快的办法。问题出在打不开的那些：点一个 .exe，正在看的东西被挤掉，换来一句「二进制文件，无法以文本显示」。现在鼠标停上去，旁边会显形「用默认程序打开」和「在文件管理器中显示」。
- **不同端点的脾气，各记各的**。哪个参数不吃、一轮里的工具调用怎么排、推理内容怎么还回去——三件事分成三条轴，撞上一次学一次，不再压进同一条梯子里互相干扰。

### 修复

- **Windows 上长时间跑任务，整个界面会崩掉**。报错是 `Cannot read properties of undefined (reading 'role')`。拿十二种畸形数据挨个试过，能产生这句话的形状只有一种：消息数组里有一个空位。它一旦出现，十八个渲染函数里有八到十四个当场崩。空位能进数组的每一条路都堵上了。
- **一轮长到需要压缩自己历史的时候，压缩分隔线会全部消失**，停下来重新打开又回来——而那正是这些标记最该画出来的时候。
- **子智能体的花销，一直没被算进用量**。用量扫描为了省下解析开销，在解析之前先按「是不是消息」筛了一道，而子智能体的消息不在那一类里，于是这一整类记录命中 0 条。
- **一轮跑了多久，报出来的数只有实际的两成**。从前是把每次请求在飞的时间加起来：一轮真实 13 分 02 秒，其中四次子代理和三次长命令占掉 10 分 48 秒，报出来是 2 分 14 秒。而运行中那一行读的一直是墙钟，所以回合一结束，数字当场从 13 分掉到 2 分。现在两处都按墙钟算，旁边的速度悬浮上去会说清楚分母是哪个口径。
- **过程行之间的空隙，从 4px 改到 6px**。行高 24px 配 4px 是 1:6，一行行贴下来像一堵字墙。
- **回合用时、速度，以及「用默认程序打开」这三处小字，跟着界面语言走了**。

<!-- lyra:notes zh-TW -->

### 新功能

- **PDF 裡的字，現在讀得出來**。從前拖一份 PDF 進輸入框，得到的是一句「內容無法作為文字讀取」——而那句話在能力上並不成立：Word、Excel、PPT 的解析一直都在，只是從來沒有人呼叫它。現在這幾種格式連同 PDF 一起，按頁把內文抽出來交給模型，一份一百頁的文件也答得了「部署那節寫了什麼」，而且說得出在第幾頁。整頁是圖的掃描件單獨說一句「裡面沒有可擷取的文字」，不和「格式不支援」合併：一個是換個格式再來，一個是這份檔案裡本來就沒有字，需要的是 OCR。
- **中文 PDF 抽出來的字，模型認得出了**。PDF 裡的字形按字型自己的編碼表走。實測一份中文白皮書，抽出來的「白皮书」其實是康熙部首區的「⽩⽪书」——肉眼完全看不出區別，對模型卻是另外幾個字元，於是問「白皮書裡寫了什麼」，問題裡的字和文件裡的字對不上。
- **附件在輸入框上方和泡泡旁邊，長成同一個樣子**。從前同一份檔案在兩處畫法不同，圖片更是縮圖和檔名各出現一遍，一個是像素一個是紫色圖示，看不出說的是同一個東西。圖片和文件現在各自成組，不再混在一行裡高矮不齊。編輯已經送出的訊息，也不會再把那排附件抹掉——改的是措辭，附件本來就該留著。
- **回覆裡的檔案連結旁邊，多了兩個出口**。點連結還是在內建面板裡開啟，讀 .md、.ts 這類那是最快的辦法。問題出在開不了的那些：點一個 .exe，正在看的東西被擠掉，換來一句「二進位檔案，無法以文字顯示」。現在滑鼠停上去，旁邊會顯形「用預設程式開啟」和「在檔案總管中顯示」。
- **不同端點的脾氣，各記各的**。哪個參數不吃、一輪裡的工具呼叫怎麼排、推理內容怎麼還回去——三件事分成三條軸，撞上一次學一次，不再壓進同一條梯子裡互相干擾。

### 修復

- **Windows 上長時間跑任務，整個介面會崩掉**。錯誤是 `Cannot read properties of undefined (reading 'role')`。拿十二種畸形資料逐個試過，能產生這句話的形狀只有一種：訊息陣列裡有一個空位。它一旦出現，十八個繪製函式裡有八到十四個當場崩。空位能進陣列的每一條路都堵上了。
- **一輪長到需要壓縮自己歷史的時候，壓縮分隔線會全部消失**，停下來重新打開又回來——而那正是這些標記最該畫出來的時候。
- **子智慧體的花費，一直沒被算進用量**。用量掃描為了省下解析開銷，在解析之前先按「是不是訊息」篩了一道，而子智慧體的訊息不在那一類裡，於是這一整類記錄命中 0 條。
- **一輪跑了多久，報出來的數只有實際的兩成**。從前是把每次請求在飛的時間加起來：一輪真實 13 分 02 秒，其中四次子代理和三次長命令佔掉 10 分 48 秒，報出來是 2 分 14 秒。而執行中那一行讀的一直是牆鐘，所以回合一結束，數字當場從 13 分掉到 2 分。現在兩處都按牆鐘算，旁邊的速度懸停上去會說清楚分母是哪個口徑。
- **過程行之間的空隙，從 4px 改到 6px**。行高 24px 配 4px 是 1:6，一行行貼下來像一堵字牆。
- **回合用時、速度，以及「用預設程式開啟」這三處小字，跟著介面語言走了**。

<!-- lyra:notes en -->

### New

- **Text inside a PDF is readable now.** Dropping a PDF into the composer used to come back with "cannot be read as text" — a sentence that was not true of what the app could do: the parsers for Word, Excel and PowerPoint had been sitting in the repository all along with nothing calling them. Those formats and PDF now have their text pulled out page by page and handed to the model, so a hundred-page document can answer "what does the deployment section say" and name the page it came from. A scan — a PDF that is a photograph of a page — is reported as having no text to extract, kept separate from "format not supported": one means try another format, the other means there is no text in this file at all and what it needs is OCR.
- **Chinese pulled out of a PDF is recognisable to the model.** Glyphs in a PDF follow the font's own encoding table. In a Chinese white paper, the first two characters of 白皮书 came back as their Kangxi radical forms, ⽩ and ⽪ — indistinguishable on screen, different characters to the model, so a question about that white paper matched nothing inside it.
- **An attachment looks the same above the composer as it does beside the bubble.** The same file used to be drawn two different ways, and an image appeared twice over — once as pixels, once as its filename — with nothing to say they were the same thing. Images and documents are now grouped separately instead of standing in one uneven row. Editing a message you already sent no longer wipes that row either: editing changes the wording, the attachments were always meant to stay.
- **File links in a reply have two exits beside them.** Clicking the link still opens the built-in panel, which is the fastest way to read a .md or a .ts. The trouble was the files it cannot open: clicking a .exe cost you whatever you were looking at and returned "binary file, cannot be displayed as text". "Open with the default app" and "Reveal in file manager" now appear on hover.
- **Each endpoint's quirks are learned separately.** Which parameter it refuses, how the tool calls in a turn must be ordered, how reasoning is handed back — three things on three axes now, each learned on its own rather than collapsed into one ladder where they interfered with each other.

### Fixes

- **A long-running task on Windows could take the whole interface down.** The error was `Cannot read properties of undefined (reading 'role')`. Twelve kinds of malformed data were tried one at a time; exactly one shape produces that sentence — a hole in the message array — and when one appears, eight to fourteen of the eighteen render functions fail on the spot. Every route by which a hole could reach the array is now closed.
- **Compaction markers vanished during any turn long enough to summarise its own history,** and came back once it stopped — which is exactly when those markers are worth drawing.
- **Sub-agent spend never counted towards usage.** To save on parsing, the usage scan filtered for "is this a message" before parsing anything, and a sub-agent's messages are not in that category: the entire class of records matched zero.
- **A turn's elapsed time was reported at about a fifth of the truth.** It used to add up the time each request spent in flight: a turn that really took 13m02s, with four sub-agents and three long commands accounting for 10m48s of it, was reported as 2m14s. The line shown while it ran had always used the wall clock, so the number dropped from 13 minutes to 2 the moment the turn ended. Both are the wall clock now, and hovering the speed beside it says which denominator it uses.
- **The gap between process rows goes from 4px to 6px.** A 24px row with a 4px gap is 1:6, and they stack into a wall of text.
- **Turn duration, speed, and "open with the default app" now follow the interface language.**

<!-- lyra:notes ja -->

### 新機能

- **PDF の中の文字が読めるようになりました。** これまで PDF を入力欄にドロップすると「テキストとして読み取れません」と返ってきましたが、それは実際にできることと合っていませんでした——Word、Excel、PowerPoint の解析はずっと入っていて、呼ぶ人がいなかっただけです。これらの形式と PDF は、ページごとに本文を取り出してモデルに渡すようになりました。100 ページの文書でも「デプロイの節には何が書いてあるか」に答えられ、何ページ目かも言えます。ページを撮影しただけのスキャン PDF は「取り出せる文字がありません」と別に伝えます。「対応していない形式」と一緒にはしません——前者は別の形式で試す話、後者はそのファイルに文字が入っておらず、必要なのは OCR だという話だからです。
- **中国語 PDF から取り出した文字を、モデルが同じ字として扱えるようになりました。** PDF の字形はフォント側の符号表に従います。ある中国語の白書から取り出した「白皮书」は、実際には康熙部首の「⽩⽪书」でした。画面上は見分けがつかず、モデルにとっては別の文字なので、その白書について尋ねても本文と一致しませんでした。
- **添付ファイルが、入力欄の上と吹き出しの横で同じ見た目になりました。** 同じファイルが二か所で違う描かれ方をしていて、画像に至ってはサムネイルとファイル名で二度出ていました。画像と文書はそれぞれまとまって並び、高さの違うものが一列に混ざることはなくなりました。送信済みのメッセージを編集しても、その並びが消えません——編集で変えるのは文言で、添付はそのまま残るべきものです。
- **返信の中のファイルリンクの隣に、出口が二つ増えました。** リンクを押せば今までどおり内蔵パネルで開きます。.md や .ts を読むにはそれが一番速いからです。困るのは開けないファイルのほうで、.exe を押すと見ていたものが押しのけられ、「バイナリファイルはテキストとして表示できません」だけが返ってきました。カーソルを合わせると「既定のアプリで開く」と「ファイルマネージャーで表示」が出ます。
- **エンドポイントごとの癖を、別々に覚えます。** 受け付けないパラメータ、1 ターン内のツール呼び出しの並べ方、推論内容の返し方——三つを三本の軸に分け、ぶつかるたびにその軸だけを学びます。一本の梯子に押し込んで互いに干渉させるのはやめました。

### 修正

- **Windows で長時間タスクを回すと、画面全体が落ちることがありました。** エラーは `Cannot read properties of undefined (reading 'role')`。12 種類の壊れたデータを一つずつ試したところ、この文言が出る形は一つだけ——メッセージ配列の中の空き——で、それが現れると 18 個ある描画関数のうち 8〜14 個がその場で落ちます。空きが配列に入り込む経路をすべて塞ぎました。
- **自分の履歴を要約するほど長いターンの間、圧縮の区切り線がすべて消えていました。** 止めて開き直すと戻ってきます——その区切りが一番必要なのは、まさにそういうターンです。
- **サブエージェントの費用が使用量に入っていませんでした。** 解析の手間を省くため、使用量の走査は解析の前に「メッセージかどうか」で絞っており、サブエージェントのメッセージはそこに入りません。その種別は 0 件のままでした。
- **1 ターンの所要時間が、実際の 2 割ほどで表示されていました。** 各リクエストが飛んでいた時間の合計だったためです。実際に 13 分 02 秒かかったターンで、サブエージェント 4 回と長いコマンド 3 回が 10 分 48 秒を占めていたものが、2 分 14 秒と出ていました。実行中の行はずっと実時間だったので、ターンが終わった瞬間に 13 分が 2 分へ落ちていました。どちらも実時間になり、隣の速度にカーソルを合わせるとどの分母かが分かります。
- **処理行どうしの間隔を 4px から 6px にしました。** 行の高さ 24px に対して 4px は 1:6 で、積み重なると文字の壁になります。
- **ターンの所要時間、速度、「既定のアプリで開く」の三か所が、画面の言語に従うようになりました。**

<!-- lyra:notes ko -->

### 새 기능

- **PDF 안의 글자를 읽어냅니다.** 지금까지는 PDF를 입력창에 끌어다 놓으면 "텍스트로 읽을 수 없습니다"라는 답이 돌아왔지만, 그건 실제로 할 수 있는 일과 맞지 않는 말이었습니다 — Word, Excel, PowerPoint를 읽는 코드는 줄곧 있었고 아무도 부르지 않았을 뿐입니다. 이제 이 형식들과 PDF는 쪽 단위로 본문을 뽑아 모델에게 넘깁니다. 100쪽짜리 문서에도 "배포 절에 뭐라고 쓰여 있나"를 물을 수 있고, 몇 쪽인지도 말해 줍니다. 페이지를 찍기만 한 스캔본은 "추출할 텍스트가 없습니다"라고 따로 알립니다. "지원하지 않는 형식"과 합치지 않았습니다 — 하나는 다른 형식으로 다시 해보라는 말이고, 다른 하나는 이 파일에 글자가 아예 없으니 OCR이 필요하다는 말입니다.
- **중국어 PDF에서 뽑은 글자를 모델이 같은 글자로 알아봅니다.** PDF의 글자 모양은 글꼴 쪽 부호표를 따릅니다. 어떤 중국어 백서에서 뽑은 "白皮书"는 실은 강희 부수 영역의 "⽩⽪书"였습니다. 화면에서는 구별되지 않지만 모델에게는 다른 문자라, 그 백서에 대해 물어도 본문과 맞지 않았습니다.
- **첨부 파일이 입력창 위와 말풍선 옆에서 같은 모습이 됩니다.** 같은 파일이 두 곳에서 다르게 그려졌고, 이미지는 썸네일과 파일 이름으로 두 번씩 나왔습니다. 이제 이미지와 문서가 각각 묶여 놓여, 높이가 다른 것들이 한 줄에 섞이지 않습니다. 이미 보낸 메시지를 고쳐도 그 줄이 사라지지 않습니다 — 고치는 건 문구이고, 첨부는 남아 있어야 하는 것입니다.
- **답변 속 파일 링크 옆에 출구가 두 개 생겼습니다.** 링크를 누르면 지금처럼 내장 패널에서 열립니다. .md나 .ts를 읽기에는 그게 가장 빠릅니다. 문제는 열 수 없는 파일이었습니다. .exe를 누르면 보고 있던 것이 밀려나고 "바이너리 파일은 텍스트로 표시할 수 없습니다"만 돌아왔습니다. 이제 마우스를 올리면 "기본 앱으로 열기"와 "파일 관리자에서 보기"가 나타납니다.
- **엔드포인트마다의 버릇을 따로 익힙니다.** 받지 않는 매개변수, 한 턴 안의 도구 호출 순서, 추론 내용을 돌려주는 방식 — 세 가지를 세 축으로 나눠, 부딪힐 때마다 그 축만 배웁니다. 한 사다리에 밀어 넣어 서로 간섭하게 두지 않습니다.

### 수정

- **Windows에서 오래 도는 작업 중에 화면 전체가 내려앉을 수 있었습니다.** 오류는 `Cannot read properties of undefined (reading 'role')`입니다. 망가진 데이터 열두 가지를 하나씩 넣어 본 결과, 이 문장이 나오는 모양은 하나뿐이었습니다 — 메시지 배열 안의 빈자리 — 그리고 그것이 나타나면 열여덟 개 렌더 함수 중 여덟에서 열넷이 그 자리에서 죽습니다. 빈자리가 배열에 들어갈 수 있는 경로를 모두 막았습니다.
- **자기 기록을 요약해야 할 만큼 긴 턴에서는 압축 구분선이 전부 사라졌습니다.** 멈추고 다시 열면 돌아왔습니다 — 그 표시가 가장 필요한 때가 바로 그런 턴입니다.
- **하위 에이전트의 비용이 사용량에 들어가지 않았습니다.** 파싱 비용을 아끼려고 사용량 훑기가 파싱 전에 "메시지인가"로 먼저 걸렀는데, 하위 에이전트의 메시지는 거기에 들지 않습니다. 그 종류의 기록은 0건이었습니다.
- **한 턴이 걸린 시간이 실제의 5분의 1쯤으로 나왔습니다.** 요청이 떠 있던 시간만 더했기 때문입니다. 실제로 13분 02초 걸린 턴에서 하위 에이전트 네 번과 긴 명령 세 번이 10분 48초를 차지했는데, 2분 14초로 나왔습니다. 실행 중에 보이는 줄은 줄곧 벽시계였으니, 턴이 끝나는 순간 13분이 2분으로 떨어졌습니다. 이제 둘 다 벽시계이고, 옆의 속도에 마우스를 올리면 어느 분모인지 알려줍니다.
- **처리 줄 사이 간격을 4px에서 6px로 넓혔습니다.** 줄 높이 24px에 4px는 1:6이라, 쌓이면 글자 벽처럼 보입니다.
- **턴 소요 시간, 속도, "기본 앱으로 열기" 세 군데가 화면 언어를 따릅니다.**

<!-- lyra:notes fr -->

### Nouveautés

- **Le texte d'un PDF se lit enfin.** Déposer un PDF dans la zone de saisie renvoyait « impossible de lire comme du texte » — une phrase qui ne correspondait pas à ce que l'application savait faire : les lecteurs Word, Excel et PowerPoint étaient là depuis toujours, personne ne les appelait. Ces formats et le PDF voient maintenant leur texte extrait page par page et transmis au modèle ; un document de cent pages peut répondre à « que dit la section déploiement » et citer la page. Un scan — un PDF qui n'est que la photo d'une page — est signalé comme n'ayant aucun texte à extraire, séparément de « format non pris en charge » : l'un veut dire essayez un autre format, l'autre qu'il n'y a aucun texte dans ce fichier et qu'il faudrait de l'OCR.
- **Le chinois extrait d'un PDF est reconnu par le modèle.** Les glyphes d'un PDF suivent la table d'encodage de la police : dans un livre blanc chinois, les deux premiers caractères de 白皮书 ressortaient sous leur forme de radicaux de Kangxi, ⽩ et ⽪. Rien ne les distingue à l'écran, ce sont des caractères différents pour le modèle, et une question sur ce livre blanc ne correspondait à rien dedans.
- **Une pièce jointe a la même allure au-dessus de la zone de saisie et à côté de la bulle.** Le même fichier était dessiné de deux façons, et une image apparaissait deux fois — en pixels, puis par son nom — sans rien pour indiquer qu'il s'agissait de la même chose. Images et documents sont désormais groupés séparément au lieu de former une rangée bancale. Modifier un message déjà envoyé n'efface plus cette rangée : on modifie la formulation, les pièces jointes devaient rester.
- **Les liens de fichiers dans une réponse ont deux sorties à côté d'eux.** Cliquer ouvre toujours le panneau intégré, la façon la plus rapide de lire un .md ou un .ts. L'ennui venait des fichiers qu'il ne sait pas ouvrir : cliquer sur un .exe coûtait ce que vous étiez en train de regarder et rendait « fichier binaire, affichage texte impossible ». « Ouvrir avec l'application par défaut » et « Afficher dans le gestionnaire de fichiers » apparaissent au survol.
- **Les manies de chaque point d'accès s'apprennent séparément.** Quel paramètre il refuse, dans quel ordre doivent venir les appels d'outils d'un tour, comment lui rendre le raisonnement — trois choses sur trois axes, chacune apprise de son côté au lieu d'être tassées dans une même échelle où elles se gênaient.

### Corrections

- **Une tâche longue sous Windows pouvait faire tomber toute l'interface.** L'erreur : `Cannot read properties of undefined (reading 'role')`. Douze formes de données malformées ont été essayées une à une ; une seule produit cette phrase — un trou dans le tableau des messages — et lorsqu'il apparaît, huit à quatorze des dix-huit fonctions de rendu tombent aussitôt. Tous les chemins par lesquels un trou pouvait y entrer sont fermés.
- **Les marqueurs de compression disparaissaient pendant tout tour assez long pour résumer son propre historique,** et revenaient à l'arrêt — alors que c'est précisément là qu'ils méritent d'être tracés.
- **La dépense des sous-agents n'entrait jamais dans l'usage.** Pour économiser de l'analyse, le balayage filtrait sur « est-ce un message » avant de rien analyser, et les messages d'un sous-agent n'en sont pas : cette catégorie entière ne remontait rien.
- **La durée d'un tour était annoncée à environ un cinquième de la réalité.** Elle additionnait le temps passé en vol par chaque requête : un tour de 13 min 02 s, dont 10 min 48 s pour quatre sous-agents et trois commandes longues, était annoncé à 2 min 14 s. La ligne affichée pendant l'exécution utilisait déjà l'horloge murale — le nombre passait donc de 13 minutes à 2 à la fin du tour. Les deux sont à l'horloge murale, et survoler la vitesse à côté indique son dénominateur.
- **L'espace entre les lignes de processus passe de 4 à 6 px.** Une ligne de 24 px avec 4 px d'écart, c'est du 1:6 : empilées, elles font un mur de texte.
- **Durée du tour, vitesse et « ouvrir avec l'application par défaut » suivent maintenant la langue de l'interface.**

<!-- lyra:notes ru -->

### Новое

- **Текст внутри PDF наконец читается.** Раньше на PDF, брошенный в поле ввода, приходило «не удаётся прочитать как текст» — а это расходилось с тем, что приложение умеет: разбор Word, Excel и PowerPoint лежал в репозитории давно, его просто никто не вызывал. Теперь эти форматы и PDF отдают текст постранично, и у документа на сто страниц можно спросить, что написано в разделе о развёртывании, — и получить ссылку на страницу. Скан, то есть PDF из фотографий страниц, отмечается отдельно: «внутри нет текста для извлечения». Это не то же самое, что «формат не поддерживается»: первое значит «попробуйте другой формат», второе — что текста в файле нет вовсе и нужен OCR.
- **Китайский текст из PDF модель узнаёт.** Начертания в PDF идут по таблице кодировки шрифта: в китайской белой книге первые два иероглифа из 白皮书 извлекались в форме ключей Канси — ⽩ и ⽪. На экране не отличить, для модели это другие символы — и вопрос про эту белую книгу не совпадал ни с чем внутри неё.
- **Вложение выглядит одинаково над полем ввода и рядом с сообщением.** Один и тот же файл рисовался двумя способами, а картинка появлялась дважды — пикселями и именем файла — и ничто не подсказывало, что это одно и то же. Картинки и документы теперь идут отдельными группами, а не одним неровным рядом. Правка уже отправленного сообщения больше не стирает этот ряд: правится формулировка, вложения должны остаться.
- **Рядом со ссылкой на файл в ответе появились два выхода.** По самой ссылке по-прежнему открывается встроенная панель — быстрее всего прочитать .md или .ts. Мешали файлы, которые она открыть не может: клик по .exe стоил того, что вы смотрели, и возвращал «двоичный файл, показать как текст нельзя». «Открыть в приложении по умолчанию» и «Показать в файловом менеджере» появляются при наведении.
- **Повадки каждой точки доступа запоминаются по отдельности.** Какой параметр она не принимает, в каком порядке должны идти вызовы инструментов за ход, как возвращать рассуждение — три вещи на трёх осях, каждая учится сама по себе, а не в одной лестнице, где они мешали друг другу.

### Исправления

- **Долгая задача в Windows могла уронить весь интерфейс.** Ошибка — `Cannot read properties of undefined (reading 'role')`. Перебрали двенадцать видов испорченных данных: эту фразу даёт ровно одна форма — дыра в массиве сообщений, — и когда она появляется, от восьми до четырнадцати из восемнадцати функций отрисовки падают сразу же. Все пути, которыми дыра могла попасть в массив, закрыты.
- **Отметки сжатия пропадали на всём протяжении хода, достаточно длинного, чтобы пересказать собственную историю,** и возвращались после остановки — хотя нужны они именно там.
- **Расходы субагентов не попадали в статистику.** Чтобы сэкономить на разборе, обход отсеивал записи по признаку «это сообщение?» ещё до разбора, а сообщения субагента к нему не относятся: весь этот класс записей давал ноль.
- **Длительность хода показывалась примерно впятеро меньше настоящей.** Складывалось время, которое каждый запрос провёл в полёте: ход, реально занявший 13 мин 02 с, из которых 10 мин 48 с ушли на четырёх субагентов и три долгие команды, показывался как 2 мин 14 с. Строка во время выполнения всегда шла по настенным часам, поэтому в момент завершения число падало с 13 минут до 2. Теперь оба значения по настенным часам, а наведение на скорость рядом поясняет, какой у неё знаменатель.
- **Промежуток между строками процесса — с 4 px до 6 px.** Строка высотой 24 px с зазором 4 px даёт 1:6, и сложенные подряд они читаются как стена текста.
- **Длительность хода, скорость и «открыть в приложении по умолчанию» теперь следуют языку интерфейса.**

## [0.9.8](https://github.com/kittors/Lyra/releases/tag/v0.9.8) - 2026-09-11

### 修复

- **desktop**: 新加的模型默认就支持思考、图片和工具 ([bb8355c](https://github.com/kittors/Lyra/commit/bb8355ce909f6f01c66f6a1110eac4470eb71459))
- **desktop**: 过程块到答案的距离不再随开合变化，思考行两头化开 ([c9cb888](https://github.com/kittors/Lyra/commit/c9cb888d8de19dc1590098f04c52d848594cb0e4))
- **desktop**: 换项目时终端跟着走，不再停在上一个项目里 ([957569a](https://github.com/kittors/Lyra/commit/957569a9be3507965c4381664bddae0df7e678f3))
- **core**: 三条协议链上那些让会话再也说不了话的形状 ([310f8aa](https://github.com/kittors/Lyra/commit/310f8aadf9f24fac619318672a1fb40a2b83f1cd))

## [0.9.7](https://github.com/kittors/Lyra/releases/tag/v0.9.7) - 2026-09-10

### 新功能

- **desktop**: 归档里的会话可以取消归档和删除 ([1d3cd06](https://github.com/kittors/Lyra/commit/1d3cd06fec035a3127c8ec38ea5365ac4d29df39))
- **desktop**: 附件不再把正文铺进气泡，而且带上先后顺序 ([9b014d4](https://github.com/kittors/Lyra/commit/9b014d4ef71cd1721a3e46f67e367e40a15073ed))

### 修复

- **desktop**: 提示条让开侧边栏，队列拖动落定不再回弹 ([b541f8c](https://github.com/kittors/Lyra/commit/b541f8c1b5d28a97cd5350fa0aed37a1f7423e2a))
- **desktop**: 撤掉三处会静默出错的改动 ([747bb9c](https://github.com/kittors/Lyra/commit/747bb9ca031c6bfd40bab20b367738d490142783))
- **desktop**: 拉取的模型按 200K 导入，弹窗遮罩盖住整扇窗 ([7b79f45](https://github.com/kittors/Lyra/commit/7b79f45389426f218a7379b997001a57ff921989))
- **core**: 编辑器不再把 unified diff 的减号写进源码 ([351c121](https://github.com/kittors/Lyra/commit/351c121f1ebc86d665659d8ca2a5a69c6884ac04))
- **core**: 换过模型的会话不再作废 ([e957c7f](https://github.com/kittors/Lyra/commit/e957c7fe6c71d80abc40e131030819130f78555f))

### 重构

- **desktop**: 归档正开着的对话，人回到新对话 ([a48b113](https://github.com/kittors/Lyra/commit/a48b113a344c500a134bdd858778e34241f8c34d))
- **desktop**: 一轮里的过程行统一成一套骨架 ([10bec22](https://github.com/kittors/Lyra/commit/10bec228ec50743d2932dcec5aa8fc1c0735b75b))

## [0.9.6](https://github.com/kittors/Lyra/releases/tag/v0.9.6) - 2026-09-09

<!-- lyra:notes zh-CN -->

### 修复

- **项目放在软链下时，文件操作全部失效，而且一声不吭**。macOS 上任何经过 `/tmp`、外接卷或同步目录的项目，在文件树里新建、重命名、删除、复制粘贴都不会发生任何事——没有报错，没有提示。原因是边界检查拿同一个目录的两种写法互相比对（`/var/…` 与 `/private/var/…`），判定「不在项目里」就拒绝了。同一个原因还让 markdown 里的图片一张都显示不出来，全部停在 alt 文本上。这一版把两侧都解开软链再比，顺带堵上了「项目里的软链指向项目外」这条路。
- **文件夹在磁盘上删掉之后，项目在 Lyra 里点不动也删不掉**。点它什么都不发生（现在会说清楚是哪个文件夹不在了），移除时会连子目录里开过的会话一起归档，归档失败也不再拖住移除。
- **交付卡片打不开本轮的实现与验证记录**。报告一直在生成、也一直有读取授权，只是入口在一次卡片重写里丢了，写在盘上没人能打开。
- **CI 那一列的长文字被截断成省略号**。工作流名、提交标题、分支和展开后的步骤名，现在边缘虚化代替省略号，鼠标停上去这行字自己走一遍。
- **抖动行说的是「重连」，做的却是重试**。设置里那一页叫「重试规则」，配置项叫 `retryAttempts`，两处对不上。七种语言一起改回。
- 标注工具栏出现「删除选中」变宽后会顶出屏幕；菜单滚动条压在行上；浏览器菜单的「检查元素」被误改成「页面检查」；模型目录的名字曾被安到另一个模型头上。

<!-- lyra:notes zh-TW -->

### 修復

- **專案放在符號連結下時，檔案操作全部失效，而且一聲不吭**。macOS 上任何經過 `/tmp`、外接磁碟或同步目錄的專案，在檔案樹裡新增、重新命名、刪除、複製貼上都不會發生任何事——沒有錯誤，沒有提示。原因是邊界檢查拿同一個目錄的兩種寫法互相比對（`/var/…` 與 `/private/var/…`），判定「不在專案裡」就拒絕了。同一個原因還讓 markdown 裡的圖片一張都顯示不出來。這一版把兩側都解開符號連結再比。
- **資料夾在磁碟上刪掉之後，專案在 Lyra 裡點不動也刪不掉**。點它什麼都不發生（現在會說清楚是哪個資料夾不在了），移除時會連子目錄裡開過的工作階段一起封存。
- **交付卡片打不開本輪的實作與驗證記錄**。報告一直在產生，只是入口在一次卡片重寫裡遺失了。
- **CI 那一欄的長文字被截斷成刪節號**。現在邊緣虛化取代刪節號，滑鼠停上去這行字自己走一遍。
- **抖動行說的是「重連」，做的卻是重試**。設定裡那一頁叫「重試規則」，兩處對不上。七種語言一起改回。
- 標註工具列出現「刪除選取」變寬後會頂出螢幕；選單捲軸壓在行上；瀏覽器選單的「檢查元素」被誤改成「頁面檢查」。

<!-- lyra:notes en -->

### Fixes

- **File operations silently did nothing when the project sat behind a symlink.** On macOS, any project reached through `/tmp`, an external volume or a synced folder could not create, rename, delete, cut or paste in the file tree — no error, no hint. The boundary check was comparing two spellings of the same directory (`/var/…` against `/private/var/…`) and reading that as "outside the project". The same cause left every image in a markdown file stuck on its alt text. Both sides are now resolved before they are compared, which also closes a symlink pointing out of a project as a way through.
- **A project whose folder was deleted from disk could neither be opened nor removed.** Clicking it did nothing at all; it now names the missing folder. Removing it archives the chats started in its subfolders too, and a failed archive no longer blocks the removal.
- **The delivery card had no way into the turn's own report.** It was being written every engineering turn, and read access was granted for it — the entrance was dropped in a rewrite.
- **Long lines in the CI column ended in an ellipsis.** Workflow names, commit titles, branches and expanded step names now fade at the edge instead, and read themselves out on hover.
- **The hiccup line said "reconnecting" while it was retrying.** Settings calls that page "retry rules" and the setting `retryAttempts`; the two disagreed. Corrected in all seven languages.
- The annotation toolbar overflowed the screen once "Delete selection" widened it; the menu scrollbar sat on top of rows; the browser menu's "Inspect element" had been renamed by mistake; a catalogue name was attached to the wrong model.

<!-- lyra:notes ja -->

### 修正

- **シンボリックリンク配下のプロジェクトで、ファイル操作が何も起きなくなっていました**。macOS で `/tmp`・外部ボリューム・同期フォルダー経由のプロジェクトでは、作成・名前変更・削除・切り取り・貼り付けのいずれも無反応で、エラーも表示もありませんでした。境界チェックが同じディレクトリの二つの表記（`/var/…` と `/private/var/…`）を突き合わせ、「プロジェクト外」と判定していたためです。同じ原因で markdown の画像もすべて alt テキストのままでした。今回から両側を解決してから比較します。
- **フォルダーをディスクから削除したあと、プロジェクトを開くことも消すこともできませんでした**。クリックしても無反応でしたが、どのフォルダーが無いのかを伝えるようになりました。削除時はサブフォルダーで始めた会話もまとめてアーカイブします。
- **配信カードからその回のレポートを開けませんでした**。レポート自体は毎回生成されていて、入口だけが書き直しの際に失われていました。
- **CI 列の長い行が省略記号で切れていました**。今は端がぼけ、ポインターを乗せると自分で流れます。
- **ゆらぎの行が「再接続」と言いながら、実際は再試行していました**。設定側は「再試行ルール」なので、七言語すべてで揃えました。
- 注釈ツールバーが「選択を削除」で広がると画面からはみ出す、メニューのスクロールバーが行に重なる、ブラウザーメニューの「要素を検証」が誤って改名されていた、カタログ名が別のモデルに付いていた、も直しました。

<!-- lyra:notes ko -->

### 고친 것

- **심볼릭 링크 아래에 있는 프로젝트에서 파일 작업이 아무 반응 없이 실패했습니다**. macOS에서 `/tmp`, 외장 볼륨, 동기화 폴더를 거친 프로젝트는 파일 트리에서 새로 만들기·이름 바꾸기·삭제·잘라내기·붙여넣기가 전부 동작하지 않았고, 오류도 안내도 없었습니다. 경계 검사가 같은 디렉터리의 두 표기(`/var/…`와 `/private/var/…`)를 맞대어 보고 "프로젝트 밖"이라고 판단했기 때문입니다. 같은 원인으로 markdown의 이미지도 전부 대체 텍스트에 멈춰 있었습니다. 이제 양쪽을 모두 풀어 비교합니다.
- **폴더를 디스크에서 지운 뒤 프로젝트를 열 수도, 지울 수도 없었습니다**. 눌러도 아무 일도 없었지만 이제 어느 폴더가 없는지 알려 줍니다. 제거할 때는 하위 폴더에서 시작한 대화도 함께 보관합니다.
- **전달 카드에서 그 회차의 보고서를 열 길이 없었습니다**. 보고서는 계속 생성되고 있었고, 입구만 재작성 과정에서 사라졌습니다.
- **CI 열의 긴 줄이 말줄임표로 잘렸습니다**. 이제 가장자리가 흐려지고, 포인터를 올리면 스스로 흘러갑니다.
- **끊김 줄이 "재연결"이라고 말하면서 실제로는 재시도하고 있었습니다**. 설정 쪽은 "재시도 규칙"이라 서로 어긋났고, 일곱 언어를 모두 맞췄습니다.
- 주석 도구 모음이 "선택 삭제"로 넓어지면 화면을 넘치던 문제, 메뉴 스크롤바가 줄 위에 겹치던 문제, 브라우저 메뉴의 "요소 검사"가 잘못 바뀌었던 문제도 함께 고쳤습니다.

<!-- lyra:notes fr -->

### Corrections

- **Les opérations sur les fichiers ne faisaient rien, en silence, quand le projet passait par un lien symbolique.** Sur macOS, tout projet atteint via `/tmp`, un volume externe ou un dossier synchronisé ne pouvait ni créer, ni renommer, ni supprimer, ni couper-coller dans l'arborescence — sans erreur ni indication. Le contrôle de limite comparait deux écritures du même dossier (`/var/…` et `/private/var/…`) et en concluait « hors du projet ». La même cause laissait toutes les images d'un fichier markdown sur leur texte alternatif. Les deux côtés sont maintenant résolus avant comparaison.
- **Un projet dont le dossier avait été supprimé du disque ne pouvait être ni ouvert ni retiré.** Un clic ne produisait rien ; il nomme désormais le dossier manquant. Le retrait archive aussi les conversations ouvertes dans ses sous-dossiers.
- **La carte de livraison n'offrait plus d'accès au rapport du tour.** Le rapport était toujours produit ; seule l'entrée avait disparu lors d'une réécriture.
- **Les lignes longues de la colonne CI se terminaient par des points de suspension.** Le bord s'estompe désormais, et la ligne se lit d'elle-même au survol.
- **La ligne d'incident disait « reconnexion » alors qu'elle réessayait.** Les réglages parlent de « règles de nouvelle tentative » ; corrigé dans les sept langues.
- La barre d'annotation débordait de l'écran une fois élargie par « Supprimer la sélection » ; la barre de défilement des menus recouvrait les lignes ; « Inspecter l'élément » avait été renommé par erreur.

<!-- lyra:notes ru -->

### Исправления

- **Операции с файлами молча переставали работать, если проект лежал за символьной ссылкой.** В macOS любой проект, доступный через `/tmp`, внешний том или синхронизируемую папку, не позволял создавать, переименовывать, удалять, вырезать и вставлять в дереве файлов — без ошибок и подсказок. Проверка границы сравнивала два написания одного каталога (`/var/…` и `/private/var/…`) и считала путь «вне проекта». По той же причине все изображения в markdown оставались на альтернативном тексте. Теперь обе стороны разрешаются до сравнения.
- **Проект, папка которого удалена с диска, нельзя было ни открыть, ни убрать.** Щелчок не давал ничего; теперь он называет отсутствующую папку. При удалении архивируются и чаты, начатые в подпапках.
- **Из карточки доставки нельзя было открыть отчёт этого хода.** Отчёт по-прежнему создавался — потерялся только вход, при переписывании карточки.
- **Длинные строки в колонке CI обрывались многоточием.** Теперь край растворяется, а строка сама прокручивается при наведении.
- **Строка о сбое говорила «переподключение», хотя выполнялся повтор запроса.** В настройках эта страница называется «правила повтора»; исправлено во всех семи языках.
- Панель аннотаций выходила за экран, когда её расширяла кнопка «Удалить выделенное»; полоса прокрутки меню ложилась поверх строк; «Проверить элемент» в меню браузера было переименовано по ошибке.

### 修复

- **desktop**: 软链下的项目，文件操作全被判在项目之外 ([4da82eb](https://github.com/kittors/Lyra/commit/4da82ebb070230d4ece84c7dbdd3130323d88aa8))
- **desktop**: 抖动行说的是重试，不是重连 ([8433e96](https://github.com/kittors/Lyra/commit/8433e96bae3f942c5b885f6843dd67bfd317a158))
- **desktop**: 符号链接下的项目，markdown 里的图一张都出不来 ([f2327db](https://github.com/kittors/Lyra/commit/f2327dbf5675bc29dda81b2ff6b0e60867df74bd))
- **desktop**: 探针补回 no-console 豁免 ([f297246](https://github.com/kittors/Lyra/commit/f297246d282b5593c2d5c0eba4cad1e8d1a943e6))
- **desktop**: 文件夹在磁盘上没了之后，项目仍然点得动、删得掉 ([cd26f8d](https://github.com/kittors/Lyra/commit/cd26f8d7f6ef3a200e5dd5bdebaa6c8efc33c46c))
- **desktop**: 交付卡片补回打开本轮报告的入口 ([c6807db](https://github.com/kittors/Lyra/commit/c6807db11296eb2a7c0e491a32865c8e9d93fd38))
- **desktop**: CI 那一列的单行截断改成虚化加悬停自读 ([3bfe203](https://github.com/kittors/Lyra/commit/3bfe20381939ab0d3c2673cf6a7e8c5f0c7457d7))
- **desktop**: 问题预览的两条断言，等的是没实现过的行为 ([85dd515](https://github.com/kittors/Lyra/commit/85dd5150e9aad8426cfa294a0b1bd4759be8f242))
- **desktop**: 菜单滚动条压在行上，浏览器菜单的「检查元素」被我改成了「页面检查」 ([2f3900d](https://github.com/kittors/Lyra/commit/2f3900ddb5bed4cc29ec09ef9fd11f7100611155))
- **desktop**: e2e 里三个文件抢同一个调试端口 ([70151fd](https://github.com/kittors/Lyra/commit/70151fdec94ba83e6abe6a2bc617c50bedb91f12))
- **desktop**: 项目移除不掉——它会照着自己的会话长回来 ([2c7de82](https://github.com/kittors/Lyra/commit/2c7de8282721c190843c36cdb77ea8e15dc9138c))
- **desktop**: 从抖动行点「继续」，那一轮的账就断了 ([75e27e0](https://github.com/kittors/Lyra/commit/75e27e0def9b24c9647705e59b7f155992aca3af))
- **core**: 目录的名字被安到了另一个模型头上 ([80327d0](https://github.com/kittors/Lyra/commit/80327d0602e0a16819e45a9f7fe6a5dce9296786))
- **desktop**: 标注工具栏一变宽就顶出屏幕 ([2a2e2a1](https://github.com/kittors/Lyra/commit/2a2e2a12fdafe6245083d6ce97901817e1bf90f7))

### 文档

- **desktop**: 把轨迹那条的待查范围收到两条分支 ([b7807d3](https://github.com/kittors/Lyra/commit/b7807d302f951fee0e09e629715779e8b8c3432e))
- **desktop**: 改掉一个下错的结论 ([02791a4](https://github.com/kittors/Lyra/commit/02791a41c245674b46374145d2e325c83f1ee297))

## [0.9.5](https://github.com/kittors/Lyra/releases/tag/v0.9.5) - 2026-09-09

<!-- lyra:notes zh-CN -->

### 新功能

- **界面语言，这次是整个界面**。把语言切成 English，以前只有设置页的导航跟着走，正文、菜单、提示、报错仍是中文——一页英文导航配一页中文说明。这一版清掉了 **2436 处**写死的文案，真窗口扫描：中文界面 769 处中文，切到英文 **0 处**没跟上。七种语言（简中、繁中、English、日本語、한국어、Français、Русский）覆盖同一份目录，少一条翻译是类型错误，编译过不去。
- **供应商配置可以带走**。导出成一个文件，在另一台机器上导入。文件里带着 API Key，所以它会先说清楚这件事再让你导出；读回来的时候逐字段校验，读不懂的整条丢掉并告诉你丢了几条——一个半成品的供应商混进去，会一路走到模型选择器和请求构造里。
- **回复里的宽表格能横向滚了**。单元格保持不折行，鼠标停上去才浮出横向滑块。原生滚动条全局关着，所以以前宽表格是在半个词处截断，看着像它本来就到那儿为止。
- **换时间区间时，用量页的数字一起走**。按下「30 天」，这一屏的所有读数都是同一批账重新算出来的，所以它们一起出发、一起停，而不是各走各的。

### 修复

- **副屏截图拿到的是主屏画面**。遮罩明明盖在副屏上，出来的图却是主屏的。Windows 上走 GDI 抓屏时系统根本不填屏幕标识，于是每一次副屏截图都落回第一块屏。这就是「不能跨屏幕截图」的真正原因。
- **标注过的截图颜色会偏，而且只偏彩色不偏灰**。截图拿到的是显示器帧缓冲里的原始数值——一台 Display P3 的机器上，屏幕上的纯红在那串数里是 234,51,35，按 sRGB 去读就偏了。裁剪、马赛克取样、放大镜这几张派生的画布现在跟主画布同一个色彩空间，中间不再做转换。
- **浏览器的页面画在了设置页上面**。打开设置时整个工作区会被藏起来，而浏览器那个 webview 是唯一无视它的元素——它自己声明了「可见」，而这个属性会从隐藏的祖先里重新冒出来。
- **子 Agent 跑长任务会撞上下文上限，而不是压一压接着跑**。派出去搜六十轮文件，正是最容易把上下文撑爆的活，而父会话的压缩够不到子会话。撑爆之后供应商直接拒了这次请求，从外面看就是「大活总是莫名其妙失败、小活好好的」。现在子会话也带上下文压缩；步数用完时那句话会说出数字，而不只是「步数用尽」。
- **两个供应商可以重名，于是谁也认不出谁**。「新供应商」每次按都是同一个名字，导入又是按内部编号认人的，于是列表里并排躺着两个一模一样的名字。而且损失会传下去：两个模型同名时，选择器本来是靠供应商名把它们分开的。
- **切了语言，有些字还留在原地**。字体名、插件图标、PR 分组、检查状态、同步计划、代码主题名——这些写在文件顶上的常量表，在程序加载的那一刻就把语言定死了，之后再怎么切都不动。走语法树查了一遍，一共十九处。反过来也修了一处：「继续」发出去的那三句话不该翻译，它们是发给模型的文本，也是历史记录靠什么被认出来——翻了它，用中文界面跑过的旧对话在英文下就认不出来，那一轮的耗时会只报最后一小段。
- **「系统」那张主题预览看着像深色**。面积是各半的，看着不是：浅色那半的宽度大多花在灰色侧栏上，而卡片横跨接缝、重心落在深色一侧。把它光栅化数过：改之前是 0% 亮 / 100% 暗，和「深色」那张的读数一模一样。
- **设置页几处对齐，以及导入后表单还显示着旧值**。派活积极性那五档的记号原本去够标题的基线，可每一档的说明长短不同，于是那一列高低参差；导入会用同一个编号把供应商整个换掉，而地址和 API Key 那两个框只在挂载时读一次初始值，于是文件里写的是一回事、表单上显示的是另一回事。

<!-- lyra:notes zh-TW -->

### 新功能

- **介面語言，這次是整個介面**。把語言切成 English，以前只有設定頁的導覽跟著走，正文、選單、提示、報錯仍是中文——一頁英文導覽配一頁中文說明。這一版清掉了 **2436 處**寫死的文案，真視窗掃描：中文介面 769 處中文，切到英文 **0 處**沒跟上。七種語言（簡中、繁中、English、日本語、한국어、Français、Русский）覆蓋同一份目錄，少一條翻譯是型別錯誤，編譯過不去。
- **供應商設定可以帶走**。匯出成一個檔案，在另一台機器上匯入。檔案裡帶著 API Key，所以它會先說清楚這件事再讓你匯出；讀回來的時候逐欄位校驗，讀不懂的整條丟掉並告訴你丟了幾條——一個半成品的供應商混進去，會一路走到模型選擇器和請求建構裡。
- **回覆裡的寬表格能橫向捲了**。儲存格保持不換行，滑鼠停上去才浮出橫向捲軸。原生捲軸全域關著，所以以前寬表格是在半個詞處截斷，看著像它本來就到那兒為止。
- **換時間區間時，用量頁的數字一起走**。按下「30 天」，這一屏的所有讀數都是同一批帳重新算出來的，所以它們一起出發、一起停，而不是各走各的。

### 修復

- **副螢幕截圖拿到的是主螢幕畫面**。遮罩明明蓋在副螢幕上，出來的圖卻是主螢幕的。Windows 上走 GDI 抓螢幕時系統根本不填螢幕識別，於是每一次副螢幕截圖都落回第一塊螢幕。這就是「不能跨螢幕截圖」的真正原因。
- **標註過的截圖顏色會偏，而且只偏彩色不偏灰**。截圖拿到的是顯示器影格緩衝裡的原始數值——一台 Display P3 的機器上，螢幕上的純紅在那串數裡是 234,51,35，按 sRGB 去讀就偏了。裁切、馬賽克取樣、放大鏡這幾張衍生的畫布現在跟主畫布同一個色彩空間，中間不再做轉換。
- **瀏覽器的頁面畫在了設定頁上面**。開啟設定時整個工作區會被藏起來，而瀏覽器那個 webview 是唯一無視它的元素——它自己宣告了「可見」，而這個屬性會從隱藏的祖先裡重新冒出來。
- **子 Agent 跑長任務會撞上下文上限，而不是壓一壓接著跑**。派出去搜六十輪檔案，正是最容易把上下文撐爆的活，而父工作階段的壓縮夠不到子工作階段。撐爆之後供應商直接拒了這次請求，從外面看就是「大活總是莫名其妙失敗、小活好好的」。現在子工作階段也帶上下文壓縮；步數用完時那句話會說出數字，而不只是「步數用盡」。
- **兩個供應商可以重名，於是誰也認不出誰**。「新供應商」每次按都是同一個名字，匯入又是按內部編號認人的，於是清單裡並排躺著兩個一模一樣的名字。而且損失會傳下去：兩個模型同名時，選擇器本來是靠供應商名把它們分開的。
- **切了語言，有些字還留在原地**。字型名、外掛圖示、PR 分組、檢查狀態、同步計畫、程式碼主題名——這些寫在檔案頂上的常數表，在程式載入的那一刻就把語言定死了，之後再怎麼切都不動。走語法樹查了一遍，一共十九處。反過來也修了一處：「繼續」發出去的那三句話不該翻譯，它們是發給模型的文字，也是歷史紀錄靠什麼被認出來——翻了它，用中文介面跑過的舊對話在英文下就認不出來，那一輪的耗時會只報最後一小段。
- **「系統」那張主題預覽看著像深色**。面積是各半的，看著不是：淺色那半的寬度大多花在灰色側欄上，而卡片橫跨接縫、重心落在深色一側。把它點陣化數過：改之前是 0% 亮 / 100% 暗，和「深色」那張的讀數一模一樣。
- **設定頁幾處對齊，以及匯入後表單還顯示著舊值**。派活積極性那五檔的記號原本去夠標題的基線，可每一檔的說明長短不同，於是那一列高低參差；匯入會用同一個編號把供應商整個換掉，而位址和 API Key 那兩個框只在掛載時讀一次初始值，於是檔案裡寫的是一回事、表單上顯示的是另一回事。

<!-- lyra:notes en -->

### Features

- **The interface language now moves the whole interface**. Switch to English and, until now, only the settings navigation followed: the prose, the menus, the tooltips and the errors stayed in Chinese — an English page of navigation wrapped around a Chinese page of explanation. This release cleared **2436 hardcoded strings**. Scanned in a real window: 769 pieces of Chinese text in the Chinese interface, **0 left behind** after switching to English. Seven languages (Simplified and Traditional Chinese, English, Japanese, Korean, French, Russian) share one catalogue, and a missing translation is a type error — it does not compile.
- **Provider settings can travel**. Export them to a file and import it on another machine. The file carries your API keys, so it says so before it lets you write one; on the way back in every field is checked rather than trusted, and anything unreadable is dropped whole with a count of what went — a half-formed provider that gets through reaches the model picker and the request builder alike.
- **Wide tables in a reply scroll sideways**. Cells stay on one line, and a horizontal scrollbar appears when you hover. Native scrollbars are off throughout the app, so until now a wide table simply stopped mid-word and looked as though that was where it ended.
- **Change the period and the usage figures travel together**. Press "30 days" and every reading on the screen is the same set of books recomputed, so they now set off and settle together instead of each going its own way.

### Fixes

- **A screenshot of the second display returned the first one**. The overlay sat on the second screen; the picture came from the primary. Capturing through GDI on Windows leaves the display identifier empty, so every secondary-screen capture fell back to the first source. That was the real cause of "screenshots don't work across displays".
- **Annotated screenshots shifted colour — and only the colours, not the greys**. A capture holds the raw values from the display's frame buffer: on a Display P3 machine, the pure red on screen is 234,51,35 in those numbers, and reading them as sRGB shifts them. The crop, the blur sampler and the loupe now share the main canvas's colour space, so nothing is converted on the way.
- **The browser painted over the settings page**. Opening settings puts the whole workspace away, and the browser's webview was the one element that ignored it: it declared itself visible, and that property re-emerges from a hidden ancestor by design.
- **A long-running sub-agent hit the context limit instead of compacting and carrying on**. Sixty turns of reading files is exactly the job most likely to overflow, and the parent's compaction cannot reach a delegated run. Once it overflowed the provider refused the request outright, which from outside looked like "the big jobs mysteriously fail and the small ones are fine". Delegated runs now compact too, and when the step budget runs out the message says the number rather than just "out of steps".
- **Two providers could share a name, and then neither could be told from the other**. "New provider" is the same name every time it is pressed, and an import matches on the internal id — so two identical names ended up side by side in the list. The damage carried: when two models share a name, the picker was relying on the provider's name to tell them apart.
- **Some words stayed put when the language changed**. Font names, plugin marks, pull-request groups, check states, the sync plan, code theme names — tables written at the top of a file, which fix the language at the moment the program loads and never move again. A pass over the syntax tree found nineteen of them. One went the other way: the three sentences "Continue" sends are *not* translated. They are the text handed to the model and the mark a saved transcript is recognised by — translate them and a conversation carried on in Chinese stops being recognised in English, and that turn reports only the length of its last leg.
- **The "System" theme preview looked like the dark one**. The halves are equal by area but not to the eye: the light half spends most of its width on a grey sidebar, while the card straddles the seam with its weight on the dark side. Rasterised and counted: it read 0% light / 100% dark — the same numbers as the "Dark" thumbnail.
- **Some alignment on the settings pages, and a form still showing the old values after an import**. The marks beside the five delegation levels reached for the title's baseline, but each level carries a description of a different length, so the column came out ragged. And an import replaces a provider under the same id, while the address and API key boxes read their initial value once, on mount — so the file said one thing and the form showed another.

<!-- lyra:notes ja -->

### 新機能

- **画面の言語が、画面まるごと動くようになりました**。English に切り替えても、これまでついてくるのは設定画面のナビゲーションだけで、本文もメニューもツールチップもエラーも中国語のまま——英語の枠に中国語の中身、という状態でした。今回、**2436 か所**の直書きを片づけました。実際のウィンドウで走査した結果、中国語表示では 769 か所に中国語、英語に切り替えたあとに残ったのは **0 か所**。7 言語（簡体字・繁体字中国語、英語、日本語、韓国語、フランス語、ロシア語）が同じ辞書を共有し、訳の欠けは型エラーとしてコンパイルを止めます。
- **プロバイダーの設定を持ち出せます**。ファイルに書き出して、別のマシンで読み込めます。ファイルには API キーが入るので、書き出す前にそのことを告げます。読み込むときは項目ごとに検証し、読めなかったものは丸ごと捨てて件数を返します——半端なプロバイダーが 1 件混じると、モデルの選択画面にもリクエストの組み立てにもそのまま届いてしまうからです。
- **返信のなかの横長の表が横スクロールするようになりました**。セルは折り返さず、ポインタを載せたときだけ横のつまみが浮かびます。ネイティブのスクロールバーは全体で切ってあるため、これまでは語の途中で切れて、そこで終わっているように見えていました。
- **期間を変えると、使用量の数字がそろって動きます**。「30 日」を押したとき画面に出るのはどれも同じ帳簿を計算し直したものなので、いっせいに動き出し、いっせいに止まります。

### 修正

- **サブディスプレイのスクリーンショットがメインの画面を返していました**。覆いはサブに掛かっているのに、出てくる絵はメインのもの。Windows で GDI 経由の取り込みではディスプレイの識別子が空になるため、サブ画面の取り込みが毎回 1 番目のソースに落ちていました。「複数ディスプレイでスクリーンショットが撮れない」の本当の原因です。
- **注釈をつけたスクリーンショットの色がずれ、しかも有彩色だけずれていました**。取り込んだ絵はディスプレイのフレームバッファの生の数値です。Display P3 のマシンでは、画面上の純粋な赤がその数値では 234,51,35 で、sRGB として読むとずれます。切り抜き・モザイクの標本・ルーペの各キャンバスが主キャンバスと同じ色空間になり、途中で変換されなくなりました。
- **ブラウザのページが設定画面の上に描かれていました**。設定を開くとワークスペース全体がしまわれますが、ブラウザの webview だけがそれを無視していました。自分で「見える」と宣言していて、この属性は隠れた先祖の内側からでも現れる仕様だからです。
- **長く走るサブエージェントが、文脈を畳まずに上限にぶつかっていました**。ファイルを 60 ターン読む仕事は、まさに文脈があふれやすい仕事です。しかも親の圧縮は委譲先には届きません。あふれた時点で提供元がリクエストごと拒むので、外からは「大きい仕事だけ理由もなく失敗する」ように見えていました。委譲した実行にも圧縮が入り、手数を使い切ったときの文言も「使い切りました」ではなく数字を言います。
- **プロバイダーが同じ名前を持てて、どちらがどちらか分からなくなっていました**。「新しい提供元」は押すたびに同じ名前で、読み込みは内部の ID で照合するため、同じ名前が 2 つ並びました。しかもその損失は先に及びます——モデルが同名のとき、選択画面は提供元の名前で見分けていたからです。
- **言語を切り替えても動かない語がありました**。フォント名、プラグインの印、プルリクエストの分類、チェックの状態、同期の計画、コードテーマの名前——ファイルの先頭に置かれた表は、プログラムが読み込まれた瞬間の言語で固まり、その後は動きません。構文木をたどって 19 か所見つけました。逆向きの修正も 1 つ：「続ける」が送る 3 つの文は訳**しません**。モデルに渡す文であり、保存された記録がそれと認識される目印でもあるからです。訳すと、中国語で続けた会話が英語では認識されず、そのターンは最後の一区間の長さしか報告しなくなります。
- **「システム」のテーマ見本が暗いほうに見えていました**。面積は半々でも、目にはそう映りません。明るい側は幅の多くを灰色のサイドバーに使い、カードは継ぎ目をまたいで重心が暗い側に寄っています。ラスタライズして数えたところ、修正前は明 0% / 暗 100%——「ダーク」の見本とまったく同じ数字でした。
- **設定画面のいくつかの位置合わせと、読み込み後もフォームが古い値を映していた件**。委譲の積極性 5 段階の印は見出しのベースラインに合わせていましたが、段ごとに説明の長さが違うため列がそろいませんでした。また読み込みは同じ ID でプロバイダーを丸ごと置き換える一方、アドレスと API キーの欄は初期値をマウント時に一度読むだけなので、ファイルの内容とフォームの表示が食い違っていました。

<!-- lyra:notes ko -->

### 새 기능

- **화면 언어가 이제 화면 전체를 움직입니다**. English로 바꿔도 지금까지 따라오는 것은 설정 화면의 내비게이션뿐이었고, 본문도 메뉴도 안내도 오류도 중국어 그대로였습니다 — 영어 틀에 중국어 속. 이번에 **2436곳**의 하드코딩을 걷어냈습니다. 실제 창에서 훑어본 결과, 중국어 화면에 중국어 769곳, 영어로 바꾼 뒤 남은 것은 **0곳**. 일곱 언어(간체·번체 중국어, 영어, 일본어, 한국어, 프랑스어, 러시아어)가 같은 목록을 공유하며, 빠진 번역은 타입 오류라 컴파일이 멈춥니다.
- **제공자 설정을 가지고 다닐 수 있습니다**. 파일로 내보내고 다른 컴퓨터에서 불러옵니다. 파일에 API 키가 들어가므로 내보내기 전에 그 사실을 먼저 알립니다. 읽어 들일 때는 항목마다 검증하고, 읽지 못한 것은 통째로 버린 뒤 몇 건인지 알려 줍니다 — 덜 갖춰진 제공자 하나가 섞이면 모델 선택 화면과 요청 구성까지 그대로 흘러가기 때문입니다.
- **답변 속 넓은 표가 가로로 넘어갑니다**. 칸은 줄바꿈하지 않고, 포인터를 올렸을 때만 가로 손잡이가 떠오릅니다. 기본 스크롤바를 전역으로 꺼 두었기 때문에, 지금까지는 단어 중간에서 잘려 거기서 끝나는 것처럼 보였습니다.
- **기간을 바꾸면 사용량 숫자가 함께 움직입니다**. 「30일」을 누르면 화면의 모든 값이 같은 장부를 다시 계산한 결과이므로, 함께 출발하고 함께 멈춥니다.

### 고친 것

- **보조 화면을 찍으면 주 화면이 나왔습니다**. 덮개는 보조 화면에 있는데 나오는 그림은 주 화면의 것이었습니다. Windows에서 GDI로 캡처하면 디스플레이 식별자가 비어 있어, 보조 화면 캡처가 매번 첫 번째 소스로 떨어졌습니다. 「여러 화면에서 스크린샷이 안 된다」의 진짜 원인입니다.
- **주석을 단 스크린샷의 색이 틀어졌고, 유채색만 틀어졌습니다**. 캡처는 디스플레이 프레임 버퍼의 날 값입니다. Display P3 기기에서는 화면의 순수한 빨강이 그 숫자로 234,51,35이고, sRGB로 읽으면 어긋납니다. 잘라내기·모자이크 표본·돋보기의 캔버스가 이제 주 캔버스와 같은 색 공간을 씁니다.
- **브라우저 페이지가 설정 화면 위에 그려졌습니다**. 설정을 열면 작업 공간 전체가 치워지는데, 브라우저의 webview만 그것을 무시했습니다. 스스로 「보임」을 선언했고, 이 속성은 숨겨진 조상 안에서도 다시 드러나도록 되어 있기 때문입니다.
- **오래 도는 하위 에이전트가 문맥을 줄이지 않고 한계에 부딪혔습니다**. 파일을 예순 턴 읽는 일은 문맥이 넘치기 가장 쉬운 일이고, 부모의 압축은 맡긴 실행에 닿지 않습니다. 넘치는 순간 제공자가 요청째로 거절하니, 밖에서는 「큰 일만 이유 없이 실패한다」로 보였습니다. 이제 맡긴 실행에도 압축이 들어가고, 걸음 수를 다 쓰면 그 문장이 숫자를 말합니다.
- **제공자가 같은 이름을 가질 수 있어, 어느 쪽인지 알 수 없었습니다**. 「새 제공자」는 누를 때마다 같은 이름이고 가져오기는 내부 id로 맞추기 때문에, 목록에 똑같은 이름 둘이 나란히 놓였습니다. 손해는 이어집니다 — 모델 이름이 같을 때 선택기는 제공자 이름으로 둘을 갈라 왔으니까요.
- **언어를 바꿔도 제자리에 남는 글자가 있었습니다**. 글꼴 이름, 플러그인 표시, 풀 리퀘스트 분류, 검사 상태, 동기화 계획, 코드 테마 이름 — 파일 맨 위에 놓인 표들은 프로그램이 로드되는 순간의 언어로 굳어, 그 뒤로는 움직이지 않습니다. 구문 트리를 훑어 열아홉 곳을 찾았습니다. 반대 방향으로 고친 것도 하나: 「계속」이 보내는 세 문장은 번역하지 **않습니다**. 모델에게 건네는 글이자 저장된 기록이 그것으로 식별되는 표시이기 때문입니다 — 번역하면 중국어로 이어 간 옛 대화가 영어에서 인식되지 않고, 그 턴은 마지막 한 구간의 시간만 보고하게 됩니다.
- **「시스템」 테마 미리보기가 어두운 쪽처럼 보였습니다**. 넓이는 반반이어도 눈에는 그렇지 않습니다. 밝은 쪽은 너비의 대부분을 회색 사이드바에 쓰고, 카드는 이음매를 가로지르며 무게가 어두운 쪽에 실립니다. 래스터화해 세어 보니 고치기 전은 밝음 0% / 어두움 100% — 「어두움」 미리보기와 똑같은 수치였습니다.
- **설정 화면의 몇 곳 정렬, 그리고 가져온 뒤에도 옛 값을 보여 주던 양식**. 위임 적극성 다섯 단계의 표시는 제목의 기준선에 맞췄지만 단계마다 설명 길이가 달라 열이 들쭉날쭉했습니다. 또 가져오기는 같은 id로 제공자를 통째로 바꾸는데, 주소와 API 키 칸은 처음 붙을 때 초기값을 한 번만 읽으므로 파일의 내용과 화면의 표시가 어긋났습니다.

<!-- lyra:notes fr -->

### Nouveautés

- **La langue de l'interface déplace enfin toute l'interface**. En passant à l'anglais, seule la navigation des réglages suivait : le texte, les menus, les infobulles et les erreurs restaient en chinois — une coquille anglaise autour d'un contenu chinois. Cette version a nettoyé **2436 chaînes écrites en dur**. Mesuré dans une vraie fenêtre : 769 fragments de chinois dans l'interface chinoise, **0 restant** après le passage à l'anglais. Sept langues (chinois simplifié et traditionnel, anglais, japonais, coréen, français, russe) partagent un même catalogue, et une traduction manquante est une erreur de type — cela ne compile pas.
- **La configuration des fournisseurs peut voyager**. Exportez-la dans un fichier et importez-le sur une autre machine. Le fichier contient vos clés d'API, il le dit donc avant de vous laisser en écrire un ; à la lecture, chaque champ est vérifié plutôt que cru, et tout ce qui est illisible est écarté en entier avec le compte de ce qui est parti — un fournisseur à moitié formé qui passerait atteindrait aussi bien le sélecteur de modèles que la construction des requêtes.
- **Les tableaux larges d'une réponse défilent latéralement**. Les cellules restent sur une ligne et une barre horizontale apparaît au survol. Les barres de défilement natives sont désactivées partout, si bien qu'un tableau large s'arrêtait au milieu d'un mot et semblait finir là.
- **Changez de période et les chiffres d'utilisation avancent ensemble**. En appuyant sur « 30 jours », toutes les valeurs à l'écran sont les mêmes comptes recalculés : elles partent et s'arrêtent de concert au lieu d'aller chacune de son côté.

### Corrections

- **Une capture du second écran renvoyait le premier**. Le voile était sur le second écran ; l'image venait du principal. La capture via GDI sous Windows laisse l'identifiant d'écran vide, et chaque capture d'un écran secondaire retombait sur la première source. C'était la vraie cause de « les captures ne marchent pas sur plusieurs écrans ».
- **Les captures annotées dérivaient en couleur — et seulement les couleurs, pas les gris**. Une capture contient les valeurs brutes du tampon d'image de l'écran : sur une machine Display P3, le rouge pur affiché vaut 234,51,35 dans ces nombres, et les lire comme du sRGB les décale. Le recadrage, l'échantillon de flou et la loupe partagent désormais l'espace colorimétrique du canevas principal.
- **Le navigateur peignait par-dessus la page des réglages**. Ouvrir les réglages range tout l'espace de travail, et la webview du navigateur était le seul élément à l'ignorer : elle se déclarait visible, et cette propriété ressort d'un ancêtre masqué par conception.
- **Un sous-agent au long cours heurtait la limite de contexte au lieu de compacter et de continuer**. Soixante tours à lire des fichiers, c'est exactement le travail qui déborde, et le compactage du parent n'atteint pas une exécution déléguée. Une fois débordée, le fournisseur refusait la requête entière — vu de l'extérieur, « les gros travaux échouent mystérieusement et les petits vont bien ». Les exécutions déléguées compactent maintenant aussi, et quand le budget d'étapes s'épuise le message donne le nombre.
- **Deux fournisseurs pouvaient porter le même nom, et plus rien ne les distinguait**. « Nouveau fournisseur » est le même nom à chaque pression, et un import s'apparie sur l'identifiant interne : deux noms identiques se retrouvaient côte à côte. Le dommage se propageait — quand deux modèles portent le même nom, le sélecteur s'appuyait justement sur le nom du fournisseur.
- **Certains mots restaient en place au changement de langue**. Noms de polices, marques d'extensions, groupes de pull requests, états des vérifications, plan de synchronisation, noms des thèmes de code — des tables écrites en tête de fichier, figées dans la langue du chargement du programme. Un passage sur l'arbre syntaxique en a trouvé dix-neuf. Une correction va dans l'autre sens : les trois phrases qu'envoie « Continuer » ne sont **pas** traduites. C'est le texte remis au modèle et la marque à laquelle un historique enregistré est reconnu — les traduire, et une conversation poursuivie en chinois cesse d'être reconnue en anglais, ce tour ne rapportant plus que la durée de son dernier segment.
- **L'aperçu du thème « Système » ressemblait au thème sombre**. Les moitiés sont égales en surface, pas à l'œil : la moitié claire dépense l'essentiel de sa largeur en barre latérale grise, tandis que la carte enjambe la couture avec son poids du côté sombre. Rastérisé et compté : avant correction, 0 % clair / 100 % sombre — les mêmes chiffres que la vignette « Sombre ».
- **Quelques alignements dans les réglages, et un formulaire affichant encore les anciennes valeurs après un import**. Les marques des cinq niveaux de délégation visaient la ligne de base du titre, mais chaque niveau porte une description de longueur différente : la colonne sortait irrégulière. Et un import remplace un fournisseur sous le même identifiant, alors que les champs d'adresse et de clé d'API ne lisent leur valeur initiale qu'une fois, au montage.

<!-- lyra:notes ru -->

### Новое

- **Язык интерфейса теперь двигает весь интерфейс**. При переключении на английский до сих пор следовала только навигация настроек: текст, меню, подсказки и ошибки оставались на китайском — английская рамка вокруг китайского содержимого. В этом выпуске убрано **2436 зашитых строк**. Замер в настоящем окне: 769 фрагментов китайского в китайском интерфейсе и **0 оставшихся** после переключения на английский. Семь языков (упрощённый и традиционный китайский, английский, японский, корейский, французский, русский) делят один каталог, а пропущенный перевод — это ошибка типа, сборка не пройдёт.
- **Настройки поставщиков можно взять с собой**. Выгрузите их в файл и загрузите на другой машине. Файл несёт ваши ключи API, поэтому он предупреждает об этом, прежде чем дать его записать; на обратном пути каждое поле проверяется, а всё непонятое отбрасывается целиком с указанием, сколько ушло — недоделанный поставщик, если бы прошёл, добрался бы и до выбора модели, и до сборки запроса.
- **Широкие таблицы в ответе прокручиваются вбок**. Ячейки не переносятся, а горизонтальный ползунок появляется при наведении. Системные полосы прокрутки отключены во всём приложении, поэтому раньше широкая таблица обрывалась посреди слова и выглядела законченной.
- **Смените период — и цифры расхода поедут вместе**. Нажатие «30 дней» пересчитывает все показания на экране по одним и тем же данным, поэтому они трогаются и останавливаются разом, а не каждый сам по себе.

### Исправлено

- **Снимок второго экрана возвращал первый**. Затемнение лежало на втором экране, а картинка приходила с основного. Захват через GDI в Windows оставляет идентификатор дисплея пустым, и каждый снимок дополнительного экрана откатывался к первому источнику. Это и была настоящая причина «скриншоты не работают на нескольких экранах».
- **У размеченных снимков уезжал цвет — и только цветное, не серое**. Снимок хранит сырые значения из буфера кадра дисплея: на машине с Display P3 чистый красный на экране — это 234,51,35, и чтение их как sRGB смещает картинку. Обрезка, выборка для мозаики и лупа теперь в том же цветовом пространстве, что и основной холст.
- **Браузер рисовал поверх страницы настроек**. Открытие настроек убирает всю рабочую область, и webview браузера был единственным элементом, который это игнорировал: он объявлял себя видимым, а это свойство по определению всплывает изнутри скрытого предка.
- **Долгий субагент упирался в предел контекста вместо того, чтобы сжать его и продолжить**. Шестьдесят ходов чтения файлов — как раз та работа, где контекст переполняется, а сжатие родителя до порученного запуска не дотягивается. После переполнения поставщик отклонял запрос целиком, и снаружи это выглядело как «большие задачи загадочно падают, а мелкие идут». Теперь порученные запуски тоже сжимают контекст, а когда кончаются шаги, сообщение называет число.
- **Два поставщика могли называться одинаково, и различить их было нечем**. «Новый поставщик» — одно и то же имя при каждом нажатии, а импорт сопоставляет по внутреннему идентификатору: в списке оказывались два одинаковых имени. Ущерб шёл дальше — когда две модели зовутся одинаково, выбор разделял их именно по имени поставщика.
- **Часть слов не двигалась при смене языка**. Названия шрифтов, значки плагинов, группы пулреквестов, состояния проверок, план синхронизации, имена тем кода — таблицы, записанные в начале файла, застывают в языке момента загрузки программы. Обход синтаксического дерева нашёл девятнадцать таких мест. Одно исправление пошло в обратную сторону: три фразы, которые отправляет «Продолжить», **не** переводятся. Это текст для модели и одновременно метка, по которой узнаётся сохранённая история — переведи их, и беседа, продолженная на китайском, перестаёт узнаваться на английском, а тот ход сообщает только длительность последнего отрезка.
- **Превью темы «Системная» выглядело как тёмная**. По площади половины равны, но не на глаз: светлая тратит большую часть ширины на серую боковую панель, а карточка пересекает шов, и вес её приходится на тёмную сторону. Растеризовали и посчитали: до правки было 0% светлого / 100% тёмного — те же числа, что и у миниатюры «Тёмная».
- **Несколько выравниваний в настройках и форма, всё ещё показывающая старые значения после импорта**. Метки пяти уровней делегирования тянулись к базовой линии заголовка, но у каждого уровня описание своей длины — столбец выходил неровным. А импорт заменяет поставщика под тем же идентификатором, тогда как поля адреса и ключа API читают начальное значение один раз, при монтировании.

## [0.9.4](https://github.com/kittors/Lyra/releases/tag/v0.9.4) - 2026-09-08

<!-- lyra:notes zh-CN -->

### 新功能

- **忙的时候说出口的话，排着队等**。模型正在跑的时候按回车，那句话不再硬插进当前这一轮把它打断，而是落在输入框上方的队列条里：拖着能调先后，整份草稿连同附件和引用能退回输入框重改，也可以把某一条现在就插进当前轮，或者删掉。一轮干净收尾之后队首自动发出；被中止或出错时队伍停住，等人来决定还发不发。
- **地址栏里打一句话，就去搜**。普通词句不再被当成主机名去解析、然后在控制台留下一串报错，而是认成搜索。引擎可选必应、Google、百度、DuckDuckGo，也可以自定义 `%s` 模板；打字时下拉会先说清这次是搜索还是导航，并结合书签补全。
- **浏览器标签跟着会话走**。每个会话各管各的标签和页面状态，切走再切回还是原来那张网页。最近三个会话常驻渲染进程以控制内存，后台还在跑任务或被智能体调用时会自动唤醒。

### 修复

- **忙的时候补的那一句，不再让时间从头数起**。任务跑到第四十分钟，你想起来还要交代一句，发出去——运行行上的时长退回 `0s`。它改成回答「补这一句之后过了多久」，而你问的是「我这件事等了多久」。原因是每一次发送都重新点一块表。现在插进这一轮的那句用台上那块表，排着等下一轮的那条接上这一轮冻下来的账；只有在会话闲着的时候开口，才算新的一件事。用量也一样，不再跟着归零。
- **归档里点开一个对话，不等于把它取出来**。那一行上本来就有一个「取消归档」的按钮，可点行本身也会顺手改掉归档状态——一次看不见的、没人要求的改动。现在点开就只是点开，归不归档只由那个按钮说了算。发消息也不再把你弹回普通列表。让这件事成立的是另一半：正开着的那个对话，不管归没归档，任何时候都留在侧边栏里，行上给的是「取消归档」，而不是一个按下去什么也不会发生的「归档」。
- **切进归档，侧边栏不再整体往下跳一截**。滚动位置被打回 0，而 0 比列表的开头还要靠上——上面隔着一整条没换过的导航和标签栏，于是它们重新冒出来，把底下的一切往下推。换掉的只是列表，所以现在只退到标签栏落位的那个位置，上面那截一动不动。
- **标签栏贴到顶之后，底下那段列表继续淡出**。往下滚，标签栏一落位，它下面的会话行就不再淡出，而是硬邦邦地滑进它底下。遮罩里那块「不许虚化」的保护区，是从第一个被按住的行的顶一路算到最后一个的底的——可顶上同时被按住的可能有两行：贴着边的标签栏，和正走向自己轨道的分组标题，两者之间夹着的是列表，正是渐隐存在的理由。量到的是标签栏落位那一帧，保护区从 44px 跳到 108px。现在按「挨没挨着」分成两片，中间那段留给渐隐；还在接近的分组标题因此仍然完好。
- **断线的记录，画在它断的地方**。一轮跑四十分钟、中间断过两次又接上，那句「重连 2 次后恢复」贴在最后一行 loading 下面——它说的是四十分钟里某个时刻的事，站的却是「此刻」的位置。现在它记下自己发生时转录有多长，和压缩标记、命令边界一样按位置插进去。还在等的那一条仍然落在末尾，因为它确实正在此刻发生。
- **提交图不再为三周前的合并留一片空白**。图的宽度从前是全表最宽那一行说了算：仓库里但凡有过一处八条分支并行，最上面那几条笔直的提交也要陪着让出八条车道的位置——在这个仓库上量到的是 104px，而它们真正需要的是 13px，九十来像素的空白，右边的提交标题被挤到截断。现在每一行只和它上面的一样宽。车道的横坐标本来就不依赖这个宽度，所以线照旧首尾相接；宽度只增不减，滚动时标题不会左右走。
- **从 Dock 启动时，不再满屏 command not found**。图形界面启动的应用拿到的是 launchd 那份极简 PATH，而 `$SHELL -c` 不读 `~/.zshrc`，于是每一个 `pnpm`、`node`、`npx` 都是找不到命令——在一次真实的会话记录里出现过五十次。现在启动时先问登录 shell，问不到就用一份兜底清单，而清单这次补上了 pnpm 自己的 `~/.pnpm`、nvm 的 `current` 软链和 asdf 的 shims。
- **万行构建日志不再刷爆窗口**。bash 工具的输出按 100ms 合批之后再过 IPC，一次 `pnpm build` 的刷屏不再把渲染进程压住。

<!-- lyra:notes zh-TW -->

### 新功能

- **忙的時候說出口的話，排著隊等**。模型正在跑的時候按 Enter，那句話不再硬插進當前這一輪把它打斷，而是落在輸入框上方的佇列條裡：拖著能調先後，整份草稿連同附件和引用能退回輸入框重改，也可以把某一條現在就插進當前輪，或者刪掉。一輪乾淨收尾之後隊首自動送出；被中止或出錯時隊伍停住，等人來決定還發不發。
- **網址列裡打一句話，就去搜**。普通詞句不再被當成主機名去解析、然後在主控台留下一串報錯，而是認成搜尋。引擎可選 Bing、Google、百度、DuckDuckGo，也可以自訂 `%s` 範本；打字時下拉會先說清這次是搜尋還是導覽，並結合書籤補全。
- **瀏覽器分頁跟著對話走**。每個對話各管各的分頁和頁面狀態，切走再切回還是原來那張網頁。最近三個對話常駐算繪處理程序以控制記憶體，背景還在跑任務或被智慧體呼叫時會自動喚醒。

### 修復

- **忙的時候補的那一句，不再讓時間從頭數起**。任務跑到第四十分鐘，你想起來還要交代一句，送出去——執行列上的時長退回 `0s`。它改成回答「補這一句之後過了多久」，而你問的是「我這件事等了多久」。原因是每一次傳送都重新點一塊錶。現在插進這一輪的那句用台上那塊錶，排著等下一輪的那條接上這一輪凍下來的帳；只有在對話閒著的時候開口，才算新的一件事。用量也一樣，不再跟著歸零。
- **封存裡點開一個對話，不等於把它取出來**。那一列上本來就有一個「取消封存」的按鈕，可點列本身也會順手改掉封存狀態——一次看不見的、沒人要求的改動。現在點開就只是點開，封不封存只由那個按鈕說了算。傳訊息也不再把你彈回一般清單。讓這件事成立的是另一半：正開著的那個對話，不管封沒封存，任何時候都留在側邊欄裡，列上給的是「取消封存」，而不是一個按下去什麼也不會發生的「封存」。
- **切進封存，側邊欄不再整體往下跳一截**。捲動位置被打回 0，而 0 比清單的開頭還要靠上——上面隔著一整條沒換過的導覽和標籤列，於是它們重新冒出來，把底下的一切往下推。換掉的只是清單，所以現在只退到標籤列落位的那個位置，上面那截一動不動。
- **標籤列貼到頂之後，底下那段清單繼續淡出**。往下捲，標籤列一落位，它下面的對話列就不再淡出，而是硬邦邦地滑進它底下。遮罩裡那塊「不許虛化」的保護區，是從第一個被按住的列的頂一路算到最後一個的底的——可頂上同時被按住的可能有兩列：貼著邊的標籤列，和正走向自己軌道的分組標題，兩者之間夾著的是清單，正是漸隱存在的理由。量到的是標籤列落位那一格，保護區從 44px 跳到 108px。現在按「挨沒挨著」分成兩片，中間那段留給漸隱；還在接近的分組標題因此仍然完好。
- **斷線的紀錄，畫在它斷的地方**。一輪跑四十分鐘、中間斷過兩次又接上，那句「重連 2 次後恢復」貼在最後一列 loading 下面——它說的是四十分鐘裡某個時刻的事，站的卻是「此刻」的位置。現在它記下自己發生時轉錄有多長，和壓縮標記、命令邊界一樣按位置插進去。還在等的那一條仍然落在末尾，因為它確實正在此刻發生。
- **提交圖不再為三週前的合併留一片空白**。圖的寬度從前是全表最寬那一列說了算：儲存庫裡但凡有過一處八條分支並行，最上面那幾條筆直的提交也要陪著讓出八條軌道的位置——在這個儲存庫上量到的是 104px，而它們真正需要的是 13px，九十來像素的空白，右邊的提交標題被擠到截斷。現在每一列只和它上面的一樣寬。軌道的橫座標本來就不依賴這個寬度，所以線照舊首尾相接；寬度只增不減，捲動時標題不會左右走。
- **從 Dock 啟動時，不再滿螢幕 command not found**。圖形介面啟動的應用拿到的是 launchd 那份極簡 PATH，而 `$SHELL -c` 不讀 `~/.zshrc`，於是每一個 `pnpm`、`node`、`npx` 都是找不到命令——在一次真實的對話紀錄裡出現過五十次。現在啟動時先問登入 shell，問不到就用一份兜底清單，而清單這次補上了 pnpm 自己的 `~/.pnpm`、nvm 的 `current` 軟連結和 asdf 的 shims。
- **萬行建置日誌不再刷爆視窗**。bash 工具的輸出按 100ms 合批之後再過 IPC，一次 `pnpm build` 的刷屏不再把算繪處理程序壓住。

<!-- lyra:notes en -->

### New

- **What you say while it is busy waits its turn.** Press enter while the model is working and the message no longer barges into the running turn and interrupts it — it lands on a queue above the composer instead. Drag to reorder, hand a whole draft back to the composer with its attachments and references intact, push one into the current turn right now, or drop it. When a turn finishes cleanly the head of the queue goes out on its own; when one is stopped or fails the queue holds, and the decision stays yours.
- **Type a phrase into the address bar and it searches.** Ordinary words are no longer parsed as a hostname and left as a row of console errors — they are read as a search. Bing, Google, Baidu and DuckDuckGo, or a `%s` template of your own; the dropdown says whether this will search or navigate before you commit, and completes against your bookmarks.
- **Browser tabs belong to their conversation.** Each one keeps its own tabs and page state, so leaving and coming back finds the same page. The three most recent conversations keep their renderers alive to bound memory, and one running a task in the background — or being driven by an agent — wakes on its own.

### Fixed

- **Adding a requirement to a running task no longer restarts its clock.** Forty minutes into a task you remember one more thing, send it — and the elapsed time on the running line drops back to `0s`. It had started answering "how long since you added that", when the question is "how long have I been waiting on this". Every send used to light a fresh meter. Now an interruption delivered into the running turn keeps the meter already lit, and one held on the queue picks up the meter that turn froze for it; only speaking to an idle session begins something new. The token count stops resetting too.
- **Opening a conversation in the archive no longer takes it out.** The row already had a button for that — and clicking the row itself changed the filing as well, invisibly, without being asked. Opening now only opens; whether a conversation is archived is said in one place. Sending a message no longer throws you back to the live list either. What makes that safe is the other half: the conversation you have open stays in the sidebar whether or not it is filed, and its row offers to take it out rather than offering it the thing it already is.
- **Opening the archive no longer shoves the whole sidebar down.** The scroll position went to zero, and zero is further up than the list begins — above it sit the destinations and the tab strip, neither of which changed, so they came back on screen and pushed everything below them down. What is replaced is the list, so the scroll now stops at the offset that holds the strip in place, and the band above it does not move.
- **Once the tab strip lands, the list under it keeps dissolving.** Scrolling down, the moment the strip reached the top edge the rows beneath it stopped fading and began sliding under it hard-edged. The mask's protected band ran from the first held row's top to the last one's bottom — but two rows can be held at once, the strip against the edge and a project heading arriving at the rail below it, and between them there is list, which is exactly what the fade is for. Measured: the protection jumped from 44px to 108px on the frame the strip landed. Held rows are now grouped by whether they touch, and the gap between them is left to soften — the heading still on its way stays whole.
- **A dropped connection is drawn where it dropped.** Forty minutes into a turn that lost its connection twice and recovered, "reconnected twice" sat under the last loading line — describing a moment from half an hour ago while standing in the position that means "now". It now records how long the transcript was when it happened and is placed by that, like a compaction marker or a command boundary. The one still waiting stays at the end, because that one really is happening now.
- **The commit graph no longer leaves a gap for a merge from three weeks ago.** Its width was set by the widest row in the whole list: a repository that ever had eight branches open at once gave eight lanes' worth of column to the straight run of commits at the top as well — 104px measured on this repository, where 13px was all they needed, with the subjects on the right cut off mid-word. Each row is now only as wide as the widest thing at or above it. Lane positions never depended on that width, so the lines still meet across rows; and the width only ever grows, so subjects do not walk sideways as you scroll.
- **No more screenfuls of `command not found` when launched from the Dock.** An app started from an icon inherits launchd's four-directory PATH, and `$SHELL -c` never reads `~/.zshrc`, so every `pnpm`, `node` and `npx` came back as a missing command — fifty of them in one real session's history. The login shell is now asked at startup, and where it cannot be, a fallback list stands in — one that has gained pnpm's own `~/.pnpm`, nvm's `current` symlink and asdf's shims.
- **A ten-thousand-line build log no longer floods the window.** Output from the bash tool is batched on a 100ms tick before it crosses IPC, so one `pnpm build` cannot bury the renderer.

<!-- lyra:notes ja -->

### 新機能

- **実行中に言ったことは、順番を待ちます。** モデルが動いている最中に Enter を押しても、そのメッセージが実行中のターンに割り込んで中断させることはなくなりました。入力欄の上のキューに並びます。ドラッグで順序を変え、下書きを添付や参照ごと入力欄に戻して書き直し、今すぐ現在のターンに差し込むことも、破棄することもできます。ターンがきれいに終わればキューの先頭が自動的に送られます。中断や失敗で終わったときはキューは止まったまま、判断はあなたに残ります。
- **アドレスバーに言葉を打てば、検索します。** 普通の語句がホスト名として解釈され、コンソールにエラーの列を残すことはなくなりました。検索として読み取ります。Bing、Google、百度、DuckDuckGo、あるいは自分の `%s` テンプレート。入力中のドロップダウンが、これが検索なのか移動なのかを先に伝え、ブックマークから補完します。
- **ブラウザのタブは対話ごとに独立します。** それぞれの対話が自分のタブとページの状態を保つので、離れて戻っても同じページです。直近 3 つの対話はレンダラーを保持してメモリを抑え、背後でタスクを実行中のもの、あるいはエージェントに操作されているものは自動的に起きます。

### 修正

- **実行中のタスクに一言足しても、時間が最初から数え直されなくなりました。** 40 分走っているタスクに、もう一つ伝えたいことを思い出して送る——実行行の経過時間が `0s` に戻ります。「それを足してから何分経ったか」に答えるようになっていたわけですが、知りたいのは「この件をどれだけ待っているか」です。送信のたびに新しい計測が始まっていました。今は、実行中のターンに割り込んだ発言はすでに点いている計測をそのまま使い、キューで待っていたものはそのターンが凍結して残した計測を引き継ぎます。新しく始まるのは、待機中のセッションに話しかけたときだけです。トークン数も同様に、リセットされなくなりました。
- **アーカイブの中の対話を開いても、取り出されなくなりました。** その行にはもともと「アーカイブ解除」のボタンがあり、それとは別に、行そのものをクリックしただけでアーカイブ状態が書き換わっていました——誰も頼んでいない、目に見えない変更です。開くことは開くだけになりました。アーカイブされているかどうかを言うのは、あのボタン一箇所です。メッセージを送っても通常の一覧に引き戻されません。それを可能にしているのがもう半分です。開いている対話は、アーカイブされていてもいなくてもサイドバーに残り、その行はすでにそうであることを勧める代わりに「取り出す」を差し出します。
- **アーカイブを開いても、サイドバー全体が下にずれなくなりました。** スクロール位置がゼロに戻っていたのですが、ゼロは一覧の先頭よりさらに上です——その上には移動先とタブの帯があり、どちらも変わっていないのに画面に戻ってきて、下のすべてを押し下げていました。差し替わるのは一覧なので、スクロールは帯が定位置に留まる分だけ戻るようになり、その上の部分は動きません。
- **タブの帯が上端に着いたあとも、その下の一覧は溶けるように消えます。** 下にスクロールして帯が上端に着いた瞬間、その下の行はフェードをやめ、硬い輪郭のまま帯の下へ滑り込んでいました。マスクの保護帯が、最初に保持された行の上端から最後の行の下端まで通しで引かれていたためです。しかし上端で同時に保持されうる行は二つあります。端に着いた帯と、その下のレールへ向かっているプロジェクト名。その間にあるのは一覧そのもので、まさにフェードが存在する理由です。計測では、帯が着いたフレームで保護が 44px から 108px に跳ねていました。今は保持された行を「接しているかどうか」でまとめ、間の隙間はぼかしに残します。近づいている見出しはそのまま無傷です。
- **接続が切れた記録は、切れた場所に描かれます。** 40 分のターンの途中で二度切れて復帰した場合、「2 回再接続して復旧」は最後のローディング行の下に貼り付いていました——半時間前の出来事を語りながら、「今」を意味する位置に立っていたわけです。今は発生時点で記録がどれだけの長さだったかを控え、圧縮マーカーやコマンドの区切りと同じように、その位置に置かれます。まだ待っている一件は末尾のままです。それは本当に今起きているからです。
- **コミットグラフが、三週間前のマージのために余白を空けなくなりました。** 幅は一覧全体で最も広い行が決めていました。かつて八本のブランチが並走したことのあるリポジトリでは、上端のまっすぐ続くコミットにも八レーン分の桁が与えられます——このリポジトリで計測した値は 104px、実際に必要だったのは 13px で、右側のコミット件名は語の途中で切れていました。今は各行が、そこから上で最も広いものと同じ幅になります。レーンの横位置はもともとこの幅に依存しないので、線は従来どおり行をまたいで繋がります。幅は増えるだけなので、スクロールしても件名が左右に動きません。
- **Dock から起動したときの `command not found` の山がなくなりました。** アイコンから起動したアプリは launchd の 4 ディレクトリだけの PATH を受け取り、`$SHELL -c` は `~/.zshrc` を読みません。その結果、`pnpm` も `node` も `npx` もコマンドが見つからない扱いでした——実際のセッション記録では 50 回。今は起動時にログインシェルへ問い合わせ、それができない場合はフォールバックの一覧で補います。その一覧に pnpm 自身の `~/.pnpm`、nvm の `current` シンボリックリンク、asdf の shims が加わりました。
- **一万行のビルドログでウィンドウが埋まらなくなりました。** bash ツールの出力は IPC を渡る前に 100ms 単位でまとめられるので、一度の `pnpm build` がレンダラーを押し潰すことはありません。

<!-- lyra:notes ko -->

### 새로운 기능

- **실행 중에 한 말은 차례를 기다립니다.** 모델이 도는 중에 엔터를 눌러도 그 메시지가 진행 중인 턴에 끼어들어 끊지 않습니다. 입력창 위의 대기열에 놓입니다. 끌어서 순서를 바꾸고, 초안을 첨부와 참조까지 통째로 입력창에 되돌려 고쳐 쓰고, 지금 바로 현재 턴에 밀어 넣거나 버릴 수 있습니다. 턴이 깨끗하게 끝나면 대기열의 맨 앞이 알아서 나갑니다. 중단되거나 실패로 끝났을 때는 대기열이 멈춘 채로, 결정은 당신에게 남습니다.
- **주소창에 문장을 치면 검색합니다.** 평범한 낱말이 호스트 이름으로 해석되어 콘솔에 오류를 줄줄이 남기는 일이 없어졌습니다. 검색으로 읽습니다. Bing, Google, 바이두, DuckDuckGo, 또는 직접 만든 `%s` 템플릿. 입력하는 동안 드롭다운이 이번 것이 검색인지 이동인지 먼저 알려주고, 북마크로 자동완성합니다.
- **브라우저 탭은 대화마다 따로입니다.** 각 대화가 자기 탭과 페이지 상태를 지니므로, 떠났다 돌아와도 같은 페이지입니다. 최근 세 개의 대화는 렌더러를 살려 두어 메모리를 묶어 두고, 뒤에서 작업을 돌리고 있거나 에이전트가 조작 중인 것은 알아서 깨어납니다.

### 수정

- **실행 중인 작업에 한마디 덧붙여도 시간이 처음부터 다시 세지 않습니다.** 40분째 돌고 있는 작업에 한 가지가 더 생각나 보내면, 실행 줄의 경과 시간이 `0s`로 돌아갔습니다. "그걸 덧붙인 뒤로 얼마나 지났는가"에 답하게 된 셈인데, 묻고 있는 것은 "이 일을 얼마나 기다렸는가"입니다. 전송할 때마다 새 계측이 시작되고 있었습니다. 이제 실행 중인 턴에 끼어든 말은 이미 켜져 있는 계측을 그대로 쓰고, 대기열에서 기다리던 것은 그 턴이 얼려 남긴 계측을 이어받습니다. 새로 시작되는 것은 쉬고 있는 세션에 말을 걸 때뿐입니다. 토큰 수도 마찬가지로 더 이상 초기화되지 않습니다.
- **보관함에서 대화를 열어도 꺼내지지 않습니다.** 그 행에는 이미 "보관 해제" 버튼이 있었는데, 행 자체를 눌러도 보관 상태가 함께 바뀌었습니다 — 아무도 요청하지 않은, 보이지 않는 변경입니다. 이제 여는 것은 여는 것일 뿐이고, 보관 여부를 말하는 곳은 그 버튼 하나입니다. 메시지를 보내도 일반 목록으로 되돌려지지 않습니다. 이를 가능하게 한 나머지 절반은 이것입니다. 열려 있는 대화는 보관되었든 아니든 사이드바에 남고, 그 행은 이미 그러한 상태를 다시 권하는 대신 "꺼내기"를 내놓습니다.
- **보관함으로 전환할 때 사이드바 전체가 아래로 밀리지 않습니다.** 스크롤 위치가 0으로 돌아갔는데, 0은 목록이 시작되는 곳보다 더 위입니다 — 그 위에는 이동 항목과 탭 띠가 있고 둘 다 바뀌지 않았는데도 화면에 다시 나타나 아래의 모든 것을 밀어냈습니다. 교체되는 것은 목록이므로, 스크롤은 띠가 제자리에 머무는 만큼만 되돌아가고 그 위쪽은 움직이지 않습니다.
- **탭 띠가 상단에 닿은 뒤에도 그 아래 목록은 계속 흐려집니다.** 아래로 스크롤해 띠가 상단에 닿는 순간, 그 아래 행들은 페이드를 멈추고 또렷한 채로 띠 밑으로 미끄러져 들어갔습니다. 마스크의 보호 구간이 처음 고정된 행의 위쪽부터 마지막 행의 아래쪽까지 통째로 그어졌기 때문입니다. 하지만 상단에서 동시에 고정될 수 있는 행은 둘입니다. 가장자리에 닿은 띠와, 그 아래 레일로 향하는 프로젝트 제목. 그 사이에 있는 것이 목록이고, 그것이 바로 페이드가 존재하는 이유입니다. 측정값으로는 띠가 닿는 프레임에서 보호 구간이 44px에서 108px로 뛰었습니다. 이제 고정된 행은 서로 맞닿아 있는지로 묶이고, 사이의 간격은 흐려짐에 맡깁니다. 다가오는 중인 제목은 그대로 온전합니다.
- **끊긴 연결의 기록은 끊긴 자리에 그려집니다.** 40분짜리 턴 도중 두 번 끊겼다 복구되면, "2회 재연결 후 복구"가 마지막 로딩 줄 아래에 붙어 있었습니다 — 반 시간 전의 일을 말하면서 "지금"을 뜻하는 자리에 서 있었던 셈입니다. 이제 발생 시점의 기록 길이를 적어 두고, 압축 표시나 명령 경계와 같은 방식으로 그 위치에 놓입니다. 아직 기다리는 중인 한 건은 끝에 남습니다. 그건 정말로 지금 일어나는 일이기 때문입니다.
- **커밋 그래프가 3주 전 병합을 위해 여백을 비워두지 않습니다.** 너비는 목록 전체에서 가장 넓은 행이 정했습니다. 한때 여덟 갈래가 나란히 있었던 저장소라면, 맨 위의 곧게 이어지는 커밋들도 여덟 레인짜리 열을 함께 내주어야 했습니다 — 이 저장소에서 측정한 값은 104px, 실제로 필요한 것은 13px였고, 오른쪽 커밋 제목은 단어 중간에서 잘렸습니다. 이제 각 행은 그 위쪽에서 가장 넓은 것과 같은 너비입니다. 레인의 가로 위치는 원래 이 너비에 기대지 않으므로 선은 여전히 행을 넘어 이어집니다. 너비는 늘기만 하므로 스크롤할 때 제목이 좌우로 움직이지 않습니다.
- **Dock에서 실행했을 때 `command not found`가 화면을 채우지 않습니다.** 아이콘에서 시작한 앱은 launchd의 네 디렉터리짜리 PATH를 물려받고, `$SHELL -c`는 `~/.zshrc`를 읽지 않습니다. 그래서 `pnpm`도 `node`도 `npx`도 명령을 찾을 수 없었습니다 — 실제 세션 기록에서 쉰 번. 이제 시작할 때 로그인 셸에 묻고, 물을 수 없을 때는 폴백 목록이 대신합니다. 그 목록에 pnpm 자신의 `~/.pnpm`, nvm의 `current` 심볼릭 링크, asdf의 shims가 더해졌습니다.
- **만 줄짜리 빌드 로그가 창을 덮치지 않습니다.** bash 도구의 출력은 IPC를 건너기 전에 100ms 단위로 묶이므로, `pnpm build` 한 번이 렌더러를 짓누르지 않습니다.

<!-- lyra:notes fr -->

### Nouveautés

- **Ce que vous dites pendant qu'il travaille attend son tour.** Appuyer sur entrée pendant que le modèle tourne ne fait plus irruption dans le tour en cours pour l'interrompre : le message se range dans une file au-dessus du champ de saisie. On peut y changer l'ordre par glisser-déposer, renvoyer un brouillon entier au champ avec ses pièces jointes et ses références, en pousser un tout de suite dans le tour courant, ou le supprimer. Quand un tour s'achève proprement, la tête de file part d'elle-même ; quand il est arrêté ou échoue, la file s'immobilise et la décision vous revient.
- **Tapez une phrase dans la barre d'adresse et elle cherche.** Des mots ordinaires ne sont plus analysés comme un nom d'hôte en laissant une rangée d'erreurs dans la console — ils sont lus comme une recherche. Bing, Google, Baidu et DuckDuckGo, ou votre propre modèle `%s` ; la liste déroulante annonce s'il s'agira d'une recherche ou d'une navigation avant que vous ne validiez, et complète depuis vos marque-pages.
- **Les onglets du navigateur appartiennent à leur conversation.** Chacune garde ses propres onglets et l'état de ses pages : on part et on revient sur la même. Les trois conversations les plus récentes gardent leur moteur de rendu en vie pour borner la mémoire, et celle qui exécute une tâche en arrière-plan — ou qu'un agent pilote — se réveille d'elle-même.

### Corrections

- **Ajouter une consigne à une tâche en cours ne remet plus le chronomètre à zéro.** Quarante minutes après le début d'une tâche, vous vous rappelez une chose de plus, vous l'envoyez — et la durée sur la ligne d'exécution retombe à `0s`. Elle s'était mise à répondre « combien de temps depuis cet ajout », alors que la question est « depuis combien de temps j'attends ceci ». Chaque envoi allumait un nouveau compteur. Désormais, une interruption livrée dans le tour en cours garde le compteur déjà allumé, et celle retenue dans la file reprend celui que ce tour avait gelé pour elle ; seule une parole adressée à une session au repos commence quelque chose de neuf. Le décompte de jetons cesse lui aussi de repartir de zéro.
- **Ouvrir une conversation archivée ne l'en sort plus.** La ligne avait déjà un bouton pour cela — et cliquer sur la ligne elle-même modifiait aussi le classement, invisiblement, sans que personne l'ait demandé. Ouvrir se contente désormais d'ouvrir ; l'état d'archivage se dit en un seul endroit. Envoyer un message ne vous renvoie plus non plus vers la liste courante. Ce qui rend cela possible est l'autre moitié : la conversation ouverte reste dans la barre latérale, archivée ou non, et sa ligne propose de l'en sortir plutôt que de lui proposer ce qu'elle est déjà.
- **Ouvrir les archives ne pousse plus toute la barre latérale vers le bas.** La position de défilement revenait à zéro, et zéro est plus haut que le début de la liste — au-dessus se trouvent les destinations et la bande d'onglets, dont aucune n'a changé, si bien qu'elles revenaient à l'écran en repoussant tout le reste. Ce qui est remplacé, c'est la liste : le défilement s'arrête maintenant à l'endroit qui maintient la bande en place, et ce qui la surmonte ne bouge pas.
- **Une fois la bande d'onglets arrivée en haut, la liste en dessous continue de se dissoudre.** En descendant, à l'instant où la bande atteignait le bord supérieur, les lignes en dessous cessaient de s'estomper et glissaient sous elle à contours nets. La zone protégée du masque allait du haut de la première ligne retenue au bas de la dernière — mais deux lignes peuvent être retenues à la fois, la bande contre le bord et un nom de projet en route vers son rail, et entre les deux il y a de la liste, ce pour quoi le fondu existe. Mesuré : la protection passait de 44 px à 108 px sur l'image où la bande se posait. Les lignes retenues sont désormais groupées selon qu'elles se touchent, et l'écart entre elles est laissé au fondu — le titre encore en approche reste entier.
- **Une coupure de connexion est dessinée là où elle a eu lieu.** Sur un tour de quarante minutes coupé deux fois puis rétabli, « reconnecté 2 fois » se tenait sous la dernière ligne de chargement — décrivant un instant d'une demi-heure plus tôt depuis la place qui signifie « maintenant ». La note retient désormais la longueur de la transcription au moment des faits et se place en conséquence, comme un repère de compactage ou une frontière de commande. Celle qui attend encore reste à la fin, parce que celle-là se passe vraiment maintenant.
- **Le graphe des commits ne réserve plus d'espace pour une fusion d'il y a trois semaines.** Sa largeur était fixée par la ligne la plus large de toute la liste : un dépôt ayant connu huit branches en parallèle donnait huit couloirs de colonne à la suite de commits rectilignes du haut également — 104 px mesurés sur ce dépôt, là où 13 px suffisaient, et les sujets à droite coupés en plein mot. Chaque ligne est maintenant aussi large que ce qu'il y a de plus large au-dessus d'elle. La position des couloirs n'a jamais dépendu de cette largeur, donc les traits se rejoignent toujours d'une ligne à l'autre ; et la largeur ne fait que croître, si bien que les sujets ne se déplacent pas latéralement au défilement.
- **Fini les écrans entiers de `command not found` au lancement depuis le Dock.** Une application démarrée par son icône hérite du PATH à quatre répertoires de launchd, et `$SHELL -c` ne lit jamais `~/.zshrc` : chaque `pnpm`, `node` et `npx` revenait donc en commande introuvable — cinquante fois dans l'historique d'une session réelle. Le shell de connexion est maintenant interrogé au démarrage, et là où il ne peut pas l'être, une liste de secours prend le relais — elle a gagné le `~/.pnpm` de pnpm, le lien `current` de nvm et les shims d'asdf.
- **Un journal de compilation de dix mille lignes ne submerge plus la fenêtre.** La sortie de l'outil bash est regroupée par tranches de 100 ms avant de traverser l'IPC, si bien qu'un seul `pnpm build` ne peut plus enterrer le moteur de rendu.

<!-- lyra:notes ru -->

### Новое

- **Сказанное во время работы ждёт своей очереди.** Нажатие Enter, пока модель работает, больше не вклинивается в идущий ход и не прерывает его — сообщение становится в очередь над полем ввода. Порядок меняется перетаскиванием, черновик целиком возвращается в поле вместе с вложениями и ссылками, любую запись можно прямо сейчас втолкнуть в текущий ход или удалить. Когда ход завершается чисто, первая в очереди уходит сама; когда он прерван или упал, очередь замирает, и решение остаётся за вами.
- **Наберите фразу в адресной строке — и она будет искать.** Обычные слова больше не разбираются как имя хоста, оставляя вереницу ошибок в консоли, — они читаются как поиск. Bing, Google, Baidu и DuckDuckGo или собственный шаблон с `%s`; выпадающий список заранее говорит, будет это поиск или переход, и дополняет по закладкам.
- **Вкладки браузера принадлежат своему разговору.** Каждый хранит собственные вкладки и состояние страниц, так что уйти и вернуться — значит найти ту же страницу. Три последних разговора держат свои процессы отрисовки живыми, чтобы ограничить память, а тот, что выполняет задачу в фоне — или которым управляет агент, — просыпается сам.

### Исправления

- **Уточнение, добавленное к идущей задаче, больше не обнуляет счётчик времени.** На сороковой минуте вы вспоминаете ещё одну деталь, отправляете её — и время в строке выполнения возвращается к `0s`. Оно начинало отвечать на вопрос «сколько прошло с момента этого добавления», тогда как спрашивают «сколько я уже жду это». Каждая отправка зажигала новый счётчик. Теперь реплика, доставленная в идущий ход, использует уже зажжённый счётчик, а та, что ждала в очереди, подхватывает счётчик, замороженный для неё этим ходом; заново всё начинается только тогда, когда вы обращаетесь к свободной сессии. Счёт токенов тоже перестал обнуляться.
- **Открытие разговора в архиве больше не достаёт его оттуда.** У строки и так была кнопка для этого — а клик по самой строке тоже менял состояние архива, незаметно и без всякой просьбы. Теперь открыть значит просто открыть; о том, в архиве ли разговор, говорит одно место. Отправка сообщения тоже не выбрасывает вас обратно в обычный список. Возможным это делает вторая половина: открытый разговор остаётся в боковой панели независимо от того, убран ли он в архив, и его строка предлагает достать его, а не предлагает ему то, чем он уже является.
- **Переход в архив больше не сдвигает всю боковую панель вниз.** Позиция прокрутки уходила в ноль, а ноль выше, чем начало списка — над ним находятся пункты перехода и полоса вкладок, и ни то ни другое не менялось, но они возвращались на экран и продавливали вниз всё остальное. Заменяется список, поэтому прокрутка теперь останавливается там, где полоса удерживается на месте, и всё, что над ней, не двигается.
- **После того как полоса вкладок встала наверху, список под ней продолжает растворяться.** При прокрутке вниз, в момент, когда полоса достигала верхнего края, строки под ней переставали растворяться и уходили под неё с резким контуром. Защищённая полоса маски шла от верха первой удержанной строки до низа последней — но наверху одновременно могут удерживаться две: полоса у самого края и название проекта, идущее к своей направляющей, а между ними находится список, ради которого растворение и существует. Измерено: на кадре приземления полосы защита прыгала с 44px до 108px. Теперь удержанные строки группируются по тому, соприкасаются ли они, а промежуток между ними оставлен растворению — заголовок на подходе остаётся целым.
- **Обрыв связи рисуется там, где он произошёл.** В сорокаминутном ходе, дважды прерванном и восстановленном, «переподключено 2 раза» держалось под последней строкой загрузки — рассказывая о моменте получасовой давности с позиции, которая означает «сейчас». Теперь запись сохраняет длину расшифровки на момент события и ставится по ней, как отметка сжатия или граница команды. Та, что ещё ждёт, остаётся в конце — потому что она действительно происходит сейчас.
- **Граф коммитов больше не оставляет пустоту ради слияния трёхнедельной давности.** Ширину задавала самая широкая строка всего списка: репозиторий, в котором когда-то было восемь параллельных веток, отдавал колонку на восемь дорожек и верхним прямым коммитам тоже — 104px, измеренные на этом репозитории, там где хватало 13px, а темы коммитов справа обрывались посреди слова. Теперь каждая строка настолько широка, насколько широко самое широкое на ней и выше. Положение дорожек никогда не зависело от этой ширины, поэтому линии по-прежнему смыкаются между строками; а ширина только растёт, так что темы не ходят влево-вправо при прокрутке.
- **Больше никаких экранов `command not found` при запуске из Dock.** Приложение, запущенное по значку, наследует PATH из четырёх каталогов от launchd, а `$SHELL -c` никогда не читает `~/.zshrc` — поэтому каждый `pnpm`, `node` и `npx` возвращался как ненайденная команда: пятьдесят раз в истории одной реальной сессии. Теперь при запуске опрашивается логин-шелл, а там, где это невозможно, его заменяет запасной список — в нём появились собственный `~/.pnpm` у pnpm, ссылка `current` у nvm и shims у asdf.
- **Десятитысячестрочный лог сборки больше не заливает окно.** Вывод инструмента bash собирается пачками по 100 мс перед тем, как пройти через IPC, так что одна `pnpm build` не может похоронить отрисовку.

## [0.9.3](https://github.com/kittors/Lyra/releases/tag/v0.9.3) - 2026-09-08

<!-- lyra:notes zh-CN -->

### 新功能

- **输入框默认高度可以自己定**。外观 › 偏好设置里一条滑条，1 到 10 行，底下配一块实时预览——预览用的是真输入框的同一套边框、字号、行高和算式，滑到哪一格看到的就是那一格的实物。写长需求时不必每次都从一行开始往下撑。
- **子智能体派不派，你说了算**。设置 › 子智能体调度，四档：跟随思考等级（默认，也是以前唯一的行为）、积极、保守、关闭。关闭挡的是模型自作主张，你在消息里 @ 点名的那次照派。
- **发版说明跟着界面语言走**。把 Lyra 切成哪种语言，「关于」页里这段说明就是哪种语言。

### 修复

- **文件预览的滚动条**。短文件底下那条永远存在、又推不动几十像素的横条没了——它是内容盒被多算了一个行号槽的宽度造成的，同一个原因还把长行锁死在视口宽，四百字符的一行永远看不到后半截，现在真能滚到最右。滑块也跟着内容走了：此前换过一个文件之后它就僵在原地，内容滚到最后一行、滑块还贴在顶端。两条滚动条在右下角不再互相压着，拖得到底、也拖得到最右。
- **设置页的控件回到中线上**。带说明文字的行——设置里绝大多数行都带——开关和下拉此前一律停在上半截，一整张卡片摞起来就是右边一列全体偏上。侧边栏座右铭输入框底下那行重复的预览也去掉了。
- **一次失败只判一次**。「该不该重试」以前在四个地方各判一次，四份名单互不知情，于是同一个故障在这一层算可以再试、在下一层算没救了，设置里写着「无限重试」而请求在第一次就放弃。现在只有明确「再问一百遍也是这个答复」的才不重试，没见过的错法一律再试一次。界面上，一次自己好了的连接抖动留一行灰字，而不是一片红。
- **截图里的标注文字不再丢**。写在标注框里、还没点别处提交的那几个字，按「完成」时会一起进到图里；「置顶」和「下载」走的是同一次裁剪，一并修好。
- **能点的看起来能点，滚得动的滚起来不留白**。任务面板往下滚不再撞上一大片空白——它的虚拟列表从来没挂上滚动监听，可见区间一直停在最初的四十行；快速拖动滚动条不再闪出白屏；滚动条不再压住最右边几个字符；菜单项、树行这些此前被漏掉的元素，现在也跟着「使用指针光标」显示手型。

<!-- lyra:notes zh-TW -->

### 新功能

- **輸入框預設高度可以自己定**。外觀 › 偏好設定裡一條滑桿，1 到 10 行，下面配一塊即時預覽——預覽用的是真輸入框的同一套邊框、字級、行高和算式，滑到哪一格看到的就是那一格的實物。寫長需求時不必每次都從一行開始往下撐。
- **子智慧體派不派，你說了算**。設定 › 子智慧體調度，四檔：跟隨思考等級（預設，也是以前唯一的行為）、積極、保守、關閉。關閉擋的是模型自作主張，你在訊息裡 @ 點名的那次照派。
- **發版說明跟著介面語言走**。把 Lyra 切成哪種語言，「關於」頁裡這段說明就是哪種語言。

### 修復

- **檔案預覽的捲軸**。短檔案下面那條永遠存在、又推不動幾十像素的橫條沒了——它是內容盒被多算了一個行號槽的寬度造成的，同一個原因還把長行鎖死在視窗寬，四百字元的一行永遠看不到後半截，現在真能捲到最右。捲軸滑塊也跟著內容走了：此前換過一個檔案之後它就僵在原地，內容捲到最後一行、滑塊還貼在頂端。兩條捲軸在右下角不再互相壓著，拖得到底、也拖得到最右。
- **設定頁的控制項回到中線上**。帶說明文字的列——設定裡絕大多數列都帶——開關和下拉此前一律停在上半截，一整張卡片疊起來就是右邊一欄全體偏上。側邊欄座右銘輸入框下面那行重複的預覽也拿掉了。
- **一次失敗只判一次**。「該不該重試」以前在四個地方各判一次，四份名單互不知情，於是同一個故障在這一層算可以再試、在下一層算沒救了，設定裡寫著「無限重試」而請求在第一次就放棄。現在只有明確「再問一百遍也是這個答覆」的才不重試，沒見過的錯法一律再試一次。介面上，一次自己好了的連線抖動留一行灰字，而不是一片紅。
- **截圖裡的標註文字不再遺失**。寫在標註框裡、還沒點別處提交的那幾個字，按「完成」時會一起進到圖裡；「置頂」和「下載」走的是同一次裁切，一併修好。
- **能點的看起來能點，捲得動的捲起來不留白**。任務面板往下捲不再撞上一大片空白——它的虛擬清單從來沒掛上捲動監聽，可見區間一直停在最初的四十列；快速拖動捲軸不再閃出白屏；捲軸不再壓住最右邊幾個字元；選單項、樹狀列這些此前被漏掉的元素，現在也跟著「使用指標游標」顯示手型。

<!-- lyra:notes en -->

### New

- **The composer starts as tall as you want it.** Appearance › Preferences now has a slider from 1 to 10 lines, with a live preview under it — the preview borrows the real composer's border, type size, line height and sizing formula, so whatever you see at a given notch is the actual thing. Long prompts no longer begin life in a one-line slot.
- **You decide how eagerly subagents get spawned.** Settings › Delegation, four levels: follow the thinking level (the default, and the only behaviour there used to be), eager, conservative, and off. "Off" stops the model from deciding on its own; agents you @-mention by name still run.
- **Release notes follow your interface language.** Whichever language Lyra is set to, that is the language these notes appear in.

### Fixed

- **File preview scrollbars.** The horizontal bar that sat under every short file — always there, and movable by only a few dozen pixels — is gone. It came from the content box being measured a gutter's width too wide, and the same cause pinned long lines to the viewport width, so the back half of a 400-character line was unreachable. It now really does scroll to the end. The thumb tracks the content again, too: it used to freeze after you switched files, leaving it stuck at the top while the content sat on the last line. And the two bars no longer overlap in the corner, so you can drag all the way to the bottom and to the right.
- **Settings controls sit on the centre line.** In rows that carry description text — which is most of them — switches and dropdowns used to stop in the upper half, so a whole card read as a right-hand column floating high. The duplicate preview under the sidebar motto field is gone as well.
- **One failure, judged once.** Whether something was worth retrying used to be decided in four separate places with four lists that knew nothing of each other, so the same fault could be retryable at one layer and fatal at the next — the setting said "retry forever" while the request gave up on the first try. Now only what will definitely give the same answer a hundred times over is fatal; an error shape nobody has seen before gets retried. On screen, a connection hiccup that resolves itself leaves a single grey line instead of a wall of red.
- **Annotation text no longer falls out of screenshots.** Words still sitting in the annotation field — not yet committed by clicking away — now make it into the image when you press Done. Pin and Download share the same crop and were fixed along with it.
- **What looks clickable is clickable, and what scrolls no longer goes blank.** Scrolling the task panel no longer runs into a wall of empty space: its virtual list never had its scroll listener attached, so the visible range stayed at the first forty rows forever. Dragging a scrollbar quickly no longer flashes empty. Scrollbars no longer sit on top of the rightmost characters. And menu items, tree rows and other elements that "Use pointer cursor" had missed now show the hand as well.

<!-- lyra:notes ja -->

### 新機能

- **入力欄の初期の高さを自分で決められます。** 外観 › 環境設定にスライダーを追加しました。1 行から 10 行まで、下にはライブプレビューが付きます。プレビューは実際の入力欄と同じ枠線・文字サイズ・行高・計算式を使っているので、目盛りを動かして見えるものがそのまま実物です。長い依頼を書くときに、毎回 1 行から広げていく必要はもうありません。
- **サブエージェントをどれだけ積極的に使うか、指定できます。** 設定 › サブエージェント配分に 4 段階。思考レベルに従う（既定であり、これまで唯一の挙動）、積極的、控えめ、オフ。「オフ」が止めるのはモデルの独断だけで、メッセージ内で @ で名指ししたものは従来どおり動きます。
- **リリースノートが表示言語に追従します。** Lyra をどの言語にしていても、「バージョン情報」のこの説明はその言語で表示されます。

### 修正

- **ファイルプレビューのスクロールバー。** 短いファイルの下に常に居座り、しかも数十ピクセルしか動かなかった横バーがなくなりました。原因は内容ボックスの幅が行番号欄のぶんだけ余計に測られていたことで、同じ原因で長い行がビューポート幅に固定され、400 文字の行の後半には決して届きませんでした。今は本当に右端までスクロールします。つまみも再び内容に追従します。以前はファイルを切り替えたあとで固まってしまい、内容が最終行にあるのにつまみは上端に貼り付いたままでした。2 本のバーが隅で重ならなくなったので、いちばん下にも右端にもドラッグで届きます。
- **設定画面のコントロールが行の中心線に揃いました。** 説明文のある行——設定のほとんどの行がそうです——では、スイッチやドロップダウンが上半分で止まっており、カード全体では右側の列がまとめて上に浮いて見えていました。サイドバーのモットー入力欄の下にあった重複表示も削除しました。
- **失敗の判定を一箇所に。** 「再試行すべきか」はこれまで 4 箇所で別々に判断され、4 つのリストは互いを知りませんでした。同じ障害がある層では再試行可能、次の層では致命的となり、設定に「無制限に再試行」と書いてあっても最初の一度で諦めていました。今は「百回聞いても同じ答えが返る」と明確に分かるものだけを致命的とし、見たことのないエラーの形は再試行します。画面上では、自然に復旧した接続の乱れは赤一色ではなく灰色の 1 行だけを残します。
- **注釈の文字がスクリーンショットから消えなくなりました。** 注釈欄に入力したまま、まだ他所をクリックして確定していない文字も、「完了」を押せば画像に入ります。「最前面に固定」と「ダウンロード」は同じ切り出しを使っているので、あわせて直りました。
- **押せそうなものは押せて、スクロールするものは白くなりません。** タスクパネルを下にスクロールしても広い空白に突き当たらなくなりました——仮想リストにスクロールリスナーが一度も付いておらず、表示範囲が最初の 40 行から動かなかったためです。スクロールバーを速くドラッグしても白く飛ばなくなり、スクロールバーが右端の文字に重ならなくなりました。メニュー項目やツリーの行など「ポインタカーソルを使う」が取りこぼしていた要素も、手の形になります。

<!-- lyra:notes ko -->

### 새 기능

- **입력창의 기본 높이를 직접 정할 수 있습니다.** 외관 › 환경설정에 1행부터 10행까지의 슬라이더를 넣고, 아래에 실시간 미리보기를 붙였습니다. 미리보기는 실제 입력창과 같은 테두리·글자 크기·줄 높이·계산식을 쓰므로, 눈금을 옮겨 보이는 것이 곧 실물입니다. 긴 요청을 쓸 때 매번 한 줄에서부터 늘려갈 필요가 없습니다.
- **서브에이전트를 얼마나 적극적으로 쓸지 고를 수 있습니다.** 설정 › 서브에이전트 배분에 네 단계 — 사고 수준을 따름(기본값이자 지금까지의 유일한 동작), 적극, 보수, 끔. '끔'이 막는 것은 모델의 독단이며, 메시지에서 @로 직접 지목한 것은 그대로 실행됩니다.
- **릴리스 노트가 인터페이스 언어를 따라갑니다.** Lyra를 어떤 언어로 쓰든, '정보' 화면의 이 설명은 그 언어로 나옵니다.

### 수정

- **파일 미리보기의 스크롤바.** 짧은 파일 아래에 늘 자리 잡고 있으면서 수십 픽셀밖에 움직이지 않던 가로 막대가 사라졌습니다. 내용 상자의 너비가 줄 번호 칸만큼 더 크게 측정된 탓이었고, 같은 원인으로 긴 줄이 뷰포트 너비에 묶여 400자짜리 줄의 뒷부분에는 결코 닿을 수 없었습니다. 이제는 정말 오른쪽 끝까지 스크롤됩니다. 손잡이도 다시 내용을 따라갑니다. 이전에는 파일을 바꾼 뒤 그대로 굳어, 내용은 마지막 줄에 있는데 손잡이는 맨 위에 붙어 있었습니다. 두 막대가 모서리에서 겹치지 않게 되어 맨 아래와 맨 오른쪽까지 끌 수 있습니다.
- **설정 화면의 컨트롤이 행의 중심선에 놓입니다.** 설명 문구가 있는 행 — 설정의 대부분이 그렇습니다 — 에서 토글과 드롭다운이 위쪽 절반에 멈춰 있어, 카드 전체로 보면 오른쪽 열이 통째로 떠 보였습니다. 사이드바 좌우명 입력란 아래에 같은 문장을 한 번 더 보여주던 미리보기도 없앴습니다.
- **실패는 한 번만 판단합니다.** '다시 시도할 만한가'를 지금까지 네 곳에서 따로 판단했고, 네 목록은 서로를 몰랐습니다. 같은 장애가 한 계층에서는 재시도 가능, 다음 계층에서는 치명으로 갈렸고, 설정에 '무한 재시도'라고 적혀 있어도 요청은 첫 번째에 포기했습니다. 이제는 '백 번을 물어도 같은 답'이 분명한 것만 치명으로 보고, 처음 보는 오류 형태는 다시 시도합니다. 화면에서는 스스로 회복된 연결 끊김이 붉은 화면 대신 회색 한 줄만 남깁니다.
- **주석 글자가 스크린샷에서 사라지지 않습니다.** 주석 입력란에 남아 있고 아직 다른 곳을 눌러 확정하지 않은 글자도 '완료'를 누르면 이미지에 함께 들어갑니다. '항상 위'와 '다운로드'는 같은 잘라내기를 쓰므로 함께 고쳐졌습니다.
- **눌릴 것처럼 보이면 눌리고, 스크롤되는 것은 비지 않습니다.** 작업 패널을 아래로 스크롤해도 넓은 빈 공간에 부딪히지 않습니다 — 가상 목록에 스크롤 리스너가 한 번도 붙은 적이 없어 표시 범위가 처음 40행에 머물러 있었습니다. 스크롤바를 빠르게 끌어도 흰 화면이 스치지 않고, 스크롤바가 오른쪽 끝 글자를 덮지 않습니다. 메뉴 항목과 트리 행처럼 '포인터 커서 사용'이 놓쳤던 요소들도 이제 손 모양이 됩니다.

<!-- lyra:notes fr -->

### Nouveautés

- **La hauteur initiale du champ de saisie vous appartient.** Apparence › Préférences reçoit un curseur de 1 à 10 lignes, avec un aperçu en direct en dessous — l'aperçu emprunte au vrai champ sa bordure, sa taille de texte, son interligne et sa formule de calcul, si bien que ce que vous voyez à un cran donné est la chose elle-même. Les demandes longues ne commencent plus dans une fente d'une ligne.
- **C'est vous qui décidez de l'empressement à déléguer.** Réglages › Délégation, quatre niveaux : suivre le niveau de réflexion (le défaut, et le seul comportement qui existait), empressé, prudent, désactivé. « Désactivé » empêche le modèle de décider seul ; les agents que vous nommez avec @ s'exécutent toujours.
- **Les notes de version suivent la langue de l'interface.** Quelle que soit la langue de Lyra, c'est dans cette langue que ces notes s'affichent.

### Corrections

- **Les barres de défilement de l'aperçu de fichier.** La barre horizontale installée sous chaque fichier court — toujours présente, et ne se déplaçant que de quelques dizaines de pixels — a disparu. Elle venait d'une boîte de contenu mesurée trop large de la largeur de la gouttière, et la même cause bloquait les longues lignes à la largeur de la fenêtre : la seconde moitié d'une ligne de 400 caractères restait inatteignable. Elle défile désormais vraiment jusqu'au bout. Le curseur suit à nouveau le contenu : il se figeait après un changement de fichier, restant collé en haut alors que le contenu était à la dernière ligne. Et les deux barres ne se chevauchent plus dans le coin, on peut donc glisser jusqu'en bas et jusqu'à droite.
- **Les contrôles des réglages reviennent sur la ligne médiane.** Dans les lignes accompagnées d'un texte explicatif — c'est-à-dire la plupart — interrupteurs et menus s'arrêtaient dans la moitié supérieure, si bien qu'une carte entière donnait l'impression d'une colonne de droite flottant vers le haut. L'aperçu qui répétait la devise sous son propre champ a également été retiré.
- **Un échec, jugé une seule fois.** « Faut-il réessayer » se décidait jusqu'ici en quatre endroits, avec quatre listes qui s'ignoraient : la même panne pouvait être réessayable à une couche et fatale à la suivante — le réglage annonçait « réessayer indéfiniment » pendant que la requête abandonnait au premier essai. Désormais, seul ce qui donnera assurément la même réponse cent fois de suite est fatal ; une forme d'erreur jamais vue est réessayée. À l'écran, un accroc de connexion qui se résout tout seul laisse une seule ligne grise au lieu d'un mur rouge.
- **Le texte d'annotation ne disparaît plus des captures.** Les mots encore présents dans le champ d'annotation — pas encore validés par un clic ailleurs — entrent désormais dans l'image quand vous appuyez sur Terminé. Épingler et Télécharger utilisent le même recadrage et ont été corrigés avec.
- **Ce qui semble cliquable l'est, et ce qui défile ne devient plus blanc.** Faire défiler le panneau des tâches ne se heurte plus à une large zone vide : sa liste virtuelle n'avait jamais reçu son écouteur de défilement, la plage visible restait donc aux quarante premières lignes. Tirer rapidement une barre de défilement ne provoque plus d'éclair blanc. Les barres ne recouvrent plus les derniers caractères à droite. Enfin, les éléments de menu, les lignes d'arborescence et d'autres éléments oubliés par « Utiliser le curseur pointeur » affichent désormais la main eux aussi.

<!-- lyra:notes ru -->

### Новое

- **Высоту поля ввода задаёте вы.** В «Оформление › Предпочтения» появился ползунок от 1 до 10 строк и живой предпросмотр под ним — предпросмотр берёт у настоящего поля ту же рамку, кегль, интерлиньяж и ту же формулу расчёта, так что на любом делении вы видите именно то, что получите. Длинные запросы больше не начинаются в щели высотой в одну строку.
- **Насколько охотно порождать субагентов — решаете вы.** «Настройки › Делегирование», четыре ступени: следовать уровню рассуждения (по умолчанию, и единственное прежнее поведение), охотно, сдержанно, выключено. «Выключено» останавливает самодеятельность модели; агенты, названные вами через @, запускаются по-прежнему.
- **Примечания к выпуску следуют языку интерфейса.** На каком языке у вас Lyra — на том языке и этот текст в разделе «О программе».

### Исправлено

- **Полосы прокрутки в просмотре файлов.** Горизонтальная полоса, постоянно сидевшая под каждым коротким файлом и сдвигавшаяся лишь на несколько десятков пикселей, исчезла. Причина — блок содержимого измерялся шире на ширину поля с номерами строк; та же причина запирала длинные строки шириной окна, и вторая половина строки в 400 символов оставалась недостижимой. Теперь прокрутка действительно доходит до конца. Ползунок снова следует за содержимым: раньше он застывал после переключения файла — содержимое на последней строке, а ползунок прижат к верху. И две полосы больше не перекрываются в углу, так что дотянуть перетаскиванием можно и до низа, и до правого края.
- **Элементы управления в настройках вернулись на среднюю линию.** В строках с пояснительным текстом — а таких в настройках большинство — переключатели и списки останавливались в верхней половине, и вся карточка читалась как правый столбец, всплывший вверх. Убран и повтор девиза под его же полем ввода.
- **Одна неудача — одно решение.** «Стоит ли повторять» решалось в четырёх местах по четырём спискам, которые не знали друг о друге: один и тот же сбой на одном слое считался повторяемым, а на следующем — фатальным; в настройках значилось «повторять бесконечно», а запрос сдавался с первой попытки. Теперь фатально лишь то, что заведомо ответит так же и на сотый раз, а незнакомая форма ошибки повторяется. На экране самостоятельно устранившийся сбой связи оставляет одну серую строку вместо красной стены.
- **Текст аннотации больше не пропадает со снимков.** Слова, ещё стоящие в поле аннотации и не подтверждённые щелчком в стороне, теперь попадают в изображение при нажатии «Готово». «Закрепить» и «Скачать» используют ту же обрезку и исправлены вместе с ним.
- **То, что выглядит нажимаемым, нажимается, а прокручиваемое не белеет.** Прокрутка панели задач больше не упирается в широкую пустоту: её виртуальный список так и не получил обработчика прокрутки, и видимый диапазон навсегда оставался на первых сорока строках. Быстрое перетаскивание полосы прокрутки больше не даётбелой вспышки. Полосы больше не накрывают крайние правые символы. А пункты меню, строки дерева и прочие элементы, которые пропускала настройка «Указательный курсор», теперь тоже показывают руку.

## [0.9.2](https://github.com/kittors/Lyra/releases/tag/v0.9.2) - 2026-09-07

### 修复

- **desktop**: 全屏的面板不再被系统按钮压住，窄列的正文回到中间 ([4aa28a7](https://github.com/kittors/Lyra/commit/4aa28a73e4a7ca6f8e11d695eb0fef82dba6d6a4))
- **desktop**: 交付卡片的预览贴回文件行，审核弹窗改成读代码的版式 ([b9eaa56](https://github.com/kittors/Lyra/commit/b9eaa56ea721f809fa70d6f05cf62cd9f649f649))

## [0.9.1](https://github.com/kittors/Lyra/releases/tag/v0.9.1) - 2026-09-07

### 新功能

- 整合子智能体派活控制、模型切换与交付卡片交互修复 ([e8d2393](https://github.com/kittors/Lyra/commit/e8d2393db4578a4e2ff13703b566471dc859b611))
- **desktop**: 截图工具栏放大可拖动，新增置顶到桌面与下载 ([bab5782](https://github.com/kittors/Lyra/commit/bab578204a6fd9dd96a46349c09647ea171ea99e))

### 修复

- **desktop**: 一轮干净结束后按钮回到发送，不再显示「继续」 ([21a9b6a](https://github.com/kittors/Lyra/commit/21a9b6a9af9d62962522c4ac516ca40525c60120))
- **desktop**: 修复流式过程中转录区停止跟随底部 ([8ec1918](https://github.com/kittors/Lyra/commit/8ec1918482b181213472e7e95175865fe48bb52a))
- **desktop**: 连拍截图不再把上一次的浮层拍进去 ([c5485ba](https://github.com/kittors/Lyra/commit/c5485bac394995c370b96424a147006d063c7421))

### 文档

- 补上 macOS 屏幕录制权限的重置办法 ([4236be0](https://github.com/kittors/Lyra/commit/4236be04f9e732923b3f437a964bb043e8f6fca0))

## [0.9.0](https://github.com/kittors/Lyra/releases/tag/v0.9.0) - 2026-09-07

### 新功能

- 重试策略实时生效与用量图表重做 ([05ecacc](https://github.com/kittors/Lyra/commit/05ecacc5ea561129da1e0cd09d8d824f93aff78e))
- **desktop**: 支持智能体定义编辑与重试策略配置并优化轨迹检查器 ([33a1f29](https://github.com/kittors/Lyra/commit/33a1f29985e53fba79b37e2d53c7f36dc7d99fdb))
- **desktop**: 整合模型目录与默认智能体并修复轨迹和菜单交互 ([e96c42a](https://github.com/kittors/Lyra/commit/e96c42a8fe9db787ac19cf0056b7a6f5a9ff30c2))
- **desktop**: 在模型需要协助且应用处于后台时发送系统通知 ([c954526](https://github.com/kittors/Lyra/commit/c954526e6270a08a628d61fba809c782b9dfd86e))
- **desktop**: 增加任务完成应用内通知与多任务状态感知 ([52b3e4b](https://github.com/kittors/Lyra/commit/52b3e4bc3b100546932529b6094e7216598da362))
- **desktop**: 技能与会话提及胶囊化、静默注入与交互式选项卡 ([8e2f6cb](https://github.com/kittors/Lyra/commit/8e2f6cbea9d878ef08a26fad1aa1dcba42e12988))
- **core**: 引入 ask_user 工具并优化 Agent 停顿催促与选项交互 ([6711341](https://github.com/kittors/Lyra/commit/6711341645f890f641345607b5d3c85297014acf))
- **desktop**: 输入框支持 @ 智能提及多源上下文与会话深度引用 ([77288a3](https://github.com/kittors/Lyra/commit/77288a32f7d2ebfed556a56e81d38a8673330d5e))
- **desktop**: 增加任务完成时的系统通知提示 ([55e6a9a](https://github.com/kittors/Lyra/commit/55e6a9ab08a274e8706efc157638f3ef903eeda7))
- **desktop**: 侧边栏支持项目与项目内会话上下拖拽重排 ([d6ac5c5](https://github.com/kittors/Lyra/commit/d6ac5c50b323d17b514ea3351ba01e3b1197cedd))
- **core**: 支持配置独立模型角色 @compact 用于上下文压缩 ([49dffe6](https://github.com/kittors/Lyra/commit/49dffe62ed9631099dee62960d8ebf4dcd3af482))
- **core,desktop**: 支持开局长消息智能标题总结与开关配置 ([886540b](https://github.com/kittors/Lyra/commit/886540b8d2cf732fbff18cac6377cf933467802b))
- **desktop**: 增加任务完成时的系统通知提示 ([a425796](https://github.com/kittors/Lyra/commit/a42579608b2223cdfc1075dfb75fbf44d3fd13f0))
- **desktop**: 技能与会话提及胶囊化、静默注入与交互式选项卡 ([1584fd2](https://github.com/kittors/Lyra/commit/1584fd2a9d749d94fb988bc766b333bc4f847d14))
- **core**: 引入 ask_user 工具并优化 Agent 停顿催促与选项交互 ([dc0e089](https://github.com/kittors/Lyra/commit/dc0e089abcba063ff2ff267e7f9630e66567202c))
- **desktop**: 输入框支持 @ 智能提及多源上下文与会话深度引用 ([da342b2](https://github.com/kittors/Lyra/commit/da342b22f48c5e5815cea9245b63a09e3d01f6c9))
- **desktop**: 侧边栏支持项目与项目内会话上下拖拽重排 ([401acd4](https://github.com/kittors/Lyra/commit/401acd45866e8230ca9f183ab9a72df0bee32989))
- **core**: 支持配置独立模型角色 @compact 用于上下文压缩 ([5c13459](https://github.com/kittors/Lyra/commit/5c1345935a1a72bfa3069bdfea764dd35ab4b81b))
- **desktop**: 整合模型目录、浏览器与轨迹待发布功能 ([1fce217](https://github.com/kittors/Lyra/commit/1fce217fb40327731a6ef3f4edb4f1647a36bb4d))
- **core,desktop**: 会话上下文治理与交互体验打磨 ([1d1bee7](https://github.com/kittors/Lyra/commit/1d1bee7487f490d17007126411d6532975739323))
- **desktop**: 交互打磨与稳定性增强 ([58027dc](https://github.com/kittors/Lyra/commit/58027dce4386964263846ef82bf4e6d1e34e24b9))
- **desktop**: 统一原生窗口 chrome 高度与 macOS 红绿灯垂直对齐 ([2205b84](https://github.com/kittors/Lyra/commit/2205b84052c01888bbd5bf584f035c96b8812e53))
- **desktop**: Windows 桌面适配与原生快捷键规范 ([779b9d9](https://github.com/kittors/Lyra/commit/779b9d9a53dffb6935007f2d75004bf82f6268d1))
- **desktop**: 对话渲染与阅读位置——行的身份、按需挂载、两种缓存；上下文仪表列出记忆文件 ([706fa1c](https://github.com/kittors/Lyra/commit/706fa1c22badee3999e72e1b662238b0c79e5f87))
- **core**: 过期记忆压不过代码；单独调 todo 的那一轮被提醒；压缩对照做成测试 ([04acaf7](https://github.com/kittors/Lyra/commit/04acaf757feb6a05b3a61afd121e190d3afe08ad))
- **desktop**: 子 Agent 的结构化输出按形状渲染；/skill:x 句中触发接上；组件测试能挂载整条对话链 ([c9be3d3](https://github.com/kittors/Lyra/commit/c9be3d31ff4cf0c4201210af90751ef95efa6927))
- **core**: /skill:x 嵌在句中也认；流规则的缓冲量可读 ([2a10043](https://github.com/kittors/Lyra/commit/2a100434df222efbba0a6953c5b0e03e0b34cab4))
- **desktop**: 首次进入带其他工具配置的项目时提示一次：已经在用 ([84b0b01](https://github.com/kittors/Lyra/commit/84b0b01c601d0b070136ccbdd505cf40facdb30f))
- **core**: 算出这个仓库里其他工具的配置有哪些、各几条 ([d6ae369](https://github.com/kittors/Lyra/commit/d6ae3692c420290616986530965aa6b394c44406))
- **desktop**: 被项目配置替换的设置，页面上说「不生效」 ([abe65dd](https://github.com/kittors/Lyra/commit/abe65dd4a0ab44ed2b7ebbca7a51b44f61b1631c))
- **core**: 算出项目层整体替换了哪些全局值 ([9ce7a1b](https://github.com/kittors/Lyra/commit/9ce7a1bc93272daf3c291408344e8d99ed04c867))
- **desktop**: 插件页加「扩展」标签——加载状态、订阅的事件、调用次数与 p95、最近错误、熔断 ([93e6b64](https://github.com/kittors/Lyra/commit/93e6b6488cbaaf85f6b6012c7650138756c75c47))
- **core**: 扩展宿主记下每个事件的调用次数、耗时与错误，并暴露给设置页 ([5947fe7](https://github.com/kittors/Lyra/commit/5947fe7bb6d75344b0a8020ed9d9e13cefaf42ec))
- **desktop**: 记忆页每条显示来源、写下时间与最后注入时间，项目记忆也列出来 ([fe10dc6](https://github.com/kittors/Lyra/commit/fe10dc6ab9aaeacc2f316e75f40188fbeee72e3d))
- **core**: 记下每条记忆最后一次进提示词是什么时候 ([19d1c62](https://github.com/kittors/Lyra/commit/19d1c62caed90ee8a7ce61f73927a7ed54265aba))
- **desktop**: 同名冲突能看差异、能一键改用，写完说写到了哪 ([d644791](https://github.com/kittors/Lyra/commit/d64479186d84748cfb4b5d33f5834cb17a744b4f))
- **core**: 同名冲突可以指定谁赢——一条 kind:name → path 的偏好 ([80c7ffa](https://github.com/kittors/Lyra/commit/80c7ffa1855366f5fe78007990fed15999792428))
- **desktop**: 规则页能拿最近的对话试正则 ([76a1051](https://github.com/kittors/Lyra/commit/76a1051efb29e32ea20bf5a5095987b65239d408))
- **core**: 正则条件的编译单独成模块，给渲染端同一套「什么算坏正则」 ([c9c6f55](https://github.com/kittors/Lyra/commit/c9c6f5583debbd65ddd3d80bfe9fd9fabfed03df))
- **desktop**: Agent Hub 画派生树、算合计成本，派发时自己打开 ([840b2b3](https://github.com/kittors/Lyra/commit/840b2b317ad37e24bedaf29a81d8c3b2636185c4))
- **core**: 子 Agent 的记录知道谁派的它、第几层、花了多少 ([8327fba](https://github.com/kittors/Lyra/commit/8327fbac8d54912b5ffe8e09e0ae06a751603fd9))
- **core**: /commit 能找到 git:commit——菜单早就能，分派一直不能 ([180d55c](https://github.com/kittors/Lyra/commit/180d55c5f89adce6919ab4717f5b38fc05acc1bd))
- **core**: 技能描述短于 40 字符产出 warning ([c3275c4](https://github.com/kittors/Lyra/commit/c3275c453f3096c136eb5a303484123de302ddb0))
- **core**: 语言服务器空闲十分钟后回收 ([97daf8c](https://github.com/kittors/Lyra/commit/97daf8cd8e63e105583cb08660a59f0d1afa74af))
- **core**: verify 与 plan 两个内置 agent ([4f444a9](https://github.com/kittors/Lyra/commit/4f444a9751faaaad6867a1e94a2687157962578d))
- **core**: 读 .agent/ 与 .agents/——跨工具的社区约定 ([9697b65](https://github.com/kittors/Lyra/commit/9697b653e9d5eb59fe7db4b05a179279bfc3ec96))
- **core**: context-file 经注册表——第 14 个「声明了、没接上」 ([fdfd90e](https://github.com/kittors/Lyra/commit/fdfd90eccfcac05b6b06b31047306c3945f01cfb))
- **core**: 裸的 cat/grep/find/ls 改道到专用工具，管道放行 ([fb0b525](https://github.com/kittors/Lyra/commit/fb0b525578402cd0ffcc188d0604b62d93edebf1))
- **core**: 从会话里长出技能，而且必须有人点头才生效 ([5ccbec6](https://github.com/kittors/Lyra/commit/5ccbec6d1a26a09f517cf769f2ca96675c8310be))
- **core**: 内建命令进注册表，命令可以声明怎么送出去 ([d0e11d6](https://github.com/kittors/Lyra/commit/d0e11d6ddf614c5a5afdfac3c11e6fe3c3a6d061))
- **core**: 地址空间补齐到九个 scheme ([cee1680](https://github.com/kittors/Lyra/commit/cee1680bbb3a1a3569855a999286f26b3ad3f7b4))
- **core**: 行为准则可以用文件换掉，整段提示词有了快照 ([b45bac7](https://github.com/kittors/Lyra/commit/b45bac7ae5b52a0d538e7082391f4ec35a74cc4c))
- **core**: 读 Gemini 与 Codex 的规则，并把个人级目录的开关真正接上 ([a02e000](https://github.com/kittors/Lyra/commit/a02e0000abe36fe6c3b71913886730e0f8721fd5))
- 并入 agent 系统改造（36 个提交） ([72d0d18](https://github.com/kittors/Lyra/commit/72d0d1814d0a80e0f4d285971af8a2c288198c4c))
- **desktop**: 规则管理页——规则终于看得见、关得掉 ([1e63417](https://github.com/kittors/Lyra/commit/1e63417d43b054fa3b455fe4b510963dcb4fe15c))
- **core**: 能力热重载——改一个技能文件，不用重启窗口 ([2c23974](https://github.com/kittors/Lyra/commit/2c23974173ad21bad41035731841b478de01a7e8))
- **desktop**: 模型角色的设置界面，以及一个吞掉保存的监听器 ([12c4aa8](https://github.com/kittors/Lyra/commit/12c4aa8fad1b11c30d45ebdb89240a2cf0ee1482))
- **core**: 后台抽取真的跑起来——补上从没写过的那半边 ([f18b8e1](https://github.com/kittors/Lyra/commit/f18b8e109a7a6ed1652f03c112841e701420c2d6))
- **rules**: 把这次纠正变成一条规则 ([094e7ec](https://github.com/kittors/Lyra/commit/094e7ec55d3df9cc0085f96bc0bf171f55953ea0))
- **core**: 身份覆盖接进会话，补上模板的测试 ([33f6673](https://github.com/kittors/Lyra/commit/33f66730ba10499e800dcaa451055b0b6531d85e))
- **core**: 提示词模板与项目可替换的身份段 ([eed60fa](https://github.com/kittors/Lyra/commit/eed60fa539581a30997f37ce256f6138b6c9f943))
- **core**: 扩展接进会话——`.lyra/extensions/` 里的东西真的会被调用 ([10e9600](https://github.com/kittors/Lyra/commit/10e960097472162315b951e1916e1b0cd02b6708))
- **core**: 扩展宿主——装别人的行为，而不是把会话的稳定性交出去 ([8a6c77e](https://github.com/kittors/Lyra/commit/8a6c77e561450bd7ebd4f327cf999b52307304da))
- **core**: 后台从会话里抽取记忆，默认关闭 ([647e810](https://github.com/kittors/Lyra/commit/647e8102893ba5296eef428399e124d5e367ca05))
- **core**: 项目级配置——一个仓库可以有自己的模型与策略 ([73bd102](https://github.com/kittors/Lyra/commit/73bd1020ec7c2e60e5e3db672e891264df1ad432))
- **core**: 剪枝的三条时机判断——小结果、无信息结果、缓存 ([bc22b76](https://github.com/kittors/Lyra/commit/bc22b7693d1eeeba9840074240245d6a03d73c06))
- **core**: 模型角色——子代理终于会用它自己声明的模型 ([8dfff0c](https://github.com/kittors/Lyra/commit/8dfff0c3de1fee671e148d8a7e7ed5957269bb40))
- 设置页说出同名技能被谁覆盖了 ([1a8b6d9](https://github.com/kittors/Lyra/commit/1a8b6d983ddf1d94854e9e16a990b31d45ecb412))
- **core**: 技能的 allowed-tools 开始真的生效 ([2b10b95](https://github.com/kittors/Lyra/commit/2b10b95614d4492664f4b389714e7583edd00ea7))
- **desktop**: 规则命中在对话里有了卡片，此前它完全不可见 ([c558287](https://github.com/kittors/Lyra/commit/c5582878dcc38729a2ec4726fab060a7be7be510))
- **core**: 代码理解层——改导出符号时知道谁在用它 ([1f8e64c](https://github.com/kittors/Lyra/commit/1f8e64c32a9001c72f216ce8d76cf3c3042fe7d5))
- **core**: 项目记忆与 learn 工具——同一件事不用教第二遍 ([0b6b103](https://github.com/kittors/Lyra/commit/0b6b103889cf85a6b62f7592e64ea295801bd6a4))
- **core**: agent:// 让父代理按字段路径取子代理的结果 ([879afd9](https://github.com/kittors/Lyra/commit/879afd980e217df5ca135aac301976be6bb126b4))
- **core**: 派生守卫——并发排队、深度上限、自递归拦截 ([33dd02d](https://github.com/kittors/Lyra/commit/33dd02dc529334a0a8d405f6eaa982b1b3e43eda))
- **core**: 子代理交付结构化结果，不再是一段要重新解析的散文 ([29dc957](https://github.com/kittors/Lyra/commit/29dc9578f9ae37cdecd508bb8e316ccbc22cb3a5))
- **core**: 内部地址空间——不加新工具，扩展 read 的寻址范围 ([cabae3c](https://github.com/kittors/Lyra/commit/cabae3cb0022eb3a8a3e595baa9da986e9713c73))
- **core**: 能力发现层——五处手写循环收敛成一个注册表 ([f42ffad](https://github.com/kittors/Lyra/commit/f42ffad6d2af2aa3eb3cfc442367cefbbc622d63))
- **core**: interrupt: never 的规则不再静默失效 ([363ecf2](https://github.com/kittors/Lyra/commit/363ecf2818f9a2ef5dfafd8e04b9882fe479506d))
- **core**: 读别家的规则文件，并带三条开箱可用的内置规则 ([2a60cf8](https://github.com/kittors/Lyra/commit/2a60cf8dd30527f354825f050b2e8e19bb1c3593))
- **core**: 规则系统与流式纠偏，说过一次就不用再说 ([527933a](https://github.com/kittors/Lyra/commit/527933ad8eb95ab7c5ff01836aa8daacd6a486e9))
- **core**: read 对长源码文件返回结构视图，上下文省 66% ([295c236](https://github.com/kittors/Lyra/commit/295c236631972e05e5c1c5d85ce784eee1bfdc6d))
- **core**: edit 改用行锚定补丁格式，弱模型首次成功率 76% → 98% ([02c5594](https://github.com/kittors/Lyra/commit/02c559498fc82e13a69a377e3f719d413c415239))
- **sync,relay**: 白名单在启动时对账，中转加限流 ([0d0d76f](https://github.com/kittors/Lyra/commit/0d0d76f6a48ff323a196956b7ebc4eea5975f9cf))
- **ui**: 组件画廊，`pnpm gallery` ([c63b027](https://github.com/kittors/Lyra/commit/c63b02799a7122fe938350f0e9026d6a70df5a2c))
- **sync**: 手机发来的参数先校验再执行 ([5b8999d](https://github.com/kittors/Lyra/commit/5b8999dd0428dc24188085a76afdb9b8cb51f9b0))
- @lyra/contract——渲染进程与主进程那条线，写下来一次 ([e2d6d69](https://github.com/kittors/Lyra/commit/e2d6d694fa68540c220823df33b3892d1821c9c7))

### 修复

- **desktop**: 合入思考按发生顺序成行并逐字打印 ([a3f5574](https://github.com/kittors/Lyra/commit/a3f55744090d3107bc429586fff0a83315bfe312))
- **desktop**: 思考按发生顺序成行并逐字打印 ([bb84e98](https://github.com/kittors/Lyra/commit/bb84e981b73148913ccb28edacf20cdc16871b20))
- **desktop**: 统一智能体与侧聊模型并修正交付卡片和 Git 交互 ([feac773](https://github.com/kittors/Lyra/commit/feac773e3ab042b5800e849230f9061bdaccad7d))
- **desktop**: 稳定全屏按钮并消除项目切换竞态 ([aa172ae](https://github.com/kittors/Lyra/commit/aa172ae2ce4e9ea6b7636a6ec504309ed41b063d))
- **core**: 修复 Windows 后台服务普通停止失效 ([9c0c0a7](https://github.com/kittors/Lyra/commit/9c0c0a7671fc394236e7c3fe033e1bd298622790))
- **desktop**: 消除流水线切换闪现并精简空状态 ([5245936](https://github.com/kittors/Lyra/commit/52459362c53a2201fe60b1bb3b6b3f8cc96f0af1))
- **desktop**: 保证冷通知跳转遵循最后一次导航意图 ([203482e](https://github.com/kittors/Lyra/commit/203482ed25d1d8797be1c7493b8a09f7b1f94eca))
- **desktop**: 合并已审查的会话与交互提问修复 ([1706eba](https://github.com/kittors/Lyra/commit/1706eba65769b56db1e71a07a769b6814b6b5f61))
- **desktop**: 修正会话通知去重与冷启动跳转 ([516b447](https://github.com/kittors/Lyra/commit/516b447c47f3775b1e58128c8635291735e6f83f))
- **core,desktop**: 修复 CodeQL 扫描指出的字符类重复、参数冗余与正则回溯风险 ([74f231c](https://github.com/kittors/Lyra/commit/74f231c6c6863890ba4703bd427199e385b45054))
- **desktop**: 消除面板切换闪现和拖放落地跳位 ([6d0d21d](https://github.com/kittors/Lyra/commit/6d0d21dca251aed74bebdd28f26bd76485c8cd1d))
- **desktop**: 按面板实际空间调整窄窗口分屏方向 ([f7f35f3](https://github.com/kittors/Lyra/commit/f7f35f3aa35a2f485fdb95a91b7427b6afaf1e5d))
- **desktop**: 按面板实际空间调整窄窗口分屏方向 ([24ae9d4](https://github.com/kittors/Lyra/commit/24ae9d4cf16d2dea5d06bc5b17b4db49ece5b870))
- **electron**: 将更新安装包隔离到用户私有目录 ([4d49acd](https://github.com/kittors/Lyra/commit/4d49acd770030659fc210ec1ba0b73613c76427a))
- **desktop**: 固定引用图标尺寸并补齐真实问答回归 ([ba13176](https://github.com/kittors/Lyra/commit/ba1317612084e3db4df34bfc0c842174d8383309))
- **desktop**: 修正交互问答与上下文引用的会话隔离 ([96efa1b](https://github.com/kittors/Lyra/commit/96efa1bfbdddcb4b3445c7a3d4f9cc7553e2fbc1))
- **core,desktop**: 修复 CodeQL 扫描指出的字符类重复与正则回溯风险 ([0825e8c](https://github.com/kittors/Lyra/commit/0825e8cc1916d114f53db1e87ebae0b20bdd016d))
- **electron**: 统一完成通知与托盘的会话跳转 ([a72cb05](https://github.com/kittors/Lyra/commit/a72cb05a0155ccae559ead487780a526430fe29e))
- **desktop**: 严格隔离草稿与待确认会话消息 ([7cfa743](https://github.com/kittors/Lyra/commit/7cfa743d87416054a60de1a116fa4bdefe2c42a0))
- **desktop**: 隔离待确认用户消息，防止相同提示词的会话相互干涉 ([fd985bb](https://github.com/kittors/Lyra/commit/fd985bb71206e579178ce33963b307a069d8b40c))
- **desktop**: 修正侧栏拖拽范围与排序持久化 ([9d52854](https://github.com/kittors/Lyra/commit/9d5285434a0fce4b6bbc1a691496671a684869e6))
- **desktop**: 允许失败尾部就地重试 synthetic 继续指令 ([f325741](https://github.com/kittors/Lyra/commit/f32574168ad33e3541f9e8f3e06f8ae95189858b))
- **desktop**: 增加 editMessage 错误回滚与 abort 超时防死锁兜底 ([aef61e0](https://github.com/kittors/Lyra/commit/aef61e045e67d7415ce284d533f60849631c4f8f))
- **core**: 补全压缩模型路由并清理跨模型推理句柄 ([da14502](https://github.com/kittors/Lyra/commit/da145020e39cedc27ba572012ab0f71471e5797b))
- **core**: 补全 compactWith summarizer 传参偏移与 sub-agent 缺失导入 ([203869f](https://github.com/kittors/Lyra/commit/203869f687dfdc9da8d9018e4f022658e51ae763))
- **core**: 补全工具配对并等待编辑前的消息接收结束 ([97273e1](https://github.com/kittors/Lyra/commit/97273e13ee96f0022b3be34496d63312f3e3d097))
- **core**: 修复 truncateFrom 计算 cutoff 时导致 commandRuns 过滤不一致的问题 ([9f68097](https://github.com/kittors/Lyra/commit/9f6809798748f6bf4b15706b12f0d836490c4400))
- **core**: 修复会话截断序列号漂移与跨协议工具调用孤儿错误 ([235b26f](https://github.com/kittors/Lyra/commit/235b26f594319db2de23a8bec636dbe78391a473))
- **core**: editAndResend 处于执行态时先行终止等待，避免静默失败 ([5f72dd7](https://github.com/kittors/Lyra/commit/5f72dd7dd6427dd34dd298eaf723b075e868b123))
- **core**: 剪枝 Chat Completions 出站中的纯思考空回复与伴生提示 ([c552899](https://github.com/kittors/Lyra/commit/c552899527c2ab656a3f0938422be6ee616e5ba1))
- **core**: 增强 glob 与 grep 在未传 pattern 时的容错与回退提取 ([0a8ffa2](https://github.com/kittors/Lyra/commit/0a8ffa2e48b7ca28e016f93d4dcf2d40e7796370))
- **electron**: 暂停更新下载时保留已写入的字节 ([f3a81fa](https://github.com/kittors/Lyra/commit/f3a81fab8fb581fbad99364ad93386f027b22313))
- **desktop**: 消除菜单悬停滚动跳动并内缩滚动条 ([0053ac9](https://github.com/kittors/Lyra/commit/0053ac93bd71cfcfffdb608388b6756f511255fa))
- **core**: 修复跨平台能力监听与扩展入口加载 ([91c0311](https://github.com/kittors/Lyra/commit/91c03116327057da7734e4766564b3d38d5d4a1b))
- **core**: 取消标题时保留模型已报告的用量 ([06fd685](https://github.com/kittors/Lyra/commit/06fd6859149bf0b51a213f79ad856e64305357eb))
- **core**: 保证智能标题取消与手动命名的一致性 ([1a64cca](https://github.com/kittors/Lyra/commit/1a64ccad632f8efc8bb77af37fbcc51740fbc2a6))
- **core,desktop**: 修复 CodeQL 扫描指出的字符类重复、参数冗余与正则回溯风险 ([0c821b8](https://github.com/kittors/Lyra/commit/0c821b8a4d0da90d7381430a28a859d0f5d18a56))
- **core**: 修复桌面新建会话开局长消息未触发智能标题总结 ([3ef2b2a](https://github.com/kittors/Lyra/commit/3ef2b2a71e29907a43e5d6e04ac6f44b0f9ffda3))
- **core**: 修复会话截断序列号漂移与跨协议工具调用孤儿错误 ([6c9d6ed](https://github.com/kittors/Lyra/commit/6c9d6ed05c753b3069cfb94905f74c9d7010fcac))
- **desktop**: 允许失败尾部就地重试 synthetic 继续指令 ([d70ebef](https://github.com/kittors/Lyra/commit/d70ebef6340b79e6392fc8a6148c631331e035ea))
- **desktop**: 增加 editMessage 错误回滚与 abort 超时防死锁兜底 ([3e0d58e](https://github.com/kittors/Lyra/commit/3e0d58e11545fb0658ff7fb9645c51b76bcd4ce3))
- **core**: editAndResend 处于执行态时先行终止等待，避免静默失败 ([e2e1c9d](https://github.com/kittors/Lyra/commit/e2e1c9d230407eae5f54af66aafd85f7975f5ac1))
- **core**: 剪枝 Chat Completions 出站中的纯思考空回复与伴生提示 ([0435075](https://github.com/kittors/Lyra/commit/043507534473dbe345f156ce46016820381873f0))
- **core**: 增强 glob 与 grep 在未传 pattern 时的容错与回退提取 ([b0757f6](https://github.com/kittors/Lyra/commit/b0757f64b3b533956701de540377c6460f749b13))
- **desktop**: 隔离待确认用户消息，防止相同提示词的会话相互干涉 ([a9a75b1](https://github.com/kittors/Lyra/commit/a9a75b130e6456096141e0f8f4c7c249e195e8e1))
- **core**: 严格限制模式提取的分隔符为冒号或等号 ([d84ddbe](https://github.com/kittors/Lyra/commit/d84ddbef0eb1a94e1755c6243565291479254fa8))
- **core**: 修复被中止回合发送空 assistant 消息引发的 400 报错 ([c4e7fe4](https://github.com/kittors/Lyra/commit/c4e7fe417fca8fa2211d539052f844ee584a86f6))
- **desktop**: 打包检查不再把 node-pty 别的平台的预编译当错配，包里也不再带它们 ([8bfdb1a](https://github.com/kittors/Lyra/commit/8bfdb1a418c697bbd0a82064974a4705b6e6b68b))
- **desktop**: 终端的行距、字距不再跟着代码块的阅读设置走，光标改成细线 ([b77ca16](https://github.com/kittors/Lyra/commit/b77ca16726aff5c16d30a32dfffe9755677cb009))
- **desktop**: 别家配置的提示压成一行，「查看」去它真正在的地方 ([0ea6b0f](https://github.com/kittors/Lyra/commit/0ea6b0fc4ee2b43540c7315aa34a8b4b44cbea66))
- **sync**: 局部采用 #49——局域网地址排序与安卓 cleartext 配置 ([b2f0c8d](https://github.com/kittors/Lyra/commit/b2f0c8d13ebc7831fb09ff5a480cc62671c142fd))
- **mobile**: 并入 #43 补全 Expo 57 的安卓依赖矩阵 ([250d391](https://github.com/kittors/Lyra/commit/250d391b6119724df32bef775b0139fbcde0095d))
- **desktop**: 并入 #48 新会话不被迟到的模型切换覆盖，安卓应用图标 ([faa6322](https://github.com/kittors/Lyra/commit/faa6322dc1397cc2af101cfaa07d2b343cd045c4))
- **desktop**: 并入 #47 切换会话时保留回到底部意图 ([6e7be64](https://github.com/kittors/Lyra/commit/6e7be640312f8dc4ae65f3e1c4060e9f19af392c))
- **mobile**: 并入 #50 安卓输入框保持在键盘之上 ([a478d48](https://github.com/kittors/Lyra/commit/a478d48870ecab5f4ca24e86eba5891948c7570a))
- **core**: 并入 #51 glob 与 grep 从 description 里提取嵌入的模式 ([198a377](https://github.com/kittors/Lyra/commit/198a3778e11cc4c22d4a181adfaf3ae8c9feadd4))
- **core**: 严格限制模式提取的分隔符为冒号或等号 ([d5814fa](https://github.com/kittors/Lyra/commit/d5814fab60d4bca2f48b6e6c5d928b67a838022b))
- **core**: 增强 glob 与 grep 工具对 description 中嵌入模式的容错提取 ([2931fc3](https://github.com/kittors/Lyra/commit/2931fc3fc9dc5368c0d0e9f95af5ee802bd60b1a))
- **core**: 并入 #52 修复中止回合空 assistant 消息引发的 400 报错 ([f1e4b72](https://github.com/kittors/Lyra/commit/f1e4b722dceaeb1fc33a0b0d5ded851b9fc4b6be))
- **core**: 修复被中止回合发送空 assistant 消息引发的 400 报错 ([22de875](https://github.com/kittors/Lyra/commit/22de8755b42940a589f09901a680cc043da06a0d))
- **desktop**: 并入 #45 禁止远端 Git 调用弹出凭据窗口 ([becf51f](https://github.com/kittors/Lyra/commit/becf51ffe3f30085a0787d88210d8b066a539590))
- **core**: agent 文件里的 spawns、output、schemaMode 从来没被读过 ([35acdbc](https://github.com/kittors/Lyra/commit/35acdbc9a99a62703f218e6d4c1e3448e4e5dd15))
- **core**: 插件路径把技能 warning 压成了错误 ([dc8beca](https://github.com/kittors/Lyra/commit/dc8becaa6a80925b44eabaab00b8bd058c861c7d))
- **core**: 后台抽取写盘前脱敏，规则块加框定并做对抗评测 ([692839b](https://github.com/kittors/Lyra/commit/692839b209527c413c2c08d03295e6d166c9abbe))
- **desktop**: 并入工作区里未提交的界面与计时器改动 ([e6483ab](https://github.com/kittors/Lyra/commit/e6483ab1707f7e14c27ab00f4766a2920392f831))
- **core**: 扩展的五个事件里有四个从来不会到达 ([dd0b7c9](https://github.com/kittors/Lyra/commit/dd0b7c98c63af84ce2e7f49372a24946e220a637))
- **core**: 项目指令要往上找，日期要往后放 ([ca65368](https://github.com/kittors/Lyra/commit/ca653682ea04f8f28a5e3d5a81ad4aa15b127eee))
- **contract**: channel 名要合规——`projectMemory:` 的域不是小写词 ([98b6b3c](https://github.com/kittors/Lyra/commit/98b6b3cda0370b1de633d496f12208fb7c09d41e))
- **core**: 派生守卫与项目配置——两处「代码在、功能不在」 ([8a91abc](https://github.com/kittors/Lyra/commit/8a91abc2733af6446f9d2c4676c53d0980eccb1e))
- **core**: 能力层的来源字段改名 provenance，别再盖掉领域对象的 source ([b217cd4](https://github.com/kittors/Lyra/commit/b217cd432425163e95bcf54f252a155eab6803b0))
- **core**: 三处静默失效——被遮蔽的命令、未闭合的 frontmatter、空名册 ([fe9529e](https://github.com/kittors/Lyra/commit/fe9529ead9c7f898e7deffaabff6d2bfb948816d))
- **core**: 内置密钥规则对 sk-proj- 这类现行格式完全失明 ([fed39e2](https://github.com/kittors/Lyra/commit/fed39e22965348626b20f7dca5cfe051fd46aea1))
- **ui**: 并入界面细节打磨 ([9b0c7a7](https://github.com/kittors/Lyra/commit/9b0c7a77c3dfadeed00444efca78457685768b65))
- **ui**: 界面细节打磨——代码高亮、标签页、滚动锚定、主题与动效 ([907e754](https://github.com/kittors/Lyra/commit/907e75412ac3186ff586eedcb2bf0cd01b67402d))
- **update**: abort 下载时先把写流里缓冲的字节刷掉 ([9c04e3f](https://github.com/kittors/Lyra/commit/9c04e3fd976562236b68bdf085a47c551745cdbd))
- **update**: Windows 上暂停下载读到的字节数可能是 0 ([7c646b7](https://github.com/kittors/Lyra/commit/7c646b75614a28b791abcdf60cfa357b5b6683ea))
- **desktop**: App 改回同步加载——懒加载它让面板重放了入场动画 ([b4ee063](https://github.com/kittors/Lyra/commit/b4ee063aa62e66ccf67734d7ff4a6aa7ea8da810))
- **contract**: files.create 与 terminal.attach 在契约里丢了 ([caa9dc6](https://github.com/kittors/Lyra/commit/caa9dc68c97623413672414f62bc58bf664fe772))
- **screenshot**: 关窗时读已销毁窗口的 webContents ([05eeb6e](https://github.com/kittors/Lyra/commit/05eeb6ee54cba64fabc910055b82834ed9e5b984))
- **contract**: 绝对路径判断改用 node:path，并把它关在子入口里 ([cc86f73](https://github.com/kittors/Lyra/commit/cc86f73ea19ebf7760990f99807c35873404987d))
- **perf**: 建了功能域出口之后，四个视图又被打回主 chunk ([27ef931](https://github.com/kittors/Lyra/commit/27ef9316590496f94b13befe019561b4ba9c534f))
- **ui**: 样式表整个没生效——stylelint --fix 改坏了 Tailwind 的入口 ([aab3f58](https://github.com/kittors/Lyra/commit/aab3f587dc5944db09c6e803727232c366567693))
- **test**: test:ui 的 glob 改成 Windows 也能展开的写法 ([bf50ac7](https://github.com/kittors/Lyra/commit/bf50ac7248eb8ebcfceed3df04f9feb8fe58d843))
- **electron**: 更新包装之前先核对摘要，对不上就删掉 ([27d6be4](https://github.com/kittors/Lyra/commit/27d6be4c9d2388c031f135c1fcffd58b401def04))
- **electron**: 补上导航、webview 与权限三道守卫，外链只留一个口子 ([65ed857](https://github.com/kittors/Lyra/commit/65ed8572d036601a62ef93a6277db1b618e9140c))
- **deps**: 生产依赖的 11 个已知漏洞清零 ([558c116](https://github.com/kittors/Lyra/commit/558c1168579fa0475c3cca1b49c7e111d2e82188))
- **desktop**: 推送与同步按钮运行时使用极简 loading，并在悬停时展示取消图标 ([495c646](https://github.com/kittors/Lyra/commit/495c646838c4b97d6219ff2cc24b3bed0a830e03))
- **desktop**: adjust composer fit priority and handle text truncation ([fddb1cd](https://github.com/kittors/Lyra/commit/fddb1cd92c9a513b93728132fdfa0e01b4d4c884))

### 性能

- **desktop**: 截图窗口不再加载整个应用 ([7a58852](https://github.com/kittors/Lyra/commit/7a588522395a885f1d04092b8b0541035614bb44))
- **desktop**: 主 chunk 从 4.39MB 降到 1.69MB ([f8dbe0b](https://github.com/kittors/Lyra/commit/f8dbe0b02ebbf68c85cc38efe7bbd961e31aaac5))

### 重构

- **core**: 扫描器当场抓到我自己刚写的一条 ([867585d](https://github.com/kittors/Lyra/commit/867585d2e2181442eb55775c9a4c75100df490f8))
- **core**: 「等界面」是给死代码起的好听名字 ([854c3b4](https://github.com/kittors/Lyra/commit/854c3b4eb0fbdb5f05d4b815bececf664d858a5f))
- **electron**: preload 从契约生成，157 个 channel 字面量清零 ([5c4f346](https://github.com/kittors/Lyra/commit/5c4f34604e44226fe5ad337b3c1839beca6543fe))
- **ui**: 每个域一个出口，浮层共用一个挂载点 ([4929da1](https://github.com/kittors/Lyra/commit/4929da14410d3eaf836ea86c9971b8e94face5e0))
- **ui**: 按钮与动效各自收成一处 ([0d0f290](https://github.com/kittors/Lyra/commit/0d0f290c8183383aff44c33900f49228e2c3c4bc))
- **desktop**: 渲染进程按域分目录，components/ 退场 ([d2ad2bd](https://github.com/kittors/Lyra/commit/d2ad2bdf90bb5e52f1d92723ffe00128e0f4aa0e))
- **desktop**: 纯逻辑进 lib，基础组件进 ui ([64db7c2](https://github.com/kittors/Lyra/commit/64db7c27158bea01d6d65663bee715a396693372))
- **desktop**: window.lyra 收进 services，87 个文件减到 2 个 ([e60ecea](https://github.com/kittors/Lyra/commit/e60ecea450e0f255e316bb09c2fd93ce1e3d932a))
- **ui**: styles.css 拆成 22 个按主题分的文件 ([9294f66](https://github.com/kittors/Lyra/commit/9294f66f99dc5803902bde1f2d5b6054e790445b))
- **mobile**: 上一代自绘界面退役，只留配对与 WebView 宿主 ([4ad5782](https://github.com/kittors/Lyra/commit/4ad578226ba512d184c3c13db46e7b346ae070a0))

### 文档

- **core**: lsp 的 guideline 改成「用它替代 grep」，而不是「另外还有它」 ([1e62d0b](https://github.com/kittors/Lyra/commit/1e62d0b6965e387d4f2bff950bf8bae2eab81987))
- 长会话量过了，不上虚拟列表 ([a8e405e](https://github.com/kittors/Lyra/commit/a8e405e48d25d2359260ae787442179fde79b217))
- 架构文档跟上新的目录，补两条 ADR ([532b1ac](https://github.com/kittors/Lyra/commit/532b1ac53e5d4ce517d8cf7e9c2f13f3e689bb6e))
- 记下 CI 上 e2e 的红线基线与比对方法 ([074d5c0](https://github.com/kittors/Lyra/commit/074d5c06581e64ed3bf65e637891f61390287417))
- 补上判断 e2e 红线是不是自己弄的那套方法 ([5383644](https://github.com/kittors/Lyra/commit/5383644affc6ac9d8fc1bf45af871c2f5001612f))
- 补上 README 指着的那三份文档，和它们本该说清的事 ([00f1a9c](https://github.com/kittors/Lyra/commit/00f1a9cf5af0fcfbf02f906df8df430f3a64861c))

## [0.8.36](https://github.com/kittors/Lyra/releases/tag/v0.8.36) - 2026-09-03

### 新功能

- **desktop**: 优化输入框窄屏自适应、模型菜单数字键与恢复用量统计 ([1daca56](https://github.com/kittors/Lyra/commit/1daca563167631b9eaa8c8b76d5d336fa8f9b0a1))
- 中转真的能转数据了——两端各自拨出去，在同一个房间里碰头 ([e6d9748](https://github.com/kittors/Lyra/commit/e6d974873a6af5eedb056c3c0444a28ea26c5257))
- 安卓的返回键会关掉一层，而不是直接退出应用 ([09bc3b9](https://github.com/kittors/Lyra/commit/09bc3b9662ea5f6fd509bce916c453f4bf6ef9f1))
- 抽屉跟着手指走，输入框不再被键盘压住 ([9fa96f3](https://github.com/kittors/Lyra/commit/9fa96f34acdf98694f5f180bde4d19a62f12b5f3))
- 手机上的设置只留下手机管得着的那些 ([f7702e3](https://github.com/kittors/Lyra/commit/f7702e35642197730c6d7a7851f2cd6f25fab272))
- **mobile**: 界面按手机来适配，并验证双向实时同步 ([cb37be9](https://github.com/kittors/Lyra/commit/cb37be9f310c453b1ad2db355c311aa073169ed0))
- **mobile**: 界面由桌面端托管，手机在 WebView 里装它 ([bc2a13b](https://github.com/kittors/Lyra/commit/bc2a13b70f1e482b3a4924c448e01c28bff00bb2))
- **mobile**: 手机跑桌面端自己的界面，而不是另做一套 ([4826bf2](https://github.com/kittors/Lyra/commit/4826bf27ef68ae93b0324017aace695235af87f7))
- **relay**: 中转服务，让两端都连不上对方时还能配对 ([fa1030f](https://github.com/kittors/Lyra/commit/fa1030f1cc7c468bdd2e45e602d331107b2f0612))
- **mobile**: 扫码配对，并让手机能走 https ([96ad208](https://github.com/kittors/Lyra/commit/96ad208fd5547c53d4bc058f9fdca0e6a9c947f4))
- **sync**: 配对改成扫一下，顺带修好「启用」会报端口占用 ([debbc13](https://github.com/kittors/Lyra/commit/debbc13d318770dcae4852a66a8e93f04fb46679))
- 支持会话重命名持久化与桌面/移动端实时双向同步 (#14) ([01e3fb9](https://github.com/kittors/Lyra/commit/01e3fb90f89b06b5f728fb6d2dad7bc71c77ec9b))
- 思考深度按会话隔离，并补上用量统计、滚动跟随与会话范围 ([9f09eb7](https://github.com/kittors/Lyra/commit/9f09eb79d29006ce9d89e16aeb67395d3508ba2a))
- Git 面板能看清远端并一键同步，打包不再装错架构的 native 模块 ([9bf0d6c](https://github.com/kittors/Lyra/commit/9bf0d6ca16ff7c9d0ae3ea66bfb5f5138fe23b79))

### 修复

- **desktop**: use fileURLToPath for rebuild-pty script resolution on windows ([b165a48](https://github.com/kittors/Lyra/commit/b165a48df29fc4cbddfc828dbd435d2cee3b1e33))
- **desktop,core**: fix index race, test cleanup locks and linux package target ([7ac26b3](https://github.com/kittors/Lyra/commit/7ac26b3e375b8196d577c0fd3618d93539c3e9cc))
- **test**: 显式指定 bare 仓库初始分支为 main 以兼容 CI 默认分支配置 ([b21ffa1](https://github.com/kittors/Lyra/commit/b21ffa1ec60b57e18eb829feaf11a6272b5e6887))
- 桌面端改了设置，手机上立刻就变；顺带堵上一个远程执行的口子 ([345ef09](https://github.com/kittors/Lyra/commit/345ef09e3c5e18e18ad501f0a0e60cd5cf6387ad))
- 只在悬停时出现的控件，在没有指针的设备上一直显示 ([f94f53c](https://github.com/kittors/Lyra/commit/f94f53c5a2e30a2a6cabb821880c46fed8e01a3a))
- **mobile**: 点输入框不再把整个界面放大 ([8ebc3df](https://github.com/kittors/Lyra/commit/8ebc3dfcc573974c00507f5ef83c14efb501d6fe))
- **mobile**: react-native 退回 0.86.2，并让 CI 真的去打一次包 ([652488d](https://github.com/kittors/Lyra/commit/652488dec9c48894cd8953e6126185191bf45e4f))
- 修复 Windows 下项目根目录识别 (#38) ([d0ca184](https://github.com/kittors/Lyra/commit/d0ca1841f0ab7ac8870fffe36e7b62423af6802b))
- 撤回 tailwindcss 的 major 拦截，oxlint 单独成组 ([899675c](https://github.com/kittors/Lyra/commit/899675c1b9dca31c3a3579e3801ca9adfced17e3))
- 手起的会话名不再被第一条消息冲掉 ([8ba6d92](https://github.com/kittors/Lyra/commit/8ba6d924cefc7eb075f3c1708512e61ac82f1469))
- 思考深度按会话隔离，无 id 的推理块不再被丢弃 ([59f4093](https://github.com/kittors/Lyra/commit/59f40930413c20e82e705c7c1c8eb17cf160ed3f))
## [0.8.35](https://github.com/kittors/Lyra/releases/tag/v0.8.35) - 2026-09-02

### 新功能

- 支持 AI 生成提交信息，并重做思考过程单行展示 ([cd81356](https://github.com/kittors/Lyra/commit/cd81356227d668661d1b40040982b965a6bcd2b5))

### 修复

- 给 e2e 加上超时与拆台，Dependabot 不再空烧 macOS ([267a758](https://github.com/kittors/Lyra/commit/267a7581b0ea031ea3b22671cc4cccffc4f3fba7))
## [0.8.34](https://github.com/kittors/Lyra/releases/tag/v0.8.34) - 2026-09-01

### 新功能

- 对话中途可换模型、推理档位按模型适配，并修复 Git 历史展开与截图标注，发布 0.8.34 ([e33e4fb](https://github.com/kittors/Lyra/commit/e33e4fb318e395d34b066df7324185a8a4472252))
## [0.8.33](https://github.com/kittors/Lyra/releases/tag/v0.8.33) - 2026-09-01

### 新功能

- 支持代码格式化配置、侧边对话持久化、代码外观增强与截图体验优化，发布 0.8.33 ([d634143](https://github.com/kittors/Lyra/commit/d63414362e8361dde2861b5186208afa4ae2cd89))
## [0.8.32](https://github.com/kittors/Lyra/releases/tag/v0.8.32) - 2026-08-31

### 修复

- **screenshot**: 修复截图工具条点不动、Dock 图标消失与进入闪烁，发布 0.8.32 ([7a0eefa](https://github.com/kittors/Lyra/commit/7a0eefac64e683179dcc0e8ed28e66ff05dfc6aa))
## [0.8.30](https://github.com/kittors/Lyra/releases/tag/v0.8.30) - 2026-08-31

### 修复

- **screenshot**: 修复截图后程序坞 Logo 消失及工具条样式对齐，发布 0.8.29 ([4cb6e13](https://github.com/kittors/Lyra/commit/4cb6e1395970114490521f11c9fde6257984844f))
## [0.8.28](https://github.com/kittors/Lyra/releases/tag/v0.8.28) - 2026-08-31

### 修复

- **worktree**: Windows 上会删掉正在使用的工作树 ([49f7db8](https://github.com/kittors/Lyra/commit/49f7db8115f94a5ed98c125c6971d926a36b81f8))
## [0.8.27](https://github.com/kittors/Lyra/releases/tag/v0.8.27) - 2026-08-31

### 修复

- **test**: 使用动态路径修复 tool-aliases 测试跨环境失败，发布 0.8.27 ([b320b52](https://github.com/kittors/Lyra/commit/b320b526e8f6267e26859afa86740eccb45ba514))
## [0.8.26](https://github.com/kittors/Lyra/releases/tag/v0.8.26) - 2026-08-31

### 修复

- **test**: 修复 tool-aliases 测试中的路径参数缺失，发布 0.8.26 ([c9ed4d9](https://github.com/kittors/Lyra/commit/c9ed4d9d5a0339fdf8fb48fa876c749b3ddc8992))
## [0.8.25](https://github.com/kittors/Lyra/releases/tag/v0.8.25) - 2026-08-31

### 新功能

- 完善上下文压缩降级与自动催促指引，发布 0.8.25 ([1caee28](https://github.com/kittors/Lyra/commit/1caee28dab640b10c25093fe15cb60f121727179))
## [0.8.24](https://github.com/kittors/Lyra/releases/tag/v0.8.24) - 2026-08-31

### 新功能

- **screenshot**: 改用 desktopCapturer，Windows 和 Linux 上也能截图了 ([b73aac3](https://github.com/kittors/Lyra/commit/b73aac3c378fe47d2ba47eed60ddc24fbfd1a392))

### 修复

- **screenshot**: 截图完成不再抢前台，标注粗细可调且默认更细 ([37768ad](https://github.com/kittors/Lyra/commit/37768adf85ea23c2351c3e295d1dfa8b30e3ef45))
- **git**: 环境里残留的 GIT_DIR 不再让整个应用认错仓库 ([1c0c1b4](https://github.com/kittors/Lyra/commit/1c0c1b45b5fbbc21b4e6725909755935caa4089d))
- **screenshot**: 选区能移动能缩放，八个标注工具全部可用 ([bc5e732](https://github.com/kittors/Lyra/commit/bc5e7325e71a330692f790292f68121b5b1fe1f6))
- **git**: 「不是 Git 仓库」不再被用来解释所有失败 ([376d113](https://github.com/kittors/Lyra/commit/376d113d6143bdd183bf3877a968fda444686c26))
- **desktop**: 截图不再闪一下，关掉之后主窗口也不会被埋在别的应用底下 ([bcf1083](https://github.com/kittors/Lyra/commit/bcf10834d8c88aba9c99334b5f54892eb2d40301))
- **forge**: 读不动的账号文件不再被空列表覆盖掉 ([b01ad08](https://github.com/kittors/Lyra/commit/b01ad08f0719fdca4f9fe46bf555eb8f59bc86e2))
## [0.8.23](https://github.com/kittors/Lyra/releases/tag/v0.8.23) - 2026-08-31

### 新功能

- **desktop**: 支持全屏即席截图与选区吸附式标注工具条 ([a77c21e](https://github.com/kittors/Lyra/commit/a77c21ef63690a18e285885e60891164771e42e0))

### 修复

- **test**: 测试运行前清掉 GIT_* 环境变量，否则 git hook 里跑测试会写进真实仓库 ([d90fd2d](https://github.com/kittors/Lyra/commit/d90fd2d56137310026ea60dd3dfda461fc657dc9))
- **release**: 信任证书改用 sudo 写系统钥匙串，否则流水线会挂死而不是失败 ([05290e8](https://github.com/kittors/Lyra/commit/05290e83ba1d47415c54c6cc8fbfbd0663ec5133))
- **release**: 正式发版缺签名证书时直接失败，不再只是警告 ([442fec5](https://github.com/kittors/Lyra/commit/442fec53b15f0b1da6a90e470b0518bb8b1d1d32))
## [0.8.22](https://github.com/kittors/Lyra/releases/tag/v0.8.22) - 2026-08-31

### 修复

- **release**: 用自签名证书签名 macOS 构建，更新后不再重置系统权限 ([892fdf1](https://github.com/kittors/Lyra/commit/892fdf101d104579b14ab45b98644b0692f98b8b))
## [0.8.21](https://github.com/kittors/Lyra/releases/tag/v0.8.21) - 2026-08-31

### 修复

- **test**: 在 Windows 环境下跳过 POSIX 文件权限测试 ([7a3d41a](https://github.com/kittors/Lyra/commit/7a3d41ae2e388340a856a809c0be8595f8a0ca0b))
- 更新后不再需要重新登录账号，API key 不再明文存放 ([7e0ec60](https://github.com/kittors/Lyra/commit/7e0ec600348a02b1fe56fa9b51bc7748a2e90d44))

### 性能

- **desktop**: 消除长会话下拖拽面板、缩放窗口与滚动的卡顿 ([db460c5](https://github.com/kittors/Lyra/commit/db460c574c058ef9c67d66ca6921cce04e8f5c26))
## [0.8.19](https://github.com/kittors/Lyra/releases/tag/v0.8.19) - 2026-08-30

### 新功能

- **git**: 完全移除 gh 依赖，改用原生 GitHub REST API 读取与触发 Actions 流水线 (v0.8.19) ([9347b1b](https://github.com/kittors/Lyra/commit/9347b1b004414d707ed9b688734ee3dc5ed8ecbd))

### 修复

- **desktop**: 增强 GitHub CLI 代理异常回退机制以正常读取 Actions 流水线 ([432e74b](https://github.com/kittors/Lyra/commit/432e74bc76e4c0842354734874fe3590868577ef))
## [0.8.18](https://github.com/kittors/Lyra/releases/tag/v0.8.18) - 2026-08-30

### 修复

- 修复侧边栏状态呼吸灯动画溢出遮挡与 TPS 吞吐量统计耗时 (v0.8.18) ([8324b10](https://github.com/kittors/Lyra/commit/8324b10669999baf3e21793a1aca7551b4086dbd))
## [0.8.17](https://github.com/kittors/Lyra/releases/tag/v0.8.17) - 2026-08-30

### Git

- 优化流水线面板运行态动画与矩阵任务对齐间距 (v0.8.17) ([a331967](https://github.com/kittors/Lyra/commit/a331967563684e1cb02a796628eb735a635873b7))
## [0.8.16](https://github.com/kittors/Lyra/releases/tag/v0.8.16) - 2026-08-30

### 修复

- 优化按钮与输入框高度规范，修复 Popover/Dropdown 定位与 SideChat 缓存持久化 (v0.8.16) ([1d3d4af](https://github.com/kittors/Lyra/commit/1d3d4afdcd04b062ba7dfa33e4ed2abf472aecdc))
## [0.8.15](https://github.com/kittors/Lyra/releases/tag/v0.8.15) - 2026-08-30

### 修复

- 修复 v0.8.14 会话界面塌陷、输入框被顶出窗口 (v0.8.15) ([e3ab23a](https://github.com/kittors/Lyra/commit/e3ab23a19a8761323134a77de5f07902b14fdce9))
## [0.8.14](https://github.com/kittors/Lyra/releases/tag/v0.8.14) - 2026-08-30

### 修复

- 优化模型拉取加载动画、修复设置返回滚动丢失与输入框滚动异常 (v0.8.14) ([aa2028c](https://github.com/kittors/Lyra/commit/aa2028c188416481dcc25d5740706e5c1729c35c))
## [0.8.13](https://github.com/kittors/Lyra/releases/tag/v0.8.13) - 2026-08-30

### 新功能

- 支持自定义系统指令与智能记忆系统，优化流水线状态与 Git 提交体验 (v0.8.13) ([733af47](https://github.com/kittors/Lyra/commit/733af47956b831ed3d4240fb88c51b5536a15149))
## [0.8.12](https://github.com/kittors/Lyra/releases/tag/v0.8.12) - 2026-08-30

### Release

- v0.8.12 ([e6e3ae1](https://github.com/kittors/Lyra/commit/e6e3ae1f5399e02651bbe29bc4c8cc8274850cf2))
## [0.8.8](https://github.com/kittors/Lyra/releases/tag/v0.8.8) - 2026-08-29

### 修复

- **desktop**: 优化侧边栏会话行操作按钮间距与右键菜单定位，打开菜单时抑制 Tooltip ([87283cb](https://github.com/kittors/Lyra/commit/87283cb81d881be35caf2a77c2cf061cba454c9b))
- **desktop**: fix sidechat map reference sharing in session hub ([37883c5](https://github.com/kittors/Lyra/commit/37883c5835412367521a677112aeaba4d29eb156))

### Release

- v0.8.8 ([6230f55](https://github.com/kittors/Lyra/commit/6230f558cf25cef7e7f932e396c7f5afddf730ae))
## [0.8.7](https://github.com/kittors/Lyra/releases/tag/v0.8.7) - 2026-08-29

### 新功能

- **release**: 发布 v0.8.7 并优化长对话滚动性能与 Git 面板体验 ([300165f](https://github.com/kittors/Lyra/commit/300165f82cc664aa2b67ae1a2d3019908f8834c8))
## [0.8.6](https://github.com/kittors/Lyra/releases/tag/v0.8.6) - 2026-08-29

### 新功能

- **agent**: support duration and throughput stats, bump version to 0.8.6 ([fdb5739](https://github.com/kittors/Lyra/commit/fdb57397a5f73ad86789054f546c3d74d7ef8fe3))
## [0.8.5](https://github.com/kittors/Lyra/releases/tag/v0.8.5) - 2026-08-29

### 新功能

- **release**: 发布 v0.8.5 并优化模型导入与发版中心交互 ([c21b641](https://github.com/kittors/Lyra/commit/c21b6413b9b1651508feb62ca5a7b3ca484029a3))

### 修复

- **desktop**: 修复渲染进程 turn-slice 引用 @lyra/core 根入口导致的打包外部化失败 ([39dd6ca](https://github.com/kittors/Lyra/commit/39dd6ca49cf285a0c6ad839a6cd455b1f8c1d835))
## [0.8.4](https://github.com/kittors/Lyra/releases/tag/v0.8.4) - 2026-08-28

### 新功能

- 精简流水线状态提示与实时读秒，支持供应商端点一键拉取模型 ([1731a9f](https://github.com/kittors/Lyra/commit/1731a9f97bbf20ab758e37841f00ff0601eb491f))
## [0.8.3](https://github.com/kittors/Lyra/releases/tag/v0.8.3) - 2026-08-28

### 新功能

- 优化流水线骨架屏与客户端缓存，重构发版中心弹窗 UI ([053b210](https://github.com/kittors/Lyra/commit/053b2102b35e793ec4ff68aa23071b2a2c27381a))
## [0.8.2](https://github.com/kittors/Lyra/releases/tag/v0.8.2) - 2026-08-28

### 新功能

- 优化流水线 UI、拖拽流畅度、耗时吞吐量及子 Agent 渲染 ([2a898f8](https://github.com/kittors/Lyra/commit/2a898f8a7c09eac1d0c293e52d8e59620e51ae9a))

### 性能

- 彻底根治长对话拖拽卡顿与滚屏白屏抖动 ([4d0136d](https://github.com/kittors/Lyra/commit/4d0136dacc09e7ba4bd59d3454cddf1f80831f29))
## [0.8.1](https://github.com/kittors/Lyra/releases/tag/v0.8.1) - 2026-08-28
