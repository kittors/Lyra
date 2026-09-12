/**
 * 现在写得多快。
 *
 * 「实时」这个词在这里有个绕不开的前提：**计费口径的 token 数在回合结束前是空的**。适配器要等
 * `response.completed` 才把服务商报的 `usage` 一次性填上，而实时速度要的恰恰是结束之前的那段时间。
 * 所以这里读的是还在长的文本，按 `@lyra/core/tokens` 的 3.5 字符/token 折算——和上下文仪表、压缩判断
 * 用的是同一把尺，全应用至少口径一致。回合结束后 `MessageActions` 那行显示的是服务商的真数，两者会有
 * 出入，那是估算的代价。
 *
 * 算的是**窗口内的平均**，不是从回合开头算起的平均。后者会把工具执行、思考停顿、网络等待全摊进去，
 * 于是一个跑了二十分钟的回合无论此刻写得多快，数字都贴在地板上不动——那是「这一轮总体多快」，不是
 * 「此刻多快」，而屏幕上它紧挨着一个正在跳的省略号，说的应该是此刻。
 *
 * 还有一层已知的系统性低估，量过，大约 6%：采样的时刻戳来自那个 250ms 的心跳，而字数是流式增量随时改的，
 * 所以一个采样的「字数」比它的「时刻」平均晚约半拍。分母因此比该有的长了半拍，真实 100 tok/s 量出来是
 * 93~95。要修得把心跳和真实时钟分开、再给采样做抽稀，那是为一个本来就按 3.5 字符/token 估的数字添三处
 * 机械——不划算。回合结束后那条消息上显示的是服务商报的真数，要准的时候看它。
 */

/** 一次采样：那一刻过了多久、已经写了多少字。 */
export interface RateSample {
	at: number;
	chars: number;
}

/**
 * 窗口多长。
 *
 * 短了跟着每一帧的抖动跳，长了跟不上「刚开始写」和「刚写完」这两个转折。4 秒是在两者之间：它能盖住
 * 一次正常的句读停顿，又不会让一段结束后的数字还挂在那儿好几秒。
 */
export const WINDOW_MS = 4000;

/**
 * 收一个采样进窗口。返回新数组，不改原来那个。
 *
 * 三种情况要分开：
 *
 *   - 字数**变少**了：这不是速度变慢，是换了一条消息（或者回合结束、切了会话）。旧采样和新采样量的
 *     不是同一段文本，放在一起算出来的差值没有意义——整个窗口作废，从这一刻重新开始。
 *   - 时间没有前进：同一毫秒里来了两次（`now` 每 250ms 推一次，但 React 可能在同一刻重渲染）。覆盖掉
 *     上一条，而不是追加一条零时距的采样——那会让下面的除法遇到 0。
 *   - 正常增长：追加，并把窗口外的旧采样丢掉。
 */
export function pushSample(samples: RateSample[], at: number, chars: number): RateSample[] {
	const last = samples[samples.length - 1];

	if (last && chars < last.chars) return [{ at, chars }];
	if (last && at <= last.at) return trimIdleHead([...samples.slice(0, -1), { at, chars }]);

	const next = [...samples, { at, chars }];
	/*
	 * 窗口内够两个就只用窗口内的；不够才往前借一个。
	 *
	 * 「往前借」这件事本身是需要的：窗口左端点落在 `at - WINDOW_MS` 那一刻，而采样是离散的，正好落在
	 * 那一点的采样不存在；只用窗口内的，实际时距会比窗口短，速度偏高。
	 *
	 * 但借来的那个必须是**紧挨着边界**的，而不是「最后一个过期的」——两者在采样密集时是同一个，稀疏时
	 * 差得很远。停了一分钟才恢复输出的那一轮就是稀疏的：窗口内有三个新采样，而上一个采样在 60 秒前，
	 * 借了它就等于拿一分钟去除几百个字，数字被稀释成贴地的一位数，而屏幕上模型正在飞快地写。
	 *
	 * 所以先看窗口内够不够，够就不借。不够（刚开始写、刚重置过）才退回最后两个，那时它们本来就挨着。
	 */
	const cutoff = at - WINDOW_MS;
	const inside = next.filter((sample) => sample.at >= cutoff);
	return trimIdleHead(inside.length >= 2 ? inside : next.slice(-2));
}

/**
 * 把窗口开头那段「一个字都没多」的采样剪掉，只留紧挨着增长开始的那一个。
 *
 * 这是「实时」二字最容易破功的地方，而且破得很隐蔽。一个回合的大半时间在跑工具，那几十秒里字数一动
 * 不动，窗口被同一个数值填满。等工具跑完、模型重新开口，第一个新采样落进来时窗口是
 * `[0, 0, 0, …, 0, 50]`——首尾相减是 50 个字，而时距是整整 4 秒的窗口宽度，于是算出 3.6 tok/s，而屏幕上
 * 模型正在飞快地写。更糟的是这个数**跨过了可信门槛**（时距足够长、增量为正），于是它会理直气壮地把上
 * 一段真实的读数替换掉。
 *
 * 剪掉之后，窗口的含义变成「从最近一次恢复增长算起，最多 4 秒」。剪到只剩两个同值采样也没关系：那是
 * 真的没在写，速度为零，而零不会去替换任何东西。
 *
 * **但绝不能剪到只剩一个。** 这是第一版栽的地方，而且栽得很彻底——屏幕上一个读数都不出现。原因在采样的
 * 来路：`chars` 只在流式增量到达时变，而时钟每 250ms 自己推一拍，那一拍带的是**上一次增量留下的同一个
 * 字数**。于是每一拍都在窗口尾巴上接一个与前一个同值的采样，看起来就是「开头一段没长」，被剪掉；窗口
 * 塌成一个采样；紧接着的增量落在同一毫秒里，走的是覆盖那条路，把仅剩的那个锚点也改掉了。锚点一没，
 * 时距永远是 0，永远攒不稳，永远不显示。
 *
 * 所以留住最后两个。`trimIdleHead` 只该丢掉「不再需要的过去」，不该丢掉「用来相减的那个基准」。
 */
function trimIdleHead(samples: RateSample[]): RateSample[] {
	let head = 0;
	while (head + 1 < samples.length && samples[head + 1].chars === samples[head].chars) head++;
	head = Math.min(head, samples.length - 2);
	return head <= 0 ? samples : samples.slice(head);
}

/**
 * 新窗口攒够了没有——够了才拿它去替换上一个读数。
 *
 * 一段新的输出刚开始时，窗口里只有一两个采样，算出来是 0.3、0.5 这种数：不是模型真的慢下来了，是
 * 分母才走了两百毫秒。直接拿去替换，屏幕上就是 `100 → 0.5 → 一路爬回 60`——先掉进坑再爬出来，比什么
 * 都不显示还难看。
 *
 * 所以设一道「攒稳」的门槛：窗口至少跨过 `SETTLE_MS`，才算它说的话可信。在那之前上一个读数继续挂着，
 * 那是这一轮已经发生过的事实，不是凭空编的。
 *
 * 门槛取 1.2 秒：采样每 250ms 一次，够攒五个，抖动被平掉；再长就会漏掉那些一两秒就写完的短回复，
 * 它们也该有自己的读数。
 */
export const SETTLE_MS = 1200;

/**
 * 一个 token 折合多少字符。
 *
 * 和 `@lyra/core/tokens` 的 `estimateTokens` 是同一把尺（那边是 `chars / 3.5`）。提成常量是因为
 * 现在两个方向都要用：这条线按字符走，而子代理的产出只报 token——它的消息要等 `message_end` 才
 * 到，中途没有字符可数——所以接进来之前得先乘回去。见 `RunningIndicator` 里 `subChars` 那一段。
 */
export const CHARS_PER_TOKEN = 3.5;

export function trustworthy(samples: RateSample[]): boolean {
	if (samples.length < 2) return false;
	const span = samples[samples.length - 1].at - samples[0].at;
	return span >= SETTLE_MS && rateFrom(samples) > 0;
}

/**
 * 窗口里的速度，token 每秒。
 *
 * 不够两个采样、时距为零、字数没长，都返回 0——那些情况下「速度」这个词还没有意义，而一个凭空出现的
 * 数字比没有数字更糟。
 */
export function rateFrom(samples: RateSample[]): number {
	if (samples.length < 2) return 0;
	const first = samples[0];
	const last = samples[samples.length - 1];
	const seconds = (last.at - first.at) / 1000;
	if (seconds <= 0) return 0;
	const chars = last.chars - first.chars;
	if (chars <= 0) return 0;
	return chars / CHARS_PER_TOKEN / seconds;
}
