import assert from "node:assert/strict";
import { test } from "node:test";
import { advertisedEndpoints, descendants, parseLsof, parseSs, parseProcesses, parseWindowsListeners, serviceUrl } from "../electron/service-listeners.ts";
import { browserUrl, parseBrowserCommand } from "../shared/browser.ts";
test("POSIX listeners preserve IPv4/IPv6 and match only descendants of the owned process", () => {
	const tree = parseProcesses(" 10 1\n20 10\n30 20\n40 1\n");
	assert.deepEqual([...descendants(10, tree)], [10,20,30]);
	assert.deepEqual(parseLsof("p30\nn*:3000\nn[::1]:8080\np40\nn127.0.0.1:9999"), [{pid:30,address:"*",port:3000},{pid:30,address:"::1",port:8080},{pid:40,address:"127.0.0.1",port:9999}]);
	assert.deepEqual(parseSs('LISTEN 0 128 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=30,fd=8))'), [{pid:30,address:"127.0.0.1",port:3000}]);
});
test("Windows listeners validate native results and reject malformed data", () => {
	assert.deepEqual(parseWindowsListeners({processes:[{pid:2,parent:1}],listeners:[{pid:2,address:"::",port:5173}]}).listeners, [{pid:2,address:"::",port:5173}]);
	assert.throws(() => parseWindowsListeners({processes:[],listeners:[{pid:"2",address:"::",port:80}]}), /无效/);
});
test("logged URLs require a matching real local listener", () => {
	const endpoint={pid:20,address:"0.0.0.0",port:3000};
	assert.equal(serviceUrl(endpoint,"docs https://example.com:3000/\nserver http://localhost:3000/app"), "http://127.0.0.1:3000/app");
	assert.equal(serviceUrl(endpoint,"http://localhost:4000/"), undefined);
});
test("printed local URLs are enough when the OS listener table is missing", () => {
	assert.deepEqual(advertisedEndpoints(20, "started\nhttp://127.0.0.1:5173/\n"), [{ pid: 20, address: "127.0.0.1", port: 5173, url: "http://127.0.0.1:5173/" }]);
	assert.deepEqual(advertisedEndpoints(20, "http://localhost:3000/app\nhttps://example.com:3000/\nhttp://127.0.0.1/"), [{ pid: 20, address: "127.0.0.1", port: 3000, url: "http://127.0.0.1:3000/app" }]);
	assert.deepEqual(advertisedEndpoints(0, "http://127.0.0.1:5173/"), []);
});
test("browser commands validate URL protocols, dimensions and IPC value types", () => {
	assert.equal(browserUrl("localhost:5173"), "https://localhost:5173/");
	for (const url of ["javascript:alert(1)","file:///etc/passwd","data:text/html,test"]) assert.throws(() => browserUrl(url));
	for (const command of [{type:"zoom",id:"tab",factor:NaN},{type:"viewport",id:"tab",viewport:{width:10,height:800}},{type:"open",url:"https://example.com",sessionId:{}},{type:"close",id:12}]) assert.throws(() => parseBrowserCommand(command));
	assert.deepEqual(parseBrowserCommand({type:"viewport",id:"tab",viewport:{width:390,height:844}}),{type:"viewport",id:"tab",viewport:{width:390,height:844}});
});
