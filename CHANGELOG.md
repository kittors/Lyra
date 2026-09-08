# 更新日志

这个文件由 `pnpm release` 生成，条目来自提交信息。写得含糊的提交在这里也含糊，所以值得在提交时就写清楚。

只收录 0.8.0 及之后的版本：更早的提交信息还没有统一格式，勉强解析出来的条目比留白更容易误导。
那些版本的说明在 [GitHub Releases](https://github.com/kittors/Lyra/releases) 里。

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
