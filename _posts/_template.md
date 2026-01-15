---
layout: post
title: "제목을 여기에 작성하세요"
date: 2024-01-15
tags: [Backend, AWS]
---

첫 문단은 포스트의 요약입니다. 검색 결과와 카드에 표시됩니다.
이 부분을 잘 작성하면 독자가 글의 내용을 빠르게 파악할 수 있습니다.

<!--more-->

## 목차
- [개요](#개요)
- [본문 제목 1](#본문-제목-1)
- [본문 제목 2](#본문-제목-2)
- [마무리](#마무리)

---

## 개요

여기에 배경 설명이나 문제 상황을 작성합니다.

## 본문 제목 1

### 소제목 (h3)

일반 텍스트를 작성합니다. **굵은 글씨**와 *기울임*을 사용할 수 있습니다.

#### 더 작은 제목 (h4)

필요한 경우 h4까지 사용합니다.

---

## 코드 블록

### 인라인 코드

문장 안에서 `변수명`이나 `메서드()`를 표시할 때 백틱을 사용합니다.

### 코드 블록 (언어별 하이라이팅)

```java
@Service
public class UserService {

    private final UserRepository userRepository;

    public User findById(Long id) {
        return userRepository.findById(id)
            .orElseThrow(() -> new NotFoundException("User not found"));
    }
}
```

```python
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      - SPRING_PROFILES_ACTIVE=prod
```

```bash
# 터미널 명령어
docker build -t my-app .
docker run -p 8080:8080 my-app
```

---

## 이미지 삽입

### 기본 이미지

![이미지 설명](/assets/img/posts/파일명.png)

### 이미지 + 캡션 (HTML 사용)

<figure>
  <img src="/assets/img/posts/architecture.png" alt="시스템 아키텍처">
  <figcaption>그림 1. 전체 시스템 아키텍처</figcaption>
</figure>

### 이미지 크기 조절

<img src="/assets/img/posts/diagram.png" alt="다이어그램" width="600">

---

## 인용문 & 콜아웃

### 일반 인용문

> 이것은 인용문입니다.
> 여러 줄로 작성할 수 있습니다.

### 팁/노트 스타일

> **Note**
> 참고할 내용을 여기에 작성합니다.

> **Warning**
> 주의해야 할 내용을 작성합니다.

> **Tip**
> 유용한 팁을 작성합니다.

---

## 리스트

### 순서 없는 리스트

- 첫 번째 항목
- 두 번째 항목
  - 중첩 항목 1
  - 중첩 항목 2
- 세 번째 항목

### 순서 있는 리스트

1. 첫 번째 단계
2. 두 번째 단계
3. 세 번째 단계

### 체크리스트

- [x] 완료된 항목
- [ ] 미완료 항목
- [ ] 또 다른 항목

---

## 표 (Table)

| 항목 | 설명 | 비고 |
|------|------|------|
| Spring Boot | 백엔드 프레임워크 | 3.2.x |
| PostgreSQL | 데이터베이스 | 15.x |
| Redis | 캐시 | 7.x |

### 정렬이 있는 표

| 왼쪽 정렬 | 가운데 정렬 | 오른쪽 정렬 |
|:----------|:----------:|----------:|
| 텍스트 | 텍스트 | 100 |
| 텍스트 | 텍스트 | 200 |

---

## 링크

### 일반 링크

[Spring 공식 문서](https://spring.io/docs)를 참고하세요.

### 참조 스타일 링크

자세한 내용은 [공식 문서][spring-docs]를 확인하세요.

[spring-docs]: https://spring.io/docs

---

## 구분선

섹션을 구분할 때 사용합니다.

---

## 접기/펼치기 (Details)

<details>
<summary>클릭하여 펼치기</summary>

숨겨진 내용이 여기에 표시됩니다.

```java
// 긴 코드 예시
public class Example {
    // ...
}
```

</details>

---

## 마무리

### 요약

- 포인트 1
- 포인트 2
- 포인트 3

### 참고 자료

- [참고 링크 1](https://example.com)
- [참고 링크 2](https://example.com)

---

## 사용 가능한 태그 목록

`_config.yml`에 정의된 태그:
- Devops
- Backend
- Etc
- ComputerScience
- AWS
- Secure
