---
layout: post
title: "모놀리식 아키텍쳐 내에서 SAGA 패턴으로 분산 트랜잭션 문제 해결하기 - OpenStack + Spring Boot"
date: 2025-01-31
tags: [Backend, ComputerScience]
---

OpenStack Keystone과 자체 DB에 데이터를 나눠 저장하는 구조에서 발생하는 분산 트랜잭션 문제를 SAGA 패턴으로 해결한 과정을 정리한다.

<!--more-->

## 목차
- [문제 상황: 분산 트랜잭션](#문제-상황-분산-트랜잭션)
- [SAGA 패턴이란?](#saga-패턴이란)
- [Choreography vs Orchestration](#choreography-vs-orchestration)
- [모놀리식에서 Orchestration 구현 방법](#모놀리식에서-orchestration-구현-방법)
- [우리 프로젝트에 적용](#우리-프로젝트에-적용)
- [마무리](#마무리)

---

## 문제 상황: 분산 트랜잭션

### 단일 DB에서의 트랜잭션

Spring에서 `@Transactional`을 사용하면 하나의 DB 내에서 원자성이 보장된다.

```java
@Transactional
public void createUser(UserRequest request) {
    userRepository.save(user);      // 성공
    profileRepository.save(profile); // 실패 시 user도 롤백
}
```

### 분산 환경에서의 문제

서로 다른 시스템에 데이터를 저장해야 하는 경우, 단일 트랜잭션으로 묶을 수 없다.
</br> 아래는 현재 진행하는 BFF 구조인 ACC Server 가 처한 문제상황이다.

![분산 트랜잭션 처리 미흡](/assets/images/2025-02-02/acc-distribute-transcation-problem.png)  
Keystone의 사용자 생성을 "롤백"하려면 별도의 **보상 트랜잭션**이 필요하다.



같은 DB 내의 작업은 `@Transactional`로 해결되지만, **외부 API 호출은 트랜잭션 범위 밖**이다. 이 문제를 해결하기 위해 SAGA 패턴이 필요하다.

---

## SAGA 패턴이란?

SAGA 패턴은 분산 시스템에서 데이터 일관성을 유지하기 위한 패턴이다. 하나의 큰 트랜잭션을 여러 개의 로컬 트랜잭션으로 나누고, 실패 시 이전 단계들을 **보상 트랜잭션**으로 취소한다.

### 핵심 개념

**로컬 트랜잭션**: 각 시스템 내에서 완결되는 트랜잭션
- Keystone 사용자 생성
- DB 저장

**보상 트랜잭션**: 이전 단계를 논리적으로 취소하는 트랜잭션
- Keystone 사용자 삭제

### 실행 흐름

```
성공:
T1 → T2 → T3 → 완료 ✓

실패 (T3에서):
T1 → T2 → T3(실패) → C2 → C1 → 롤백 완료

T = 로컬 트랜잭션, C = 보상 트랜잭션
```

---

## Choreography vs Orchestration

SAGA 패턴은 두 가지 방식으로 구현할 수 있다.

### Choreography 방식

각 서비스가 이벤트를 발행/구독하며 자율적으로 다음 단계를 실행한다.
#### chroeography-성공케이스
![chroeography-성공케이스](/assets/images/2025-02-02/img.png)
Service 1의 설정에 따라 다르지만, 대부분은 모든 Service 컴포넌트들의 트랜잭션 성공 event 응답을 받게 되면, 
다음 로직을 진행하게 되는 원리이다.


#### chroeography-실패케이스
![chroeography-실패케이스](/assets/images/2025-02-02/img_1.png)
만약, 한 Service에서 트랜잭션에 실패하여 실패이벤트를 발행하게 된다면, 각 해당하는 Service들은 모두 Rollback을 실행해 
데이터의 정합성을 맞출 수 있다. 

- 장점: 느슨한 결합, 서비스 추가/제거 유연
- 단점: 전체 흐름 파악 어려움, 디버깅 복잡
- 적합: MSA 환경, 메시지 브로커 사용 시

#### 현재 BFF 구조에서 위 패턴을 적용하게 된다면?
- Acc Server에서 활용한 Keystone은 OpenStack의 한 모듈로서, 직접 뜯어서 EDA로 변경이 필요하다. 
즉, 비용이 너무 많이 들게 되고 , 유지보수 포인트가 더 늘어나게 되는 것이므로 적합하지 않다.
- 추후, BFF에 연결된 Service의 수가 늘어난다면 고려해볼만하다. 

### Orchestration 방식

중앙 조율자가 전체 흐름을 제어한다.
<br/> 
#### Orchestration-성공케이스
![Orchestration-성공케이스](/assets/images/2025-02-02/img_2.png)
해당 패턴은 SAGA Orchestrator 즉, 조율자가 Service의 인스턴스로 올라와 모든 흐름을 제어하게 되는 것이다.
<br/> Saga Orchestrator가 트랜잭션의 결과를 직접 응답받아 정의된 다음 트랜잭션들을 순차적으로 실행하여 로직의 정합성을 맞춰나간다.


#### Orchestration-실패케이스
![Orchestration-실패케이스](/assets/images/2025-02-02/img_3.png)
만약, Saga Orchestrator에 실패응답이 돌아왔을 시 , Saga Orchestrator의 인스턴스에 정의된 순차 실행되었던 트랜잭션의 역순으로 보상트랜잭션이 실행된다.


- 장점: 흐름이 명확, 디버깅 용이
- 단점: Orchestrator가 단일 장애점이 될 수 있음
- 적합: 모놀리식, 흐름이 명확해야 할 때

우리 프로젝트는 **모놀리식 Spring Boot**이고 메시지 브로커를 사용하지 않으므로, **Orchestration 방식**을 선택했다.

---

## 모놀리식에서 Orchestration 구현 방법

모놀리식 환경에서 Orchestration 기반 SAGA를 구현하는 방법은 크게 두 가지가 있다.

### 방법 1: Orchestrator + Step 클래스

Step을 인터페이스로 정의하고, 각 단계를 클래스로 구현하는 방식이다.

```java
// Step 인터페이스
public interface SagaStep<T> {
    T execute();
    void compensate();
    String getStepName();
}

// Step 구현
public class CreateKeystoneUserStep implements SagaStep<String> {
    private final KeystoneAPIPort keystonePort;
    private String createdUserId;

    @Override
    public String execute() {
        this.createdUserId = keystonePort.createUser(...);
        return createdUserId;
    }

    @Override
    public void compensate() {
        if (createdUserId != null) {
            keystonePort.deleteUser(createdUserId);
        }
    }
}

// Orchestrator
@Component
public class SagaOrchestrator {
    public <T> T execute(List<SagaStep<?>> steps) {
        List<SagaStep<?>> completed = new ArrayList<>();

        for (SagaStep<?> step : steps) {
            try {
                step.execute();
                completed.add(step);
            } catch (Exception e) {
                // 역순 보상
                for (int i = completed.size() - 1; i >= 0; i--) {
                    completed.get(i).compensate();
                }
                throw e;
            }
        }
    }
}
```

**장점**
- 구조가 명확하고 확장성이 좋음
- Step 단위로 테스트 가능
- Step 재사용 가능

**단점**
- Step마다 클래스 파일 생성 필요
- 간단한 로직에는 과한 구조

### 방법 2: try-catch + 보상 로직

Module 내에서 직접 try-catch로 처리하는 방식이다.

```java
@Component
public class SomeModule {
    private final ExternalAPIPort externalAPIPort;
    private final RepositoryPort repositoryPort;

    public Result doSomething(Request request) {
        String externalId = null;

        try {
            // Step 1: 외부 API
            externalId = externalAPIPort.create(request);

            // Step 2: DB 저장
            saveToDatabase(externalId, request);

            return Result.success(externalId);

        } catch (Exception e) {
            // 보상: Step 1 롤백
            compensateStep1(externalId);
            throw new BusinessException("작업 실패", e);
        }
    }

    @Transactional
    protected void saveToDatabase(String externalId, Request request) {
        repositoryPort.saveEntity1(...);
        repositoryPort.saveEntity2(...);
    }

    private void compensateStep1(String externalId) {
        if (externalId == null) return;
        try {
            externalAPIPort.delete(externalId);
        } catch (Exception e) {
            log.error("보상 실패 - 수동 처리 필요: {}", externalId, e);
        }
    }
}
```

**장점**
- 단순하고 직관적
- 추가 클래스 없음
- 코드 흐름이 한눈에 보임

**단점**
- Step이 많아지면 중첩 try-catch로 복잡해짐
- 로직 재사용이 어려움

### 비교

| 항목 | Orchestrator + Step | try-catch |
|------|---------------------|-----------|
| 클래스 수 | Step마다 1개 | 0개 |
| 코드량 | 많음 | 적음 |
| 확장성 | 좋음 | 보통 |
| 테스트 | Step 단위 가능 | 통합 테스트 |
| 적합한 경우 | Step 4개 이상, 재사용 필요 | Step 2-3개 |

복잡한 MSA 환경에서는 **Axon Framework**, **Temporal**, **Camunda** 같은 전문 도구를 사용하는 것이 일반적이다. 직접 Orchestrator를 구현하는 경우는 드물다.

---

## 우리 프로젝트에 적용

### 선택: try-catch 방식

우리 프로젝트에서는 **try-catch 방식**을 선택했다. 이유는 다음과 같다.

1. **Step이 2개뿐**: Keystone 생성 → DB 저장. Orchestrator 클래스를 만들기엔 과하다.
2. **비즈니스 로직이 크지 않다**: Step이 여러게가 되는 요청이 존재한다면, 필요할 수 도 있겠지만, 아직은 Cloud Service에 대해서만 완성이 되었고, 다른 부가 서비스들이 이어져 있지 않으므로 , try-catch로 충분히 커버가 가능해진다고 판단했다.


Step이 4개 이상으로 늘어나거나, 여러 곳에서 재사용해야 한다면, Orchestartor 방식을 통해서 사용하거나 , Step을 정의하여 트랜잭션과 보상트랜잭션 로직을 Step을 통해서 정의할 수 있도록 확장할 생각이다.

Step을 통해 외부 요청에 대해서 보상트랜잭션을 매핑해놓게 된다면, 추후 MSA 로직을 통한 확장이 더 간편해질 것이라고 판단했다.

### 구현 코드

```java
@Slf4j
@Component
@RequiredArgsConstructor
public class AuthModule {

    private final KeystoneAPIExternalPort keystoneAPIExternalPort;
    private final UserRepositoryPort userRepositoryPort;

    /**
     * 회원가입 - 분산 트랜잭션 보장
     *
     * Step 1: Keystone 사용자 생성 (외부 API)
     * Step 2: DB 저장 (@Transactional)
     *
     * Step 2 실패 시 Step 1을 보상(삭제)한다.
     */
    public String signup(SignupRequest request, String adminToken) {
        String keystoneUserId = null;

        try {
            // Step 1: Keystone 사용자 생성
            keystoneUserId = createKeystoneUser(request, adminToken);

            // Step 2: DB 저장
            saveUserToDatabase(keystoneUserId, request);

            return keystoneUserId;

        } catch (Exception e) {
            // 보상: Keystone 사용자 삭제
            compensateKeystoneUser(keystoneUserId, adminToken);
            throw new SignupFailedException("회원가입 실패", e);
        }
    }

    

    private void compensateKeystoneUser(String userId, String adminToken) {
        if (userId == null) return;

        try {
            keystoneAPIExternalPort.deleteUser(userId, adminToken);
            log.info("Keystone 사용자 삭제 완료 (보상): {}", userId);
        } catch (Exception e) {
            log.error("보상 실패 - 수동 처리 필요: userId={}", userId, e);
            // alertService.sendCriticalAlert(...)
        }
    }
}
```

### 핵심 포인트


**1. 보상 실패 처리**

보상 트랜잭션도 실패할 수 있다. 이 경우 로깅 후 알림을 보내 수동 처리가 필요하다.

```java
private void compensateKeystoneUser(String userId, String adminToken) {
    if (userId == null) return;

    try {
        keystoneAPIExternalPort.deleteUser(userId, adminToken);
    } catch (Exception e) {
        log.error("보상 실패 - 수동 처리 필요: {}", userId, e);
        // Slack, Discord 알림 발송
    }
}
```

**2. Module의 캡슐화**

SAGA 로직이 Module 내부에 있으므로, 다른 도메인에서는 그냥 `authModule.signup()`을 호출하면 된다. 분산 트랜잭션이 어떻게 처리되는지 알 필요 없다.

```java
// 다른 Module에서 사용
public class ProjectModule {
    public void createProjectWithOwner(...) {
        String ownerId = authModule.signup(request, adminToken);
        // SAGA가 적용되었는지 몰라도 됨
    }
}
```

---

## 마무리

### 정리

| 항목 | 내용                       |
|------|--------------------------|
| 문제 | 외부 API + DB 저장에서 정합성 불일치 |
| 해결 | SAGA 패턴 (Orchestration)  |
| 구현 | try-catch + 보상 로직        |
| 이유 | Step 2개, 단순한 비즈니스 로직     |

### SAGA 적용 기준

```
Step 2-3개, 단순한 흐름
→ try-catch + 보상 로직

Step 4개 이상, 재사용 필요
→ Orchestrator + Step 클래스

복잡한 MSA, 이벤트 기반
→ Axon, Temporal, Kafka 등 전문 도구
```

### 참고 자료

- [Microservices Patterns - Chris Richardson](https://microservices.io/patterns/data/saga.html)
- [SAGA Pattern - Microsoft Docs](https://docs.microsoft.com/en-us/azure/architecture/reference-architectures/saga/saga)