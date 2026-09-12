# 更新日志

这个文件由 `pnpm release` 生成，条目来自提交信息。写得含糊的提交在这里也含糊，所以值得在提交时就写清楚。

只收录 0.8.0 及之后的版本：更早的提交信息还没有统一格式，勉强解析出来的条目比留白更容易误导。
那些版本的说明在 [GitHub Releases](https://github.com/kittors/Lyra/releases) 里。

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
