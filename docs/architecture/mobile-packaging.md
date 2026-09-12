# 手机端怎么打包、怎么进 release

桌面端的打包链路在 `_desktop-build.yml`，手机端在 `_mobile-build.yml`。两者的结构故意一样：
`release.yml` 和 `release-dryrun.yml` 各自调用同一个被调用工作流，差别只有两处——签名缺失是否
致命、以及最后是否发布。排练和发版共用同一份文件，而不是「两份文件保持一致」。

## 仓库里没有 android/ 和 ios/

`app.json` 是手机端唯一的描述。Gradle 文件、Xcode 工程、Podfile、图标、权限文案，全部由
`expo prebuild` 在构建时生成，构建完就丢掉（`packages/mobile/.gitignore` 里的 `/android`
和 `/ios`）。

这带来一个后果，值得写下来：**`app.json` 改一行就是改两个原生工程**，仓库里不存在第二份会跟它
唱反调的描述；反过来，凡是 prebuild 才会报出来的问题——插件不再接受某个参数、权限文案格式变了、
SDK 升级换了 Gradle 版本——在 lint、typecheck、单元测试里全是绿的。这就是原生构建必须进排练的
理由，和 0.2.0 那次 `executableName` 是同一类：一个只有打包才会执行到的输入。

`ci.yml` 里的 `mobile-bundle` 不重复这件事，它问的是另一个问题——Metro 能不能把整张 JS 图解析
下来。那个每周都会坏，而且一分钟就能问完。原生构建只在 tag 和 tag 前的排练上跑：iOS 用的是
计费十倍的 macOS runner，一次冷归档 15–25 分钟。

## 一次发版带出来的两个文件

| 文件 | 怎么来的 | 装它的人要做什么 |
| --- | --- | --- |
| `Lyra-x.y.z-android.apk` | `gradlew assembleRelease`，用仓库 secret 里的 release key 签名 | 允许「未知来源」，直接装 |
| `Lyra-x.y.z-ios-unsigned.ipa` | `xcodebuild archive`，不签名 | 自己签：Sideloadly、AltStore 或 Xcode 的 Devices 窗口，免费 Apple ID 即可 |

两个文件和桌面端的产物一起进 `SHA256SUMS`，也一起进 release 的资产列表。桌面端的更新器不会因此
受影响：它是拿自己的文件名去这张表里查（`update-checksum.ts` 的 `parseChecksums` 按名字建索引），
不是把整张表当成自己的清单读。

## Android：签名钥匙是一次性的决定

`expo prebuild` 生成的 `android/app/build.gradle` 沿用 React Native 模板，而模板把 **release
构建类型指向 debug 的 keystore**：

```gradle
signingConfigs { debug { storeFile file('debug.keystore') storePassword 'android' … } }
buildTypes { release { … signingConfig signingConfigs.debug } }
```

所以裸仓库上 `assembleRelease` 出来的 APK 是能装的——这正是陷阱所在。Android 用签名证书判断
「这是不是同一个应用」：用模板那把 debug key 签出去的包，以后任何一个正经签名的版本都更新不了
它，用户必须先卸载，配对跟着一起丢。而那把钥匙是公开的，它就在模板里，拿到它的人能造出手机会
接受的「更新」。

两条都是发出去就收不回的，所以 `require-signing` 的语义和 macOS 证书完全一致：发版时缺 keystore
直接失败（在任何东西被构建之前），排练时只警告，产物名字带上 `-debugkey`，谁也不会把它当成发布版。

四个 secret，`packages/mobile/scripts/make-release-keystore.sh` 一次生成并打印出来：
`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、
`ANDROID_KEY_PASSWORD`。钥匙本体只该在密码管理器里——丢了它，所有装过的人都停在最后一个版本。

排练不会因为缺钥匙而红，于是留下一个缝：排练全绿、tag 推上去、release 在签名那一步死掉，得到一个
没有 release 的 tag。所以 `pnpm release` 自己问一次 `gh secret list`（`androidKeyOrStop`）；读不到
secret 列表（gh 没有 admin 权限）时只提示不拦，因为「读不到」不等于「没有」。

### 构建号：算出来，写进 app.json

不写的话，prebuild 就给 `versionCode 1`、`CFBundleVersion 1`。而 Android 拒绝安装 versionCode
不高于已装版本的包——每个版本都带 1，等于任何版本都更新不了任何版本，而且它不会说为什么。

数字由根 `package.json` 的版本号算出来：`major * 1000000 + minor * 1000 + patch`（0.9.11 →
9011），实现在 `scripts/versions.mjs` 的 `buildNumber()`。算而不是各写一遍，是因为第二处的数字会
漂——这个仓库有伤疤，`app.json` 的版本号在 0.1.0 上停了三十五个版本。

算完由 `pnpm release` 写进 `app.json` 的 `android.versionCode` 与 `ios.buildNumber`，
`test/version-sync.test.ts` 守着它跟版本号对得上。**不走 Gradle property**，这一条是在真 runner
上换来的：`-Pandroid.injected.version.code=9011` 传进去，Gradle 一声不吭地接受，构建绿，出来的
APK 带着 `versionCode 1`。property 的失败方式就是被忽略。

签名仍然只能走 property（`android.injected.signing.*`），失败方式同理——静静地退回 debug 签名，
看起来跟成功一模一样。所以 `finish-android-apk.sh` 在打完包之后把 APK 读回来：`aapt2` 问
versionCode 和 versionName，`apksigner` 问签名证书，对不上就红。那个 versionCode 检查不是摆设，
上面那次注入失败就是它抓到的。

## iOS：不签名，以及这不是将来的样子

签名装到别人手机上需要 Apple Developer 账号：一年 $99，不走 TestFlight 的话还得提前登记设备
UDID。仓库没有这个账号，而一个谁都装不上的 `.ipa` 比没有更糟，所以 release 发的是未签名包，签名
由装它的人补上——Sideloadly、AltStore、Xcode 的 Devices 窗口都做这件事，用免费 Apple ID。文件名
写着 `-unsigned`。

将来有账号了，改的地方在 `build-unsigned-ipa.sh`：像桌面端 `prepare-signing.sh` 那样导入证书和
描述文件，去掉 `CODE_SIGNING_ALLOWED=NO`，把结尾那段 zip 换成 `xcodebuild -exportArchive`。

脚本而不是写在 workflow 步骤里，是为了能在笔记本上跑——里面每一行都是试出来的：scheme 的名字不是
slug；`-exportArchive` 没有签名身份时直接拒绝运行；`Payload/` 里必须只有归档产出的那个 `.app`。
还有一处是真踩过的：scheme 要从 **工程** 列，不能从 workspace 列——workspace 会把 CocoaPods 塞进
去的每个 scheme 一起列出来，「取第一个」取到的是 `EXConstants`，它归档成功、然后在找不到 `.app`
的地方失败。

## 本地怎么验

```bash
cd packages/mobile && pnpm exec expo prebuild --platform ios --no-install
cd ios && pod install && cd ../../..
bash .github/scripts/build-unsigned-ipa.sh packages/mobile/dist "$(node -p "require('./package.json').version")"
```

Android 同理，把 prebuild 换成 `--platform android`，然后：

```bash
cd packages/mobile/android
LYRA_NDK_VERSION=$(basename "$(ls -d "$ANDROID_HOME"/ndk/* | tail -1)") \
  ./gradlew assembleRelease -I ../scripts/use-installed-ndk.init.gradle
```

那个 init script 是必须的，原因在它自己的注释里：Expo 点名要 NDK `27.1.12297006` 这一个修订号，
而谁都没有这一个——GitHub 的镜像是 27.3/28.2/29.0，本机是 Android Studio 装的那个。缺了它 Gradle
不会报错，它会在配置阶段刷几分钟「Still waiting for package manifests to be fetched remotely」
（这句话里没有 NDK 三个字母），然后自己接受许可、下载 1.5 GB。本机实测是八分钟之后才说出
「Install NDK」。

`--no-install` 是必须的：prebuild 自带的安装步骤会在 pnpm workspace 里去找 npm，把
`node_modules` 在所有人脚下重排一遍。

## 没有覆盖的

CI 不装到任何设备上，也不上 Play 或 TestFlight。「构建得出来」和「装上去能用」是两件事，后者仍然
是实机验收，见 `mobile-sync.md` 末尾那几段的口径。
