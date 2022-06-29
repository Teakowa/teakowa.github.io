---
title: 虚拟星空的 Web 前端自动化发布实践
date: 2022-06-30 00:18:25
tags: [Docker, DevOps, GitHab, GitHub Action]
---

大家好，我是 Teakowa，本文将向大家介绍我们虚拟星空是如何基于 GitHub Action 构建 Web 前端自动化发布管道的过程，以及其中踩过的坑。

## 一些前提介绍

我们的开发是 All in GitHub 的，如果在 2022 年要在 GitHub 上做 CI/CD 的集成，那我无脑推荐 GitHub Action，GitHub Action 非常方便，它与 GitHub 原生集成，社区活跃，配置简单（也不一定），目前来说是最适合我们的。

我们的发布流程相对简单，PR 合并后就会立刻发布：

## 自动化版本号

在生产发布流程之前，还有一个步骤，就是自动生成版本号，我们所有的项目都遵循 语义化版本 规范来发布版本，并且使用 semantic-release 来自动化这一过程，每当我们的 Pull Request 被合并进主分支的时候，Release Workflow 就会运行，根据规则自动的新建 tag 和 release。

```yaml
.github/workflows/release.yml

name: Release

on:
  push:
    branches:
      - main
      - rc
      - beta
      - alpha
  workflow_dispatch:

jobs:
  release:
    name: Release
    uses: XNXKTech/workflows/.github/workflows/release.yml@main
    secrets:
      CI_PAT: ${{ secrets.CI_PAT }}
```

这里我们使用了 GitHub 的可复用工作流（reusable workflow），完整的 reusable workflow 如下：

```
name: Release

on:
  workflow_call:
    outputs:
      new_release_published:
        description: "New release published"
        value: ${{ jobs.release.outputs.new_release_published }}
      new_release_version:
        description: "New release version"
        value: ${{ jobs.release.outputs.new_release_version }}
      new_release_major_version:
        description: "New major version"
        value: ${{ jobs.release.outputs.new_release_major_version }}
      new_release_minor_version:
        description: "New minor version"
        value: ${{ jobs.release.outputs.new_release_minor_version }}
      new_release_patch_version:
        description: "New patch version"
        value: ${{ jobs.release.outputs.new_release_patch_version }}
      new_release_channel:
        description: "New release channel"
        value: ${{ jobs.release.outputs.new_release_channel }}
      new_release_notes:
        description: "New release notes"
        value: ${{ jobs.release.outputs.new_release_notes }}
      last_release_version:
        description: "Last release version"
        value: ${{ jobs.release.outputs.last_release_version }}
    inputs:
      semantic_version:
        required: false
        description: Semantic version
        default: 19
        type: string
      extra_plugins:
        required: false
        description: Extra plugins
        default: |
          @semantic-release/changelog
          @semantic-release/git
          conventional-changelog-conventionalcommits
        type: string
      dry_run:
        required: false
        description: Dry run
        default: false
        type: string
    secrets:
      CI_PAT:
        required: false
      GH_TOKEN:
        description: 'Personal access token passed from the caller workflow'
        required: false
      NPM_TOKEN:
        required: true

env:
  GITHUB_TOKEN: ${{ secrets.GH_TOKEN == '' && secrets.CI_PAT || secrets.GH_TOKEN }}
  GH_TOKEN: ${{ secrets.GH_TOKEN == '' && secrets.CI_PAT || secrets.GH_TOKEN }}
  token: ${{ secrets.GH_TOKEN == '' && secrets.CI_PAT || secrets.GH_TOKEN }}

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    outputs:
      new_release_published: ${{ steps.semantic.outputs.new_release_published }}
      new_release_version: ${{ steps.semantic.outputs.new_release_version }}
      new_release_major_version: ${{ steps.semantic.outputs.new_release_major_version }}
      new_release_minor_version: ${{ steps.semantic.outputs.new_release_minor_version }}
      new_release_patch_version: ${{ steps.semantic.outputs.new_release_patch_version }}
      new_release_channel: ${{ steps.semantic.outputs.new_release_channel }}
      new_release_notes: ${{ steps.semantic.outputs.new_release_notes }}
      last_release_version: ${{ steps.semantic.outputs.last_release_version }}
    steps:
      - name: Checkout
        uses: actions/checkout@v3.0.2
        with:
          persist-credentials: false
          fetch-depth: 0

      - name: Use remote configuration
        if: contains(fromJson('["XNXKTech", "StarUbiquitous", "terraform-xnxk-modules"]'), github.event.repository.owner.name) == true
        run: |
          wget -qO- https://raw.githubusercontent.com/XNXKTech/workflows/main/release/.releaserc.json > .releaserc.json
      - name: Semantic Release
        uses: cycjimmy/semantic-release-action@v2
        id: semantic
        with:
          semantic_version: ${{ inputs.semantic_version }}
          extra_plugins: |
            @semantic-release/changelog
            @semantic-release/git
            conventional-changelog-conventionalcommits
          dry_run: ${{ inputs.dry_run }}
        env:
          GITHUB_TOKEN: ${{ env.GH_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

通过可复用工作流，我们可以只维护一个 workflow 并让所有的代码仓库复用，降低我们的维护成本，毕竟代码仓库多起来以后一个个去改 workflow 是很痛苦的事情……
这里还统一了各个仓库使用的 .releaserc.json，使得我们进一步降低维护成本。
更多关于我们可复用工作流的实践有机会的话也会发布出来，欢迎关注。

## 自动发布流程
先上完整的图：

我们的 Production workflow 会被 release 事件触发，这个过程是由 GitHub Webhook 完成的，不需要我们关注，但同时我们还使用了 workflow_dispatch 事件，允许我们手动运行 Production workflow：

```yaml
.github/workflows/production.yml

name: Production

on:
  release:
    types: [ published ]
  workflow_dispatch:
```

### Build

首先是 Build 部分，这一部分需要编译出前端静态资源文件交给后续的 jobs 处理：

```yaml
jobs:
  build:
    name: Build
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Split string
        uses: jungwinter/split@v2
        id: split
        with:
          separator: '/'
          msg: ${{ github.ref }}

      - name: Checkout ${{ steps.split.outputs._2 }}
        uses: actions/checkout@v3
        with:
          ref: ${{ steps.split.outputs._2 }}

      - name: Setup Node ${{ matrix.node }}
        uses: actions/setup-node@v3.3.0
        with:
          node-version: ${{ matrix.node }}
          cache: npm

      - name: Setup yarn
        run: npm install -g yarn

      - name: Setup Nodejs with yarn caching
        uses: actions/setup-node@v3.3.0
        with:
          node-version: ${{ matrix.node }}
          cache: yarn

      - name: Cache dependencies
        uses: actions/cache@v3.0.4
        id: node-modules-cache
        with:
          path: |
            node_modules
          key: ${{ runner.os }}-yarn-${{ hashFiles('**/yarn.lock') }}
          restore-keys: |
            ${{ runner.os }}-yarn

      - name: Install package.json dependencies with Yarn
        if: steps.node-modules-cache.outputs.cache-hit != 'true'
        run: yarn --frozen-lockfile
        env:
          PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: true
          HUSKY_SKIP_INSTALL: true

      - name: Cache build
        uses: actions/cache@v3.0.4
        id: build-cache
        with:
          path: |
            build
          key: ${{ runner.os }}-build-${{ github.sha }}

      - name: Build
        if: steps.build-cache.outputs.cache-hit != 'true'
        run: yarn build
```
这里有几个地方可以展开介绍，我们的 Checkout 部分和常见的不太一样，常见的 Checkout 可能就一条：

```yaml
- uses: actions/checkout@v2
```

但我们踩到了第一个坑，checkout 默认情况下会使用代码仓库中设置的 default branch 而我们一些偏 CD 的 workflow 都是 workflow_dispatch 与其他的如 push、release 事件共存的，我们不能使用默认参数，必须传一个 ref 进去，确保 action 会按照我们的期望 checkout，我们尝试过对 release 做支持：

```yaml
- name: Get the version
  id: get_version
  run: echo ::set-output name=VERSION::${GITHUB_REF/refs\/tags\//}
```

但发现它在其他的事件中不起作用，因为其他事件的 webhook playload 中并没有 /refs/tags，这会导致当 webhook event 是 release 以外的其他事件时获取不到我们期望的 ref。
 $GITHUB_REF 是有的，但却不是我们期望的格式，因为根据不同的事件，$GITHUB_REF 的内容也不一样。
比如 workflow_dispatch 是支持选择 branch 和 tag 来手动运行的，那么 $GITHUB_REF 可能是 refs/heads/main，也可能是 refs/tags/v1.111.1-beta.4。
所以最后我决定粗暴一点，既然不管任何事件 $GITHUB_REF 都会存在，那就直接分割它：

```yaml
- name: Split string
  uses: jungwinter/split@v2
  id: split
  with:
    separator: '/'
    msg: ${{ github.ref }}
```

直接取最后的值，是 main 还是 v1.111.1 根本就不重要，因为始终能按照我们的期望 checkout 出正确的 ref。

```yaml
- name: Checkout ${{ steps.split.outputs._2 }}
  uses: actions/checkout@v3
  with:
    ref: ${{ steps.split.outputs._2 }}
```
接下来是缓存与编译步骤，由于 Build 部分只负责编译，所以只需要将 Build 的结果 cache 起来，通过 action cache 让后续的 workflow 复用就可以了。
如何高效利用缓存是很重要的事情，在 Build 过程中，有两个使用缓存的关键位置：
1. 项目依赖
2. 编译文件
项目依赖
众所周知，前端项目的依赖是宇宙难题。
[图片]
我们不能在每一次的 Build 都重新安装项目依赖，那会导致整个 Workflow 执行非常的漫长（账单也会很长）
所以 Build workflow 中设置了项目依赖缓存：

```yaml
      - name: Cache dependencies
        uses: actions/cache@v3.0.4
        id: node-modules-cache
        with:
          path: |
            node_modules
          key: ${{ runner.os }}-yarn-${{ hashFiles('**/yarn.lock') }}
          restore-keys: |
            ${{ runner.os }}-yarn

      - name: Install package.json dependencies with Yarn
        if: steps.node-modules-cache.outputs.cache-hit != 'true'
        run: yarn --frozen-lockfile
        env:
          PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: true
          HUSKY_SKIP_INSTALL: true
```

先跟大家介绍 actions/cache 这个神奇(?)的东西：

1. 每个仓库 10 GB 缓存容量
2. 缓存 Key 数量无限
3. 每个缓存 Key 最短有效期 7 天（如果 7 天内没有任何访问将被删除）
4. 如果超过了容量限制，GitHub 会保存最新的缓存，删除以前的缓存

这是什么，活菩萨在世（不是）利用这些规则我们理论上可以在多个 workflow 中无限复用一个缓存！

通过设置 cache 的 path、key、restore-keys 来更大限度的复用项目依赖缓存，其中 key 和 restore-keys 非常关键：
- key - 用于恢复和保存缓存的密钥
- restore-keys - 如果 key 没有发生缓存命中，它会按提供的恢复密钥去按顺序查找和恢复缓存，这个时候 cache-hit 会返回 false.
key 是保证我们能够最大限度利用缓存的基础，对于 yarn 或 npm 来说，只需要对 lock 文件进行哈希就可以了，设置 cache key 为：
${{ runner.os }}-yarn-${{ hashFiles('**/yarn.lock') }}
如果 lock 的文件哈希一致，会直接命中缓存，但如果文件哈希不一致，没有命中缓存，这个时候我们就没有 node_modules 了吗？
不是的，通过设置 restore-keys 为 ${{ runner.os }}-yarn，即使 key 没有命中缓存，我们仍然可以通过上一个 key 来恢复大部分缓存：
[图片]
此时 cache-hit 返回 false，没有命中缓存，所以我们执行 yarn 安装依赖，但只会安装变更的依赖，这样可以确保即使没有命中缓存，我们仍然不需要从头到尾重新安装所有的依赖。

这两个 step 存在于我们所有项目的 CI 流程中（根据语言细节不一样，但本质还是确保多个 workflow 复用缓存），比如说 Build/ESLint/Test workflow 里面都会包含这两个 step，而在 PR Review 环节就会执行这些 CI workflow，基本上项目依赖缓存是来自于 PR 的。

当缓存命中时 action 就会直接跳过下面的依赖安装步骤，直接将 node_modules 恢复到项目目录：
[图片]
并且我们是周期性的更新依赖，单个依赖缓存我们可以用非常久，这样我们就得到了一个高度可复用的项目依赖缓存（和短的账单）
编译文件
项目的静态资源缓存也是一个问题，我们希望像项目依赖缓存一样，一次编译多线复用，来省掉那些不必要的构建时间，所以这里我们针对编译也使用了缓存：
```yaml
      - name: Cache build
        uses: actions/cache@v3.0.4
        id: build-cache
        with:
          path: |
            build
          key: ${{ runner.os }}-build-${{ github.sha }}

      - name: Build
        if: steps.build-cache.outputs.cache-hit != 'true'
        run: yarn build
```

不过这里没有设置 restore-keys ，因为编译环节每一次都可能存在新的变更导致编译出来的文件名不一致，我们没办法像依赖缓存那样使用一个 lock 来判断，这里直接放弃 restore-keys ，使用 Git SHA 来作为编译缓存的 key，只确保后续的 workflow 以及 workflow re-run 的时候能利用编译缓存就行了。

至此 Build 的使命就完成了，接下来是部署的环节。

TCB
我们的前端项目全部都基于 TCB（Tencent Cloudbase）和 Kubernetes 部署，TCB 负责主要的用户访问，Kubernetes 担任热备份的角色，当我们发现 TCB 版本出现问题的时候会直接通过 CDN 节点切到 Kubernetes 上，尽量保证用户访问不受影响。

TCB 的部署使用了可复用工作流（reusable workflow），还使用了我们自建的 GitHub Action Runner：

```yaml
  cloudbase:
    name: TCB
    needs:
      - build
    uses: XNXKTech/workflows/.github/workflows/cloudbase.yml@main
    with:
      runs-on: "['self-hosted']"
      environment: Production
      environment_url: https://demo.xnxktech.net
    secrets:
      SECRET_ID: ${{ secrets.TCB_SECRET_ID }}
      SECRET_KEY: ${{ secrets.TCB_SECRET_KEY }}
      ENV_ID: ${{ secrets.ENV_ID }}
```

关于 TCB 的可复用工作流可以 在这里 看细节部分，这里就不再全部展示出来了。
为什么不使用 TCB 官方提供的 Action？
前面提到我们使用 GitHub Action 的原因之一，社区活跃，GitHub 上有非常多的 Action 可以直接使用，甚至还能通过 Docker 的方式使用 Action。
TCB 官方提供了一个 cloudbase-action 来实现 TCB 的部署。但我们在使用中发现了一些问题：
1. 每一次执行都需要下载 @cloudbase/cli
是的，这个时间我不想花
2. 部署失败但是不报错
[图片]
3. 有时候部署非常非常慢
这个就不怪 TCB 了，GitHub Action 的机器都在北美，推国内白天还好，晚上不知道是国际网络限速还是咋的，我们有一次发布等了半个小时还没有推到国内……
以上问题是我们自己封装 TCB Action 的原因，我们的解决方案是在香港自建 Runner 以及把 TCB 内置到 Runner 系统镜像内来保证 TCB 的部署效率

[图片]

这样一来 TCB 的部署时间可以控制在 1 分钟左右

```yaml
Kubernetes
  deploy:
    name: Kubernetes
    needs:
      - build
    uses: XNXKTech/workflows/.github/workflows/deploy-k8s.yml@main
    with:
      environment: Production
      environment_url: https://prod.example.com
    secrets:
      K8S_CONFIG: ${{ secrets.K8S_CONFIG }}
我们的 Kubernetes 部署也是可复用工作流，由于我们的 Docker 镜像编译是另外的工作流（另外的价钱），所以这里不涉及。
Static
我们的前端项目都涉及到大量的 js/css/image 等静态文件，我们会单独使用一个 CDN 域名去部署：
  static:
    name: Static
    needs:
      - build
    uses: XNXKTech/workflows/.github/workflows/uptoc.yml@main
    with:
      cache_dir: build
      cache_key: build
      dist: build/static
      saveroot: ./static
      bucket: qc-frontend-assets-***
    secrets:
      UPTOC_UPLOADER_AK: ${{ secrets.TENCENTCLOUD_COS_SECRET_ID }}
      UPTOC_UPLOADER_SK: ${{ secrets.TENCENTCLOUD_COS_SECRET_KEY }}
```

毫不例外的这里也是可复用工作流，我们使用 saltbo/uptoc 提供的 Action 来将这些静态文件上传到对象储存中，提供给 CDN 访问。

### CDN

当 TCB/Kubernetes/Static 都执行成功后，会进入到 CDN 刷新的步骤，我们使用的是 Serverless 提供的 CDN 组件：

```yaml
app: app
stage: prod
component: cdn
name: cdn

inputs:
  area: mainland
  domain: prod.example.com
  origin:
    origins:
      - prod-example.tcloudbaseapp.com
    originType: domain
    originPullProtocol: http
  onlyRefresh: true
  refreshCdn:
    urls:
      - https://prod.example.com/
  cdn:
    runs-on: ubuntu-latest
    needs:
      - deploy
      - cloudbase
      - static
    name: Refresh CDN
    steps:
      - name: Checkout
        uses: actions/checkout@v2.4.0

      - name: Setup Serverless
        uses: teakowa/setup-serverless@v2
        with:
          provider: tencent
        env:
          TENCENT_APPID: ${{ secrets.TENCENTCLOUD_APP_ID }}
          TENCENT_SECRET_ID: ${{ secrets.TENCENTCLOUD_SLS_SECRET_ID }}
          TENCENT_SECRET_KEY: ${{ secrets.TENCENTCLOUD_SLS_SECRET_KEY}}
          SERVERLESS_PLATFORM_VENDOR: tencent

      - name: Refresh CDN
        run: sls deploy
```

通过 Serverless 定义 CDN 来对我们的 CDN 进行「仅刷新」的操作，以保证新版本会尽快的发布到用户端。

## 通知

当前面的 Workflow 全部执行成功后，由最后一个 Workflow 将整个 Production 的执行结果通过飞书机器人发送到我们的频道里面：

```yaml
  notification:
    name: Deploy notification
    needs:
      - cdn
    uses: XNXKTech/workflows/.github/workflows/lark-notification.yml@main
    with:
      stage: Production
    secrets:
      LARK_WEBHOOK_URL: ${{ secrets.SERVICE_UPDATES_ECHO_LARK_BOT_HOOK }}
```
[图片]
到这里，我们整个 Production 的发布算是完成了。

结尾
我们在前端发布的实践就是这样了，目前我们前端项目的上线发布最多在 5 分钟左右（包含 CDN 节点刷新），让用户更快的看到我们的新变更的同时，通过可复用工作流统一所有前端项目的 CI/CD 流程也降低了团队的维护成本。
不过我个人还是觉得有些小问题：
- 我认为整个 Production workflow 执行效率还可以再提升，比如可以把自建的 Runner 覆盖到更多的 job 中，以及把我们强依赖的一些 action 集成到自建的 runner image 中，省掉 action setup 的时间。
- 工程师对线上环境的干预不足，比如线上发生问题需要切流量/版本的时候，不能方便的通过 GitHub Action 去操作

## License
CC BY-NC-ND 4.0

Written by XNXK's Teakowa in Chengdu