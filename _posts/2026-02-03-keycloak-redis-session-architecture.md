---
layout: post
title: "Keycloak + Redis 세션 기반 인증 아키텍처 설계안"
date: 2026-02-03
categories: [Architecture, Security]
tags: [Keycloak, Redis, Session, Spring Security, BFF, Hexagonal]
---

# Keycloak + Redis 세션 기반 인증 아키텍처 설계안

## 1. 개요

### 1.1 현재 상태 (AS-IS)

현재 시스템은 **JWT 토큰 기반의 Stateless 인증**을 사용하고 있습니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                        현재 인증 흐름                            │
├─────────────────────────────────────────────────────────────────┤
│  Client → JWT Token → Spring Security Filter → DB 검증          │
│                                                                  │
│  문제점:                                                         │
│  1. 모든 요청마다 DB에서 토큰 활성화 상태 확인 (비효율적)          │
│  2. 자체 JWT 발급 로직 유지보수 부담                              │
│  3. Keystone 토큰도 DB에 저장 (RDB 부하)                         │
│  4. 로그아웃 시 DB 업데이트 필요                                  │
└─────────────────────────────────────────────────────────────────┘
```

**현재 저장 구조 (PostgreSQL)**:
- `user_tokens`: JWT + Keystone unscoped token
- `refresh_tokens`: Refresh token
- `oauth_verification_tokens`: OAuth 검증용 일회성 토큰

### 1.2 목표 상태 (TO-BE)

**Keycloak OIDC + Redis 세션 기반 인증**으로 전환합니다.

```
┌─────────────────────────────────────────────────────────────────┐
│                        목표 인증 흐름                            │
├─────────────────────────────────────────────────────────────────┤
│  Client → JSESSIONID Cookie → Redis Session 조회                │
│                     ↓                                            │
│         Session에서 Keycloak/Keystone 토큰 획득                  │
│                     ↓                                            │
│         필요한 토큰으로 외부 API 호출                             │
│                                                                  │
│  장점:                                                           │
│  1. Redis 조회로 빠른 세션 검증 (In-Memory)                      │
│  2. Keycloak이 인증/토큰 관리 담당 (책임 분리)                   │
│  3. 세션 만료 = Redis TTL로 자동 관리                            │
│  4. 다중 토큰(Keycloak, Keystone) 통합 관리                      │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 모듈 책임 분리

**AuthModule과 SessionModule을 분리하는 이유:**

| 구분 | AuthModule | SessionModule |
|------|------------|---------------|
| **책임** | 인증 진입점 (로그인, 로그아웃, 회원가입) | 세션/토큰 관리 (저장, 조회, 갱신) |
| **호출자** | AuthController만 | 모든 도메인 Module |
| **변경 이유** | 로그인 방식 변경, 회원가입 프로세스 변경 | 저장소 변경, 토큰 갱신 정책 변경 |

```
┌─────────────────────────────────────────────────────────────────┐
│  AuthController                                                  │
│       │                                                          │
│       ▼                                                          │
│  AuthModule ─────────────────┐                                   │
│  (로그인, 로그아웃, 회원가입)  │                                   │
│       │                      │                                   │
│       │ 세션 생성/삭제        │                                   │
│       ▼                      │                                   │
│  SessionModule ◄─────────────┼──── InstanceModule               │
│  (토큰 저장/조회/갱신)        │     ProjectModule                │
│       │                      │     NetworkModule                 │
│       ▼                      │     VolumeModule                  │
│  SessionRepositoryPort       │     KeypairModule                 │
│  (Redis)                     │     ...모든 도메인                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. 인증 흐름 설계

### 2.1 로그인 흐름 (미인증 상태)

```
┌──────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────┐
│ User │    │ Frontend │    │ Backend  │    │ Keycloak │    │ Redis │
└──┬───┘    └────┬─────┘    └────┬─────┘    └────┬─────┘    └───┬───┘
   │             │               │               │              │
   │ 1. 작업요청  │               │               │              │
   │────────────>│               │               │              │
   │             │ 2. API 요청   │               │              │
   │             │──────────────>│               │              │
   │             │               │               │              │
   │             │ 3. 302 Redirect (to Keycloak) │              │
   │             │<──────────────│               │              │
   │             │               │               │              │
   │ 4. Keycloak 로그인 페이지 리다이렉트        │              │
   │<────────────│               │               │              │
   │             │               │               │              │
   │ 5. 로그인 (ID/PW)           │               │              │
   │─────────────────────────────────────────────>│              │
   │             │               │               │              │
   │ 6. Authorization Code + Redirect to Backend │              │
   │<────────────────────────────────────────────│              │
   │             │               │               │              │
   │ 7. Callback with code       │               │              │
   │─────────────────────────────>│               │              │
   │             │               │               │              │
   │             │               │ 8. Token 교환  │              │
   │             │               │──────────────>│              │
   │             │               │               │              │
   │             │               │ 9. Keycloak Tokens            │
   │             │               │<──────────────│              │
   │             │               │               │              │
   │             │               │ 10. Keystone Federation Token │
   │             │               │──────────────────────────────>│
   │             │               │               │              │
   │             │               │ 11. Session 저장              │
   │             │               │─────────────────────────────>│
   │             │               │               │              │
   │ 12. Set-Cookie: JSESSIONID  │               │              │
   │<────────────────────────────│               │              │
   │             │               │               │              │
```

### 2.2 인증된 요청 흐름 (로그인 상태)

```
┌──────┐    ┌──────────┐    ┌──────────┐    ┌───────┐    ┌──────────┐
│ User │    │ Frontend │    │ Backend  │    │ Redis │    │ Keycloak │
└──┬───┘    └────┬─────┘    └────┬─────┘    └───┬───┘    └────┬─────┘
   │             │               │              │              │
   │ 1. 작업요청  │               │              │              │
   │────────────>│               │              │              │
   │             │ 2. API + Cookie              │              │
   │             │──────────────>│              │              │
   │             │               │              │              │
   │             │               │ 3. Session 조회              │
   │             │               │─────────────>│              │
   │             │               │              │              │
   │             │               │ 4. Session Data              │
   │             │               │<─────────────│              │
   │             │               │              │              │
   │             │               │ 5. Token 유효성 검증         │
   │             │               │─────────────────────────────>│
   │             │               │              │              │
   │             │               │ 6. 검증 결과 │              │
   │             │               │<─────────────────────────────│
   │             │               │              │              │
   │             │               │ 7. 비즈니스 로직 수행        │
   │             │               │ (Keystone API with token)   │
   │             │               │              │              │
   │             │ 8. 응답       │              │              │
   │             │<──────────────│              │              │
   │ 9. 결과     │               │              │              │
   │<────────────│               │              │              │
```

### 2.3 토큰 갱신 흐름

```
┌──────────┐    ┌───────┐    ┌──────────┐
│ Backend  │    │ Redis │    │ Keycloak │
└────┬─────┘    └───┬───┘    └────┬─────┘
     │              │              │
     │ 1. Session에서 Token 조회   │
     │─────────────>│              │
     │              │              │
     │ 2. Token 반환 (만료 임박)   │
     │<─────────────│              │
     │              │              │
     │ 3. Refresh Token으로 갱신   │
     │────────────────────────────>│
     │              │              │
     │ 4. 새 Tokens │              │
     │<────────────────────────────│
     │              │              │
     │ 5. Session 업데이트         │
     │─────────────>│              │
     │              │              │
```

---

## 3. Redis 세션 구조 설계

### 3.1 세션 키 설계

```
Redis Key Pattern:
session:{sessionId}

예시:
session:abc123-def456-ghi789
```

### 3.2 세션 데이터 구조

```json
{
  "sessionId": "abc123-def456-ghi789",
  "userId": "keystone-user-id-xxx",
  "createdAt": "2026-02-03T10:00:00Z",
  "lastAccessedAt": "2026-02-03T10:30:00Z",

  "keycloakToken": {
    "accessToken": "eyJhbGciOiJSUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "idToken": "eyJhbGciOiJSUzI1NiIs...",
    "expiresAt": "2026-02-03T10:05:00Z",
    "refreshExpiresAt": "2026-02-03T10:30:00Z",
    "scope": "openid profile email"
  },

  "keystoneToken": {
    "unscopedToken": "gAAAAA...",
    "expiresAt": "2026-02-04T10:00:00Z",
    "scopedTokens": {
      "project-id-1": {
        "token": "gAAAAA...",
        "expiresAt": "2026-02-04T10:00:00Z",
        "roles": ["admin", "member"]
      },
      "project-id-2": {
        "token": "gAAAAA...",
        "expiresAt": "2026-02-04T10:00:00Z",
        "roles": ["member"]
      }
    }
  },

  "userInfo": {
    "email": "user@example.com",
    "name": "홍길동",
    "department": "소프트웨어학과",
    "studentId": "202012345"
  }
}
```

### 3.3 TTL(Time To Live) 전략

| 항목 | TTL | 설명 |
|------|-----|------|
| 세션 기본 TTL | 30분 | 마지막 접근 후 30분 미활동 시 만료 |
| 세션 최대 TTL | 8시간 | 절대 만료 시간 (재인증 필요) |
| Sliding Window | 활성화 | 요청마다 TTL 갱신 |

```
Redis TTL 설정:
SETEX session:{id} 1800 {data}  # 30분 (1800초)

요청 시 갱신:
EXPIRE session:{id} 1800        # TTL 리셋
```

---

## 4. 포트-어댑터 패턴 적용

### 4.1 신규 포트 정의

#### SessionRepositoryPort (세션 저장소 포트)

```java
public interface SessionRepositoryPort {

    /**
     * 새 세션 저장
     */
    void save(Session session);

    /**
     * 세션 조회
     */
    Optional<Session> findById(String sessionId);

    /**
     * 세션 업데이트
     */
    void update(Session session);

    /**
     * 세션 삭제
     */
    void delete(String sessionId);

    /**
     * 세션 TTL 갱신 (Sliding Window)
     */
    void refreshTTL(String sessionId);

    /**
     * 사용자의 모든 세션 ID 조회
     */
    Set<String> findSessionIdsByUserId(String userId);

    /**
     * 사용자의 모든 세션 삭제 (전체 로그아웃)
     */
    void deleteAllByUserId(String userId);
}
```

#### KeycloakExternalPort (Keycloak 연동 포트)

```java
public interface KeycloakExternalPort {

    /**
     * Authorization Code로 토큰 교환
     */
    KeycloakTokens exchangeCodeForTokens(String authorizationCode,
                                          String redirectUri);

    /**
     * 토큰 검증 (Introspect)
     */
    TokenIntrospectionResult introspectToken(String accessToken);

    /**
     * Refresh Token으로 토큰 갱신
     */
    KeycloakTokens refreshTokens(String refreshToken);

    /**
     * 토큰 폐기 (로그아웃)
     */
    void revokeToken(String token);

    /**
     * Authorization URL 생성
     */
    String buildAuthorizationUrl(String state, String redirectUri);
}
```

### 4.2 Module 구현

#### SessionModule (핵심: 토큰 제공자)

```java
@Component
@RequiredArgsConstructor
public class SessionModule {

    private static final int REFRESH_THRESHOLD_SECONDS = 60;

    private final SessionRepositoryPort sessionRepositoryPort;
    private final KeycloakExternalPort keycloakExternalPort;
    private final KeystoneAPIExternalPort keystoneAPIExternalPort;

    // ========== 세션 생명주기 ==========

    /**
     * 새 세션 생성 (AuthModule에서 호출)
     */
    public String createSession(String userId, KeycloakTokens keycloakTokens,
                                 KeystoneToken keystoneToken, UserInfo userInfo) {
        Session session = Session.create(userId, keycloakTokens, keystoneToken, userInfo);
        sessionRepositoryPort.save(session);
        return session.getSessionId();
    }

    /**
     * 세션 삭제 (AuthModule에서 호출)
     */
    public void deleteSession(String sessionId) {
        sessionRepositoryPort.delete(sessionId);
    }

    /**
     * 사용자의 모든 세션 삭제 (전체 로그아웃)
     */
    public void deleteAllUserSessions(String userId) {
        sessionRepositoryPort.deleteAllByUserId(userId);
    }

    // ========== 토큰 조회 (다른 Module에서 호출) ==========

    /**
     * Keycloak Access Token 조회 (만료 시 자동 갱신)
     */
    public String getKeycloakAccessToken() {
        Session session = getCurrentSession();
        KeycloakTokens tokens = session.getKeycloakTokens();

        if (tokens.isExpiredOrExpiringSoon(REFRESH_THRESHOLD_SECONDS)) {
            if (tokens.isRefreshExpired()) {
                throw new SessionExpiredException("Re-login required");
            }
            refreshKeycloakTokens(session);
        }

        return session.getKeycloakTokens().getAccessToken();
    }

    /**
     * Keystone Unscoped Token 조회 (만료 시 Keycloak으로 재발급)
     */
    public String getKeystoneUnscopedToken() {
        Session session = getCurrentSession();
        KeystoneTokens tokens = session.getKeystoneTokens();

        if (tokens.isUnscopedExpired()) {
            String keycloakToken = getKeycloakAccessToken();
            refreshKeystoneUnscopedToken(session, keycloakToken);
        }

        return session.getKeystoneTokens().getUnscopedToken();
    }

    /**
     * Keystone Scoped Token 조회 (캐시 미스 시 발급)
     */
    public String getKeystoneScopedToken(String projectId) {
        Session session = getCurrentSession();
        KeystoneTokens tokens = session.getKeystoneTokens();

        if (!tokens.hasScopedToken(projectId) || tokens.isScopedExpired(projectId)) {
            String unscopedToken = getKeystoneUnscopedToken();
            issueScopedTokenAndCache(session, projectId, unscopedToken);
        }

        return session.getKeystoneTokens().getScopedToken(projectId);
    }

    /**
     * 현재 사용자 ID 조회
     */
    public String getCurrentUserId() {
        return getCurrentSession().getUserId();
    }

    /**
     * 현재 사용자 정보 조회
     */
    public UserInfo getCurrentUserInfo() {
        return getCurrentSession().getUserInfo();
    }

    // ========== Private Methods ==========

    private Session getCurrentSession() {
        return SessionContextHolder.getSession()
            .orElseThrow(() -> new AuthServiceException(UNAUTHORIZED));
    }

    private void refreshKeycloakTokens(Session session) {
        KeycloakTokens newTokens = keycloakExternalPort
            .refreshTokens(session.getKeycloakTokens().getRefreshToken());
        session.updateKeycloakTokens(newTokens);
        sessionRepositoryPort.update(session);
    }

    private void refreshKeystoneUnscopedToken(Session session, String keycloakToken) {
        KeystoneToken newToken = keystoneAPIExternalPort
            .requestFederatedToken(keycloakToken);
        session.updateKeystoneUnscopedToken(newToken);
        sessionRepositoryPort.update(session);
    }

    private void issueScopedTokenAndCache(Session session, String projectId, String unscopedToken) {
        KeystoneToken scopedToken = keystoneAPIExternalPort
            .getScopedToken(projectId, unscopedToken);
        session.addKeystoneScopedToken(projectId, scopedToken);
        sessionRepositoryPort.update(session);
    }
}
```

#### AuthModule (인증 진입점)

```java
@Component
@RequiredArgsConstructor
public class AuthModule {

    private final SessionModule sessionModule;
    private final KeycloakExternalPort keycloakExternalPort;
    private final KeystoneAPIExternalPort keystoneAPIExternalPort;
    private final UserRepositoryPort userRepositoryPort;

    /**
     * Keycloak 콜백 처리 → 세션 생성
     */
    public String handleKeycloakCallback(String authorizationCode, String redirectUri) {
        // 1. Keycloak 토큰 교환
        KeycloakTokens keycloakTokens = keycloakExternalPort
            .exchangeCodeForTokens(authorizationCode, redirectUri);

        // 2. Keystone Federation 인증
        KeystoneToken keystoneToken = keystoneAPIExternalPort
            .requestFederatedToken(keycloakTokens.getAccessToken());

        // 3. 사용자 정보 추출/조회
        String userId = extractUserIdFromToken(keycloakTokens.getIdToken());
        UserInfo userInfo = getUserInfo(userId, keycloakTokens.getIdToken());

        // 4. 세션 생성 (SessionModule에 위임)
        return sessionModule.createSession(userId, keycloakTokens, keystoneToken, userInfo);
    }

    /**
     * 로그아웃
     */
    public void logout(String sessionId) {
        Session session = sessionModule.getSessionById(sessionId);

        // Keycloak 토큰 폐기
        keycloakExternalPort.revokeToken(
            session.getKeycloakTokens().getRefreshToken());

        // 세션 삭제
        sessionModule.deleteSession(sessionId);
    }

    /**
     * 전체 기기 로그아웃
     */
    public void logoutAllDevices(String userId) {
        sessionModule.deleteAllUserSessions(userId);
    }

    /**
     * 회원가입 (필요시)
     */
    public SignupResponse signup(SignupRequest request, String keycloakToken) {
        // 기존 회원가입 로직...
    }
}
```

### 4.3 어댑터 구현

#### RedisSessionAdapter

```
위치: local/session/adapters/RedisSessionAdapter.java
역할: Redis를 사용한 세션 저장/조회 구현
구현 포트: SessionRepositoryPort
```

**Redis 저장 구조 (Hash):**
```
HSET session:{sessionId}
  keycloakTokens    → JSON string
  keystoneTokens    → JSON string
  userInfo          → JSON string
  userId            → string
  createdAt         → timestamp
  lastAccessedAt    → timestamp

EXPIRE session:{sessionId} 1800  # 30분 TTL

SADD user:sessions:{userId} {sessionId}  # 사용자별 세션 인덱스
```

**주요 기능**:
- Redis Hash를 사용한 세션 저장 (부분 업데이트 가능)
- JSON 직렬화/역직렬화 (Jackson)
- TTL 관리 (Sliding Window)
- 사용자별 세션 인덱스 관리 (전체 로그아웃용)

#### KeycloakExternalAdapter

```
위치: local/external/adapters/keycloak/KeycloakExternalAdapter.java
역할: Keycloak OIDC API 호출 구현
구현 포트: KeycloakExternalPort
```

**주요 기능**:
- WebClient를 사용한 Keycloak REST API 호출
- Token Endpoint 호출 (code → tokens)
- Introspect Endpoint 호출 (토큰 검증)
- Token Refresh
- Token Revocation

---

## 5. 패키지 구조

### 5.1 신규 패키지 구조

```
com.acc
├── global/
│   ├── config/
│   │   ├── SecurityConfig.java        # 수정: 세션 기반으로 변경
│   │   ├── RedisConfig.java           # 신규: Redis 설정
│   │   └── KeycloakConfig.java        # 신규: Keycloak WebClient 설정
│   │
│   ├── properties/
│   │   ├── RedisProperties.java       # 신규
│   │   └── KeycloakProperties.java    # 신규
│   │
│   └── security/
│       └── session/                   # 신규: 세션 인증 필터
│           ├── SessionAuthenticationFilter.java
│           └── SessionContextHolder.java
│
└── local/
    ├── session/                       # 신규: 세션 도메인
    │   ├── domain/
    │   │   ├── Session.java
    │   │   ├── KeycloakTokens.java
    │   │   └── KeystoneTokens.java
    │   │
    │   ├── module/
    │   │   └── SessionModule.java     # 핵심: 토큰 제공자
    │   │
    │   └── repository/
    │       ├── ports/
    │       │   └── SessionRepositoryPort.java
    │       └── adapters/
    │           └── RedisSessionAdapter.java
    │
    ├── external/
    │   ├── ports/
    │   │   └── KeycloakExternalPort.java    # 신규
    │   │
    │   └── adapters/
    │       └── keycloak/                    # 신규
    │           └── KeycloakExternalAdapter.java
    │
    └── service/modules/auth/
        └── AuthModule.java            # 수정: 로그인/로그아웃만 담당
```

### 5.2 계층별 의존성 구조

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Controller Layer                              │
│  AuthController, InstanceController, ProjectController, ...         │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Service Adapter Layer                            │
│  AuthServiceAdapter, InstanceServiceAdapter, ...                     │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Module Layer                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │ AuthModule  │  │InstanceModule│ │ProjectModule│  ...             │
│  │(로그인/로그아웃)│ │             │  │             │                  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                  │
│         │                │                │                          │
│         │                └────────────────┼──────────┐               │
│         │                                 │          │               │
│         ▼                                 ▼          ▼               │
│  ┌──────────────────────────────────────────────────────┐           │
│  │              SessionModule (공통 토큰 제공)           │           │
│  │  - getKeycloakAccessToken()                          │           │
│  │  - getKeystoneUnscopedToken()                        │           │
│  │  - getKeystoneScopedToken(projectId)                 │           │
│  │  - getCurrentUserId()                                │           │
│  └──────────────────────────────────────────────────────┘           │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Port Layer (인터페이스)                           │
│  SessionRepositoryPort    KeycloakExternalPort    KeystoneAPIExternalPort
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Adapter Layer (구현체)                          │
│  RedisSessionAdapter    KeycloakExternalAdapter    KeystoneAPIExternalAdapter
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 수정 대상 기존 패키지

```
수정 필요:
├── global/config/SecurityConfig.java
│   - SessionCreationPolicy.STATELESS → IF_REQUIRED
│   - JwtAuthenticationFilter 제거
│   - SessionAuthenticationFilter 추가
│
├── local/service/adapters/auth/AuthServiceAdapter.java
│   - JWT 발급 로직 제거
│   - Keycloak 콜백 처리로 변경
│
├── local/service/modules/auth/AuthModule.java
│   - JWT 관련 로직 제거
│   - SessionModule 의존성 추가
│   - 로그인/로그아웃/회원가입만 담당
│
└── local/service/modules/**/*Module.java (모든 도메인 Module)
│   - AuthModule.getUnscopedTokenByUserId()
│     → SessionModule.getKeystoneUnscopedToken() 변경
│   - AuthModule.issueProjectScopeToken()
│     → SessionModule.getKeystoneScopedToken() 변경

제거 대상:
├── global/security/jwt/              # 전체 제거
│   ├── JwtUtils.java
│   ├── JwtInfo.java
│   └── JwtAuthenticationFilter.java
│
├── local/entity/
│   ├── UserTokenEntity.java          # 제거 (Redis 세션으로 대체)
│   ├── RefreshTokenEntity.java       # 제거 (Keycloak이 관리)
│   └── OAuthVerificationTokenEntity.java  # 제거
│
└── local/repository/
    ├── UserTokenRepositoryPort.java   # 제거
    ├── RefreshTokenRepositoryPort.java # 제거
    ├── OAuthVerificationTokenRepositoryPort.java # 제거
    └── 관련 Adapter 및 JPA Repository들  # 제거
```

### 5.4 기존 코드 마이그레이션 예시

**Before (기존 AuthModule 사용):**
```java
@Component
@RequiredArgsConstructor
public class ProjectModule {
    private final AuthModule authModule;
    private final KeystoneAPIExternalPort keystoneAPIExternalPort;

    public void updateProject(String projectId, UpdateRequest request, String requesterId) {
        String keystoneToken = authModule.getUnscopedTokenByUserId(requesterId);
        keystoneAPIExternalPort.updateProject(projectId, keystoneToken, request);
    }
}
```

**After (SessionModule 사용):**
```java
@Component
@RequiredArgsConstructor
public class ProjectModule {
    private final SessionModule sessionModule;  // AuthModule → SessionModule
    private final KeystoneAPIExternalPort keystoneAPIExternalPort;

    public void updateProject(String projectId, UpdateRequest request) {
        // requesterId 파라미터 불필요 (세션에서 자동 획득)
        String keystoneToken = sessionModule.getKeystoneUnscopedToken();
        keystoneAPIExternalPort.updateProject(projectId, keystoneToken, request);
    }
}
```

---

## 6. Spring Security 설정 변경

### 6.1 SecurityConfig 변경안

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final SessionAuthenticationFilter sessionAuthenticationFilter;
    private final KeycloakProperties keycloakProperties;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
            // 세션 정책: 필요시 생성 (기존 STATELESS → IF_REQUIRED)
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED)
                .maximumSessions(1)  // 동시 로그인 제한
                .maxSessionsPreventsLogin(false)  // 새 로그인이 기존 세션 대체
            )

            // CSRF: 쿠키 기반이므로 활성화 권장 (또는 SameSite로 대체)
            .csrf(csrf -> csrf
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            )

            // 세션 인증 필터
            .addFilterBefore(sessionAuthenticationFilter,
                            UsernamePasswordAuthenticationFilter.class)

            // OAuth2 Login (Keycloak)
            .oauth2Login(oauth2 -> oauth2
                .authorizationEndpoint(auth -> auth
                    .baseUri("/oauth2/authorization")
                )
                .redirectionEndpoint(redir -> redir
                    .baseUri("/api/v1/auth/callback")
                )
                .tokenEndpoint(token -> token
                    .accessTokenResponseClient(keycloakTokenResponseClient())
                )
                .successHandler(keycloakSuccessHandler())
                .failureHandler(keycloakFailureHandler())
            )

            // 엔드포인트 권한
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/v1/auth/**").permitAll()
                .requestMatchers("/oauth2/**").permitAll()
                .requestMatchers("/api/v1/public/**").permitAll()
                .anyRequest().authenticated()
            )

            .build();
    }
}
```

### 6.2 SessionAuthenticationFilter

```java
@Component
public class SessionAuthenticationFilter extends OncePerRequestFilter {

    private final SessionPort sessionPort;
    private final KeycloakPort keycloakPort;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) {

        // 1. 쿠키에서 세션 ID 추출
        String sessionId = extractSessionId(request);

        if (sessionId != null) {
            // 2. Redis에서 세션 조회
            Optional<Session> sessionOpt = sessionPort.getSession(sessionId);

            if (sessionOpt.isPresent()) {
                Session session = sessionOpt.get();

                // 3. Keycloak 토큰 유효성 검증
                if (isTokenValid(session)) {
                    // 4. SecurityContext 설정
                    setAuthentication(session);

                    // 5. SessionContext 설정 (토큰 접근용)
                    SessionContextHolder.setSession(session);

                    // 6. TTL 갱신 (Sliding Window)
                    sessionPort.refreshSessionTTL(sessionId);
                }
            }
        }

        try {
            chain.doFilter(request, response);
        } finally {
            SessionContextHolder.clear();
        }
    }

    private boolean isTokenValid(Session session) {
        // Keycloak Access Token 만료 확인
        if (session.getKeycloakToken().isExpired()) {
            // Refresh Token으로 갱신 시도
            try {
                KeycloakTokens newTokens = keycloakPort.refreshTokens(
                    session.getKeycloakToken().getRefreshToken()
                );
                session.updateKeycloakTokens(newTokens);
                sessionPort.updateSession(session.getSessionId(), session);
                return true;
            } catch (Exception e) {
                return false;  // 갱신 실패 시 재로그인 필요
            }
        }
        return true;
    }
}
```

---

## 7. 도메인별 토큰 사용 패턴

### 7.1 SessionModule 활용

```java
// 기존 방식 (AuthModule + userId 파라미터)
@Component
@RequiredArgsConstructor
public class InstanceModule {
    private final AuthModule authModule;
    private final NovaServerExternalPort novaServerExternalPort;

    public void createInstance(String projectId, InstanceCreateRequest request, String userId) {
        // userId를 파라미터로 받아서 토큰 발급
        String keystoneToken = authModule.issueProjectScopeToken(projectId, userId);
        novaServerExternalPort.callCreateInstance(keystoneToken, projectId, request);
    }
}

// 변경 후 (SessionModule 사용)
@Component
@RequiredArgsConstructor
public class InstanceModule {
    private final SessionModule sessionModule;
    private final NovaServerExternalPort novaServerExternalPort;

    public void createInstance(String projectId, InstanceCreateRequest request) {
        // userId 파라미터 불필요 - 세션에서 자동 획득 + 만료 시 자동 갱신
        String keystoneToken = sessionModule.getKeystoneScopedToken(projectId);
        novaServerExternalPort.callCreateInstance(keystoneToken, projectId, request);
    }
}
```

### 7.2 도메인별 토큰 사용 매핑

| 도메인 | 필요 토큰 | SessionModule 메서드 |
|--------|----------|-------------------------|
| 사용자 관리 | Keycloak Token | `getKeycloakAccessToken()` |
| 프로젝트 목록 | Keystone Unscoped | `getKeystoneUnscopedToken()` |
| 인스턴스 생성 | Keystone Scoped | `getKeystoneScopedToken(projectId)` |
| 네트워크 생성 | Keystone Scoped | `getKeystoneScopedToken(projectId)` |
| 볼륨 관리 | Keystone Scoped | `getKeystoneScopedToken(projectId)` |
| 이미지 조회 | Keystone Unscoped | `getKeystoneUnscopedToken()` |
| Keypair 관리 | Keystone Scoped | `getKeystoneScopedToken(projectId)` |

### 7.3 토큰 갱신 체인

SessionModule 내부에서 토큰 만료 시 자동으로 갱신 체인이 동작합니다:

```
┌─────────────────────────────────────────────────────────────────┐
│                    토큰 갱신 의존성 체인                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  getKeystoneScopedToken(projectId)                              │
│         │                                                        │
│         │ Scoped 토큰 만료 시                                     │
│         ▼                                                        │
│  getKeystoneUnscopedToken()                                      │
│         │                                                        │
│         │ Unscoped 토큰 만료 시 (24시간 경과)                      │
│         ▼                                                        │
│  getKeycloakAccessToken()                                        │
│         │                                                        │
│         │ Access Token 만료 시 (5분 경과)                         │
│         ▼                                                        │
│  keycloakExternalPort.refreshTokens(refreshToken)               │
│         │                                                        │
│         │ Refresh Token 만료 시 (30분 경과)                       │
│         ▼                                                        │
│  SessionExpiredException → 재로그인 필요                          │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 7.4 Keystone Scoped Token 캐싱 전략

```java
// SessionModule 내부 구현
public String getKeystoneScopedToken(String projectId) {
    Session session = getCurrentSession();
    KeystoneTokens tokens = session.getKeystoneTokens();

    // 1. 캐시 확인 (세션에 저장된 Scoped 토큰)
    if (tokens.hasScopedToken(projectId) && !tokens.isScopedExpired(projectId)) {
        return tokens.getScopedToken(projectId);  // 캐시 히트
    }

    // 2. 캐시 미스 → Unscoped 토큰으로 Scoped 토큰 발급
    String unscopedToken = getKeystoneUnscopedToken();  // 만료 시 갱신됨
    KeystoneToken scopedToken = keystoneAPIExternalPort
        .getScopedToken(projectId, unscopedToken);

    // 3. 세션에 캐시 저장
    session.addKeystoneScopedToken(projectId, scopedToken);
    sessionRepositoryPort.update(session);

    return scopedToken.getToken();
}
```

**캐싱 효과:**
- 같은 프로젝트에 대한 반복 요청 시 Keystone API 호출 감소
- Scoped Token은 24시간 유효 → 하루 동안 캐시 재사용
- 여러 프로젝트 접근 시 각 프로젝트별로 캐시

---

## 8. Redis 인프라 구성

### 8.1 Redis 설정

```yaml
# application.yml
spring:
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
      password: ${REDIS_PASSWORD:}
      timeout: 3000ms
      lettuce:
        pool:
          max-active: 10
          max-idle: 5
          min-idle: 2
          max-wait: 3000ms
```

### 8.2 RedisConfig

```java
@Configuration
public class RedisConfig {

    @Bean
    public RedisTemplate<String, Object> redisTemplate(
            RedisConnectionFactory factory) {

        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);

        // Key: String
        template.setKeySerializer(new StringRedisSerializer());

        // Value: JSON
        ObjectMapper mapper = new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        template.setValueSerializer(
            new GenericJackson2JsonRedisSerializer(mapper));

        template.setHashKeySerializer(new StringRedisSerializer());
        template.setHashValueSerializer(
            new GenericJackson2JsonRedisSerializer(mapper));

        return template;
    }
}
```

### 8.3 Redis 키 구조

```
# 세션 데이터
session:{sessionId}              → Session JSON
TTL: 1800초 (30분)

# 사용자별 세션 인덱스 (전체 로그아웃용)
user:sessions:{userId}           → Set<sessionId>
TTL: 28800초 (8시간)

# 예시
session:abc123-def456            → {"userId": "xxx", "keycloakToken": {...}}
user:sessions:keystone-user-123  → ["abc123-def456", "ghi789-jkl012"]
```

---

## 9. 마이그레이션 계획

### 9.1 단계별 전환

```
Phase 1: 인프라 준비
├── Redis 서버 구축
├── Keycloak Client 설정
└── 신규 패키지 구조 생성

Phase 2: 병렬 운영
├── 기존 JWT 인증 유지
├── 세션 기반 인증 추가 (Feature Flag)
└── 점진적 트래픽 전환

Phase 3: 전체 전환
├── JWT 인증 비활성화
├── 레거시 테이블 데이터 마이그레이션 (필요시)
└── 레거시 코드 제거

Phase 4: 정리
├── user_tokens 테이블 제거
├── refresh_tokens 테이블 제거
├── JWT 관련 코드 제거
└── 문서 업데이트
```

### 9.2 롤백 전략

```
Feature Flag: session.auth.enabled=true/false

롤백 시:
1. session.auth.enabled=false 설정
2. 기존 JWT 인증으로 자동 전환
3. Redis 세션은 TTL로 자동 만료
```

---

## 10. 보안 고려사항

### 10.1 세션 보안

| 항목 | 설정 | 설명 |
|------|------|------|
| Session ID | UUID v4 | 예측 불가능한 랜덤 값 |
| Cookie HttpOnly | true | XSS 방지 |
| Cookie Secure | true | HTTPS만 |
| Cookie SameSite | Lax/Strict | CSRF 방지 |
| Session Fixation | 로그인 시 재생성 | 세션 고정 공격 방지 |

### 10.2 토큰 보안

| 항목 | 설정 | 설명 |
|------|------|------|
| Keycloak Token | Redis에만 저장 | 클라이언트 노출 없음 |
| Keystone Token | Redis에만 저장 | 클라이언트 노출 없음 |
| Token Refresh | 서버 사이드 | 클라이언트가 토큰 갱신 불필요 |
| Token Revocation | 세션 삭제 시 | 로그아웃 시 Keycloak 토큰도 폐기 |

### 10.3 Redis 보안

```yaml
# Redis 보안 설정
redis:
  requirepass: ${REDIS_PASSWORD}
  protected-mode: yes
  bind: 127.0.0.1  # 또는 내부 네트워크만
```

---

## 11. 모니터링 및 로깅

### 11.1 메트릭

```
# Prometheus 메트릭 예시
session_created_total              # 생성된 세션 수
session_expired_total              # 만료된 세션 수
session_active_count               # 현재 활성 세션 수
token_refresh_total                # 토큰 갱신 횟수
token_refresh_failed_total         # 토큰 갱신 실패 횟수
redis_connection_pool_active       # Redis 연결 풀 상태
```

### 11.2 로깅

```
# 세션 관련 로그
[INFO] Session created: sessionId=abc123, userId=xxx
[INFO] Session accessed: sessionId=abc123, endpoint=/api/v1/instances
[WARN] Session expired: sessionId=abc123
[INFO] Token refreshed: sessionId=abc123
[ERROR] Token refresh failed: sessionId=abc123, reason=invalid_grant
```

---

## 12. 결론

### 12.1 기대 효과

| 항목 | 기존 (JWT + DB) | 변경 후 (Session + Redis) |
|------|----------------|--------------------------|
| 인증 검증 속도 | ~50ms (DB 조회) | ~1ms (Redis 조회) |
| 로그아웃 | DB 업데이트 필요 | 세션 삭제로 즉시 반영 |
| 토큰 관리 | 자체 구현 | Keycloak 위임 |
| 확장성 | DB 부하 증가 | Redis 수평 확장 가능 |
| 보안 | 토큰 노출 위험 | 토큰 서버에만 저장 |

### 12.2 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Client (Browser)                           │
│                     Cookie: JSESSIONID=abc123                       │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Spring Security                              │
│                  SessionAuthenticationFilter                         │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
┌─────────────────────┐ ┌─────────────────┐ ┌─────────────────────────┐
│    SessionPort      │ │  KeycloakPort   │ │   TokenResolverPort     │
│ (세션 CRUD 추상화)   │ │ (OIDC 연동)     │ │ (도메인별 토큰 제공)     │
└──────────┬──────────┘ └────────┬────────┘ └────────────┬────────────┘
           │                     │                       │
           ▼                     ▼                       │
┌─────────────────────┐ ┌─────────────────┐              │
│ RedisSessionAdapter │ │ KeycloakAdapter │              │
└──────────┬──────────┘ └────────┬────────┘              │
           │                     │                       │
           ▼                     ▼                       │
┌─────────────────────┐ ┌─────────────────┐              │
│       Redis         │ │    Keycloak     │              │
│  (세션 + 토큰 저장)  │ │   (IdP 서버)    │              │
└─────────────────────┘ └─────────────────┘              │
                                                         │
                        ┌────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Domain Service Adapters                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │
│  │  Instance   │ │   Network   │ │   Volume    │ │   Image     │    │
│  │  Service    │ │   Service   │ │   Service   │ │   Service   │    │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘ └──────┬──────┘    │
└─────────┼───────────────┼───────────────┼───────────────┼───────────┘
          │               │               │               │
          └───────────────┴───────────────┴───────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    External API Adapters                             │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐        │
│  │ KeystoneAdapter │ │   NovaAdapter   │ │ NeutronAdapter  │        │
│  └────────┬────────┘ └────────┬────────┘ └────────┬────────┘        │
└───────────┼───────────────────┼───────────────────┼─────────────────┘
            │                   │                   │
            ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                       OpenStack APIs                                 │
│            Keystone / Nova / Neutron / Cinder / Glance              │
└─────────────────────────────────────────────────────────────────────┘
```

### 12.3 다음 단계

1. **팀 리뷰**: 본 설계안에 대한 팀 피드백 수집
2. **POC 구현**: 핵심 인증 흐름 프로토타입 개발
3. **인프라 준비**: Redis 서버 및 Keycloak Client 설정
4. **점진적 전환**: Feature Flag 기반 병렬 운영 후 전환

---

## 부록: 주요 클래스 시그니처

### A.1 Session 도메인 모델

```java
@Getter
public class Session {
    private final String sessionId;
    private final String userId;
    private final LocalDateTime createdAt;
    private LocalDateTime lastAccessedAt;

    private KeycloakTokens keycloakTokens;
    private KeystoneTokens keystoneTokens;
    private UserInfo userInfo;

    // 생성
    public static Session create(String userId, KeycloakTokens keycloakTokens,
                                  KeystoneToken keystoneToken, UserInfo userInfo) {
        return new Session(
            UUID.randomUUID().toString(),
            userId,
            LocalDateTime.now(),
            LocalDateTime.now(),
            keycloakTokens,
            KeystoneTokens.fromUnscopedToken(keystoneToken),
            userInfo
        );
    }

    // 토큰 업데이트
    public void updateKeycloakTokens(KeycloakTokens newTokens);
    public void updateKeystoneUnscopedToken(KeystoneToken token);
    public void addKeystoneScopedToken(String projectId, KeystoneToken token);

    // 접근 시간 갱신
    public void touch() {
        this.lastAccessedAt = LocalDateTime.now();
    }
}
```

### A.2 KeycloakTokens

```java
@Getter
@Builder
public class KeycloakTokens {
    private String accessToken;
    private String refreshToken;
    private String idToken;
    private LocalDateTime expiresAt;
    private LocalDateTime refreshExpiresAt;
    private String scope;

    public boolean isExpired() {
        return LocalDateTime.now().isAfter(expiresAt);
    }

    public boolean isRefreshExpired() {
        return LocalDateTime.now().isAfter(refreshExpiresAt);
    }

    public boolean isExpiredOrExpiringSoon(int thresholdSeconds) {
        return LocalDateTime.now().plusSeconds(thresholdSeconds).isAfter(expiresAt);
    }
}
```

### A.3 KeystoneTokens

```java
@Getter
public class KeystoneTokens {
    private String unscopedToken;
    private LocalDateTime unscopedExpiresAt;
    private Map<String, ScopedToken> scopedTokens = new HashMap<>();

    public static KeystoneTokens fromUnscopedToken(KeystoneToken token) {
        KeystoneTokens tokens = new KeystoneTokens();
        tokens.unscopedToken = token.getToken();
        tokens.unscopedExpiresAt = token.getExpiresAt();
        return tokens;
    }

    public boolean isUnscopedExpired() {
        return LocalDateTime.now().isAfter(unscopedExpiresAt);
    }

    public boolean hasScopedToken(String projectId) {
        return scopedTokens.containsKey(projectId);
    }

    public boolean isScopedExpired(String projectId) {
        ScopedToken token = scopedTokens.get(projectId);
        return token == null || token.isExpired();
    }

    public String getScopedToken(String projectId) {
        return scopedTokens.get(projectId).getToken();
    }

    public void addScopedToken(String projectId, KeystoneToken token) {
        scopedTokens.put(projectId, new ScopedToken(
            token.getToken(),
            token.getExpiresAt(),
            token.getRoles()
        ));
    }

    public void updateUnscopedToken(KeystoneToken token) {
        this.unscopedToken = token.getToken();
        this.unscopedExpiresAt = token.getExpiresAt();
    }

    @Getter
    @AllArgsConstructor
    public static class ScopedToken {
        private final String token;
        private final LocalDateTime expiresAt;
        private final List<String> roles;

        public boolean isExpired() {
            return LocalDateTime.now().isAfter(expiresAt);
        }
    }
}
```

### A.4 SessionContextHolder

```java
/**
 * 현재 요청의 세션 정보를 ThreadLocal로 관리
 * Filter에서 설정하고, Module에서 조회
 */
public class SessionContextHolder {

    private static final ThreadLocal<Session> sessionHolder = new ThreadLocal<>();

    public static void setSession(Session session) {
        sessionHolder.set(session);
    }

    public static Optional<Session> getSession() {
        return Optional.ofNullable(sessionHolder.get());
    }

    public static void clear() {
        sessionHolder.remove();
    }
}
```

### A.5 SessionAuthenticationFilter

```java
@Component
@RequiredArgsConstructor
public class SessionAuthenticationFilter extends OncePerRequestFilter {

    private final SessionRepositoryPort sessionRepositoryPort;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        try {
            // 1. 쿠키에서 세션 ID 추출
            String sessionId = extractSessionIdFromCookie(request);

            if (sessionId != null) {
                // 2. Redis에서 세션 조회
                Optional<Session> sessionOpt = sessionRepositoryPort.findById(sessionId);

                if (sessionOpt.isPresent()) {
                    Session session = sessionOpt.get();

                    // 3. SecurityContext 설정
                    setSecurityContext(session);

                    // 4. SessionContextHolder 설정 (Module에서 사용)
                    SessionContextHolder.setSession(session);

                    // 5. TTL 갱신 (Sliding Window)
                    sessionRepositoryPort.refreshTTL(sessionId);
                }
            }

            chain.doFilter(request, response);

        } finally {
            // 6. 요청 종료 시 정리
            SessionContextHolder.clear();
        }
    }

    private String extractSessionIdFromCookie(HttpServletRequest request) {
        if (request.getCookies() == null) return null;

        return Arrays.stream(request.getCookies())
            .filter(c -> "SESSIONID".equals(c.getName()))
            .map(Cookie::getValue)
            .findFirst()
            .orElse(null);
    }

    private void setSecurityContext(Session session) {
        UsernamePasswordAuthenticationToken auth =
            new UsernamePasswordAuthenticationToken(
                session.getUserId(),
                null,
                Collections.emptyList()
            );
        SecurityContextHolder.getContext().setAuthentication(auth);
    }
}
```

---

*작성일: 2026-02-03*
*작성자: Cloud Console Backend Team*
*버전: 1.1*
*변경 이력: TokenResolverPort 방식에서 SessionModule 방식으로 변경*