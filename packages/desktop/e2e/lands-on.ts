/**
 * 按下去之前先问 `elementFromPoint`：落点上是不是它。
 *
 * `checkVisibility` 只看 display 和 visibility，被 transform 挪出屏幕的元素照样算「看得见」。手机宽度下
 * 收起的侧栏抽屉（`translateX(-100%)`）里的一行，中心在 x=-323，CDP 在那里按下去什么也没按到；要是下一句
 * 等待在旧状态下也成立，测试就一路绿着量错了东西——mobile-sync 的轨迹那条就这样量了很久别的会话。
 * 落点不在元素上、也不在它里面，就当场报错，并说出按下去会落在谁身上。
 *
 * 悬停才接鼠标的控件（`.ly-row-action`、置顶图的关闭键）在指针进来之前是 `pointer-events: none`，
 * 那时问只会问到它底下的那一行。这类 helper 要先把指针移过去再问。
 */

/** 给 `evaluate` 字符串用的一句 JS。`el`、`x`、`y` 是页面里的变量名，`label` 只进报错。 */
export function landsOn(label: string, el = "el", x = "x", y = "y"): string {
	return `{const landed=document.elementFromPoint(${x},${y});if(!landed||!${el}?.contains(landed))throw new Error(${JSON.stringify(label)}+' is off-screen or covered at '+Math.round(${x})+','+Math.round(${y})+': '+(landed?landed.outerHTML.slice(0,160):'nothing there'));}`;
}
