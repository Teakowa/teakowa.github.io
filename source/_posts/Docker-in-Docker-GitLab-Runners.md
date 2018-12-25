---
layout: posts
title: Use Docker-in-Docker with GitLab CI/CD
date: 2018-12-25 03:21:00
tags: [Docker, DevOps, GitLab]
---

迫于不想手动 Build Docker 镜像和 Push 镜像（懒），决定使用 Docker in Docker (dind) with GitLab CI/CD

**注意：**这个方案仅适用于在可信环境下构建的可信代码，任何运行 dind 的环境都可能受提权影响。

## 配置服务器

如果服务器上已经安装了 Docker 并且存储驱动已经设置为 `overlay2`，那么可以跳过这一节。

### 安装 Docker

```sh
sudo apt remove -y docker docker-engine docker.io
sudo apt update
sudo apt install -y apt-transport-httpsca-certificates curl software-properties-common
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
sudo add-apt-repository \
   "deb [arch=amd64] https://download.docker.com/linux/ubuntu \
   $(lsb_release -cs) \
   stable"
sudo apt update
sudo apt install -y docker-ce
```

Docker CE 已经默认使用 `overlay2` 存储驱动，无需手动配置。

### 配置 overlay

如果 Docker 使用的存储驱动不是 `overlay2`，那么需要手动配置。

检查 overlay 模块

```sh
lsmod | grep overlay
overlay              49152  3
```

如果没有出现，那么需要添加它

```sh
modprobe overlay
```

添加到启动引导中

```sh
grep '^overlay$' /etc/modules || echo overlay >>/etc/modules
```

确保 `/etc/docker/daemon.json` 中配置了 `storage-driver`

```json
{
  "storage-driver": "overlay2"
}
```

重启 Docker

```sh
systemctl restart docker
```

**注意：** 切换存储驱动会丢失所有存储的 Docker volume 数据。

## 配置环境

### 安装 Docker-in-Dockers

我希望避免污染宿主机 Docker 环境，而且这是长期用于构建的 Docker 实例，所以所有的构建都与宿主机 Docker 环境隔离，**但这并不意味着安全。**

首先创建一个 network

```sh
docker network create gitlab-runner-net
```

然后运行 dind

```sh
docker run -d \
  --name gitlab-dind \
  --privileged \
  --restart always \
  --network gitlab-runner-net \
  -v /var/lib/docker \
  docker:18.06.1-ce-dind \
    --storage-driver=overlay2
```

这会以特权模式创建一个名为 `gitlab-dind` 的 Docker 自动重启容器，在匿名卷中使用 `var/lib/docker` 文件夹。

需要注意的是 `gitlab-dind` 在 `/var/run/docker.sock` 内部有自己的 Docker socket，并且通过 `tcp 2375` 端口暴露。

### 安装 GitLab Runner

之前一直是在宿主机上直接运行的 GitLab Runner，到后面就觉得哪哪不方便，所以以后都使用容器运行 GitLab Runner。

首先创建一个配置文件

```sh
mkdir -p /srv/gitlab-runner
touch /srv/gitlab-runner/config.toml
```

然后启动 GitLab Runner

```sh
docker run -d \
  --name gitlab-runner \
  --restart always \
  --network gitlab-runner-net \
  -v /srv/gitlab-runner/config.toml:/etc/gitlab-runner/config.toml \
  -e DOCKER_HOST=tcp://gitlab-dind:2375 \
  gitlab/gitlab-runner:alpine
```

注意传递给 `gitlab-runner` 的 `DOCKER_HOST` 变量，它指向我们在上面创建的 `gitlab-dind` 容器的 TCP 端口。

这样一来，每当 Runner 构建容器时，它都会使用 `gitlab-dind` 来执行，Runner 就不需要使用特权模式运行了。

### 注册 Runner

登录 GitLab 获取令牌，然后注册

```sh
docker run -it --rm \
  -v /srv/gitlab-runner/config.toml:/etc/gitlab-runner/config.toml \
  gitlab/gitlab-runner:alpine \
    register \
    --executor docker \
    --docker-image docker:18.06.1-ce \
    --docker-volumes /var/run/docker.sock:/var/run/docker.sock

Running in system-mode.

Please enter the gitlab-ci coordinator URL (e.g. https://gitlab.com/):
[YOUR_GITLAB_URL]
Please enter the gitlab-ci token for this runner:
[YOUR_RUNNER_TOKEN]
Please enter the gitlab-ci description for this runner:
[abc123def456]: Docker Runner
Please enter the gitlab-ci tags for this runner (comma separated):

Whether to lock Runner to current project [true/false]:
[false]:
Registering runner... succeeded                     runner=xxx
Please enter the executor: virtualbox, docker+machine, docker-ssh+machine, ssh, docker-ssh, parallels, shell, kubernetes, docker:
[docker]: docker
Please enter the default Docker image (e.g. ruby:2.1):
[docker:18.06.1-ce]: docker:18.06.1-ce
Runner registered successfully. Feel free to start it, but if it's running already the config should be automatically reloaded!
```

docker-volumes 将 `gitlab-dind` 的 Docker socket 安装到每个创建的构建容器中，这样每个构建容器都可以访问 `gitlab-dind` 的 Docker 环境。

可以看看 `/srv/gitlab-runner/config.toml` 文件，大概像这样：

```toml
concurrent = 1
check_interval = 0

[[runners]]
  name = "Docker Runner"
  url = "YOUR_GITLAB_URL"
  token = "PER_RUNNER_TOKEN"
  executor = "docker"
  [runners.docker]
    host = "tcp://gitlab-dind:2375"
    tls_verify = false
    image = "docker:18.06.1-ce"
    privileged = false
    disable_cache = false
    volumes = ["/var/run/docker.sock:/var/run/docker.sock", "/cache"]
    shm_size = 0
  [runners.cache]
```

## Building & Testing

GitLab 提供了两种在 pipeline 中共享文件的方法，这对测试构建非常有用，通常我们需要使用 `composer` 或 `npm` 安装项目依赖，但如果必须在每个 job 之前构建，这就非常不优雅且浪费时间。

### Cache

第一个方法是缓存，类似于 Laravel 中的缓存。

首先使用缓存来节省时间，缓存可以通过重复使用先前作业的内容来加快构建执行的时间。（[cache in Gitlab Docs](https://docs.gitlab.com/ee/ci/yaml/README.html#cache)）

```yml
cache:
    key: ${CI_COMMIT_REF_SLUG}
    paths:
        - vendor/
```

### Artifacts

Artifacts 可以视为 job 的输出，这些文件会自动提供给后续 job。

比如我有三个 job：`build` `test` `deploy`，如果为在 `build` 上定义了一些 `artifacts`，那么 test 和 deploy 会在 job 开始之前下载这些 artifacts.

### Build

- 在 build 阶段的 job 中使用 **artifacts** 来为 pipeline 中的其他 job 提供内容
- 在构建过程中使用 **cache** 来确保每个 pipeline 不会重复创建 `vendor`

```yml
image: fspnetwork/php:latest

cache:
    key: ${CI_COMMIT_REF_SLUG}
    paths: 
        - vendor/

···

build:
    stage: build
    artifacts:
        paths:
            - vendor/
    script:
        - cp .env.production .env
        - composer install --prefer-dist --no-ansi --no-interaction --no-progress --no-scripts --optimize-autoloader
        - chmod -R 777 storage/* bootstrap/cache
        - php artisan key:generate
        - php artisan config:cache
```

### Test

首先从 `build` job 继承文件，然后使用 `phpunit` 执行 Test

```yml
test:
    stage: test
    dependencies:
        - build
    script:
        - php vendor/bin/phpunit --coverage-text --colors=never
```

### Build Image

最后打包 Docker 镜像并推送到 GitLab 

```yml
build_image:
    image: docker:stable
    stage: build_image
    script:
        - docker login -u gitlab-ci-token -p $CI_JOB_TOKEN $CI_REGISTRY
        - docker build -t $CI_REGISTRY_IMAGE .
        - docker push $CI_REGISTRY_IMAGE
```

### .gitlab-ci.yml

`.gitlab-ci.yml` 全貌：

```yml
image: fspnetwork/php:latest

cache:
    key: ${CI_COMMIT_REF_SLUG}
    paths:
        - vendor/

services:
    - docker:dind

stages:
    - build
    - test
    - build_image

variables:
    DOCKER_DRIVER: overlay2

build:
    stage: build
    artifacts:
        paths:
            - vendor/
    script:
        - cp .env.production .env
        - composer install --prefer-dist --no-ansi --no-interaction --no-progress --no-scripts --optimize-autoloader
        - chmod -R 777 storage/* bootstrap/cache
        - php artisan key:generate
        - php artisan config:cache

test:
    stage: test
    dependencies:
        - build
    script:
        - php vendor/bin/phpunit --coverage-text --colors=never

build_image:
    image: docker:stable
    stage: build_image
    script:
        - docker login -u gitlab-ci-token -p $CI_JOB_TOKEN $CI_REGISTRY
        - docker build -t $CI_REGISTRY_IMAGE .
        - docker push $CI_REGISTRY_IMAGE

```
首先在 Orion 项目上使用了这套环境，在经历了 16 次 failed 之后，终于成功了。车祸现场见([GitLab Pipelines](https://gitlab.com/FSPNetwork/orion/pipelines))

