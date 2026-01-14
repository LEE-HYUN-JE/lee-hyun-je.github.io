---
layout: post
title: "JPA N+1 문제 해결 전략"
date: 2024-01-10
category: JPA
tags: [JPA, Performance, Database]
excerpt: "JPA를 사용할 때 발생하는 N+1 문제의 원인과 다양한 해결 방법을 정리했습니다."
---

JPA를 사용하면서 가장 흔하게 마주치는 성능 이슈 중 하나가 N+1 문제입니다.

## N+1 문제란?

연관 관계가 설정된 엔티티를 조회할 때, 1번의 쿼리로 N개의 엔티티를 가져온 후 연관된 엔티티를 조회하기 위해 N번의 추가 쿼리가 발생하는 문제입니다.

```java
@Entity
public class Team {
    @Id @GeneratedValue
    private Long id;

    @OneToMany(mappedBy = "team", fetch = FetchType.LAZY)
    private List<Member> members = new ArrayList<>();
}

// N+1 발생 코드
List<Team> teams = teamRepository.findAll(); // 1번 쿼리
for (Team team : teams) {
    team.getMembers().size(); // N번 쿼리
}
```

## 해결 방법 1: Fetch Join

가장 일반적인 해결 방법입니다.

```java
@Query("SELECT t FROM Team t JOIN FETCH t.members")
List<Team> findAllWithMembers();
```

**장점**: 한 번의 쿼리로 모든 데이터를 가져옴
**단점**: 페이징 불가능 (컬렉션 Fetch Join 시)

## 해결 방법 2: EntityGraph

```java
@EntityGraph(attributePaths = {"members"})
@Query("SELECT t FROM Team t")
List<Team> findAllWithMembers();
```

## 해결 방법 3: Batch Size 설정

```yaml
spring:
  jpa:
    properties:
      hibernate:
        default_batch_fetch_size: 100
```

IN 쿼리로 묶어서 조회합니다.

```sql
-- 개별 쿼리 대신
SELECT * FROM member WHERE team_id IN (1, 2, 3, ... 100)
```

## 상황별 선택 가이드

| 상황 | 추천 방법 |
|------|----------|
| 데이터 양이 적고 페이징 불필요 | Fetch Join |
| 페이징이 필요한 경우 | Batch Size |
| 동적으로 로딩 조절 필요 | EntityGraph |

## 결론

N+1 문제는 JPA 사용 시 반드시 인지하고 있어야 하는 문제입니다. 상황에 맞는 적절한 해결 방법을 선택하여 성능을 최적화하세요.
