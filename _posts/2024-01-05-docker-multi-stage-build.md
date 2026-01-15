---
layout: post
title: "Docker Multi-stage Build로 이미지 최적화하기"
date: 2024-01-05
tags: [Devops]
---

Spring Boot 애플리케이션의 Docker 이미지가 너무 커서 배포 시간이 오래 걸리는 문제를 해결했습니다.
<!--more-->

## 기존 Dockerfile의 문제점

```dockerfile
FROM openjdk:17-jdk
WORKDIR /app
COPY . .
RUN ./gradlew build
COPY build/libs/*.jar app.jar
ENTRYPOINT ["java", "-jar", "app.jar"]
```

이 방식의 문제:
- 빌드 도구(Gradle)가 이미지에 포함됨
- 소스 코드가 이미지에 포함됨
- 이미지 크기: **약 800MB**

## Multi-stage Build 적용

```dockerfile
# Build Stage
FROM gradle:8.5-jdk17 AS builder
WORKDIR /app
COPY build.gradle settings.gradle ./
COPY src ./src
RUN gradle build -x test --no-daemon

# Production Stage
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
COPY --from=builder /app/build/libs/*.jar app.jar

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
```

## 결과

| 항목 | Before | After |
|------|--------|-------|
| 이미지 크기 | 800MB | 180MB |
| 빌드 시간 | - | 동일 |
| 보안 | 소스코드 포함 | JRE만 포함 |

**77% 이미지 크기 감소!**

## 추가 최적화 팁

### 1. Layer Caching 활용

의존성 파일을 먼저 복사하여 캐시를 활용합니다.

```dockerfile
FROM gradle:8.5-jdk17 AS builder
WORKDIR /app

# 의존성 파일 먼저 복사 (캐시 활용)
COPY build.gradle settings.gradle ./
RUN gradle dependencies --no-daemon

# 소스 코드 복사 후 빌드
COPY src ./src
RUN gradle build -x test --no-daemon
```

### 2. .dockerignore 설정

```
.git
.gradle
build
*.md
```

### 3. JVM 옵션 최적화

```dockerfile
ENTRYPOINT ["java", "-XX:+UseContainerSupport", "-XX:MaxRAMPercentage=75.0", "-jar", "app.jar"]
```

## 결론

Multi-stage Build는 프로덕션 환경에서 필수적인 최적화 기법입니다. 이미지 크기 감소는 배포 속도 향상과 보안 강화로 이어집니다.
