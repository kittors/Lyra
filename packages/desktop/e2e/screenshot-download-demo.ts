/* oxlint-disable no-console -- real-window recording with measured save results */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type AppWindow } from "./app.ts";
import { encode, pause, type Frame } from "./record.ts";

const app = await startApp({ port: 9833, inspectPort: 9834, seed: async home => {
	await writeFile(join(home, "settings.json"), JSON.stringify({ uiLocale: "zh-CN", providers: [], mcpServers: [], hooks: [], sync: {enabled:false}, screenshot:{shortcut:"",copyToClipboard:false} }));
} });
const frames: Frame[] = [];
const checks: {name:string;ok:boolean;measured:unknown}[] = [];
const check = (name:string,ok:boolean,measured:unknown) => { checks.push({name,ok,measured});console.log(`${ok?"PASS":"FAIL"} ${name} ${JSON.stringify(measured)}`); };
let overlay: AppWindow | undefined;
async function wait(expression: string) {
	if (!overlay) throw new Error("missing overlay");
	for (let i=0;i<60;i++) { if (await overlay.evaluate(expression)) return; await pause(100); }
	throw new Error(`not ready: ${expression}`);
}
async function hold(ms=1000) {
	if (!overlay) return;
	const end=Date.now()+ms;
	while(Date.now()<end) {
		const shot=await overlay.send<{data:string}>("Page.captureScreenshot",{format:"jpeg",quality:90});
		frames.push({at:Date.now(),data:Buffer.from(shot.data,"base64")});
		await pause(100);
	}
}
try {
	const shot=await app.send<{data:string}>("Page.captureScreenshot",{format:"png"});
	const fixture=join(app.home,"own-window.png");
	await writeFile(fixture,Buffer.from(shot.data,"base64"));
	const size=await app.evaluate<{width:number;height:number}>("({width:innerWidth,height:innerHeight})");
	for(let i=0;i<60&&!overlay;i++) {
		for(const win of await app.windows()) if(await win.evaluate("Boolean(document.querySelector('[data-capture]'))")) overlay=win;
		if(!overlay) await pause(100);
	}
	if(!overlay) throw new Error("screenshot overlay did not warm");
	const blocked=join(app.home,"不可写入的目录");
	await writeFile(blocked,"this is a file");
	await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,screenshot:{...s.screenshot,downloadLocation:${JSON.stringify(blocked)}}}))`);
	// Explicit fixture: the overlay receives only a capture of this disposable Lyra window.
	const initialize = (session: number) => app.main(`(()=>{const w=process._linkedBinding('electron_browser_window').BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('#/screenshot-overlay'));const image=process._linkedBinding('electron_common_native_image').nativeImage.createFromPath(${JSON.stringify(fixture)});const pixels=image.toBitmap();for(let i=0;i<pixels.length;i+=4){const b=pixels[i];pixels[i]=pixels[i+2];pixels[i+2]=b;}w.setBounds({x:40,y:50,width:${size.width},height:${size.height}});w.setIgnoreMouseEvents(false);w.setOpacity(1);w.show();w.webContents.send('screenshot:init',{snapshot:{pixels,width:image.getSize().width,height:image.getSize().height},session:${session},bounds:{x:40,y:50,width:${size.width},height:${size.height}},scaleFactor:1,colorSpace:'srgb',windows:[],settings:{downloadLocation:${JSON.stringify(blocked)},copyToClipboard:false}});w.webContents.send('screenshot:shown');return true})()`);
	await initialize(999);
	await wait("Boolean(document.querySelector('[data-capture=active] canvas'))");
	await hold();
	await overlay.send("Input.dispatchMouseEvent",{type:"mousePressed",x:120,y:140,button:"left",buttons:1,clickCount:1});
	for(let i=1;i<=12;i++) await overlay.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:120+480*i/12,y:140+250*i/12,button:"left",buttons:1});
	await overlay.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:600,y:390,button:"left",buttons:0,clickCount:1});
	await wait("Boolean(document.querySelector('[data-selection]'))");
	await hold();
	const selection=await overlay.evaluate("document.querySelector('[data-selection]').getBoundingClientRect().toJSON()");
	const pressDownload=()=>overlay?.evaluate("document.querySelector('button[aria-label=下载截图]').click()");
	await pressDownload();
	await wait("Boolean(document.querySelector('[data-screenshot-toast]'))");
	await hold(1500);
	const failure=await overlay.evaluate<{active:boolean;selection:unknown;text:string}>("({active:document.querySelector('[data-capture]').dataset.capture==='active',selection:document.querySelector('[data-selection]')?.getBoundingClientRect().toJSON(),text:document.querySelector('[data-screenshot-toast]')?.textContent})");
	check("failed download keeps the exact selected region and displays the filesystem error",failure.active&&JSON.stringify(selection)===JSON.stringify(failure.selection)&&/EEXIST|ENOTDIR|EACCES|EPERM/.test(failure.text),failure);
	const destination=join(app.home,"下载 已修改");
	await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,screenshot:{...s.screenshot,downloadLocation:${JSON.stringify(destination)}}}))`);
	await pressDownload();
	await wait(`document.querySelector('[data-screenshot-toast]')?.textContent.includes(${JSON.stringify(destination)})`);
	await hold(2000);
	const names=await readdir(destination);
	const file=names[0]&&await readFile(join(destination,names[0]));
	check("retry uses the newly configured directory and writes a real PNG",names.length===1&&Boolean(file?.subarray(1,4).equals(Buffer.from("PNG"))),{names,bytes:file?.length});
	const result=await overlay.evaluate<string>("document.querySelector('[data-screenshot-toast]').textContent");
	check("the successful download shows its actual complete file path",result.includes(join(destination,names[0])),result);
	await initialize(1000);
	await wait("Boolean(document.querySelector('[data-capture=active] canvas'))");
	await overlay.send("Input.dispatchMouseEvent",{type:"mousePressed",x:160,y:170,button:"left",buttons:1,clickCount:1});
	await overlay.send("Input.dispatchMouseEvent",{type:"mouseMoved",x:560,y:370,button:"left",buttons:1});
	await overlay.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:560,y:370,button:"left",buttons:0,clickCount:1});
	await hold(4200);
	const nextCapture = await overlay.evaluate<{active:boolean;selected:boolean;toast:boolean}>("({active:document.querySelector('[data-capture]').dataset.capture==='active',selected:Boolean(document.querySelector('[data-selection]')),toast:Boolean(document.querySelector('[data-screenshot-toast]'))})");
	check("the prior success timer never dismisses the next capture",nextCapture.active&&nextCapture.selected&&!nextCapture.toast,nextCapture);

} catch(error) {
	check("scenario completed",false,String(error));
} finally {
	await app.stop();
	const dir=join(homedir(),"Desktop","Lyra截图保存测试");
	await mkdir(dir,{recursive:true});
	const name=`${new Date().toISOString().replace(/[:.]/g,"-")}_截图保存与重试_${checks.filter(c=>c.ok).length}of${checks.length}`;
	await writeFile(join(dir,name+".json"),JSON.stringify(checks,null,2));
	if(frames.length) await encode(frames,join(dir,name+".mp4"),30);
	console.log(join(dir,name+".mp4"));
	if(checks.some(c=>!c.ok)) process.exitCode=1;
}
