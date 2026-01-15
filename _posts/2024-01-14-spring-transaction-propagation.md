---
layout: post
title: "Spring Transaction Propagation 이해하기"
date: 2024-01-14
tags: [Backend]
---

Spring에서 `@Transactional` 어노테이션을 사용할 때, 트랜잭션 전파(Propagation) 속성을 제대로 이해하지 못하면 예상치 못한 버그가 발생할 수 있습니다.
<!--more-->

## 문제 상황

주문 처리 로직에서 재고 차감과 주문 생성을 별도의 트랜잭션으로 관리해야 하는 상황이 있었습니다.

```java
@Service
public class OrderService {

    @Transactional
    public void createOrder(OrderRequest request) {
        // 재고 차감
        inventoryService.decreaseStock(request.getProductId(), request.getQuantity());

        // 주문 생성
        orderRepository.save(new Order(request));

        // 외부 API 호출 (실패 가능성 있음)
        externalApiClient.notifyOrder(request);
    }
}
```

외부 API 호출이 실패하면 전체 트랜잭션이 롤백되어 재고도 원복되는 문제가 있었습니다.

## 해결 방법

`REQUIRES_NEW` 전파 속성을 활용하여 재고 차감을 독립적인 트랜잭션으로 분리했습니다.

```java
@Service
public class InventoryService {

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void decreaseStock(Long productId, int quantity) {
        // 독립적인 트랜잭션으로 실행
        Inventory inventory = inventoryRepository.findByProductId(productId);
        inventory.decrease(quantity);
    }
}
```

## 주요 Propagation 속성

| 속성 | 설명 |
|------|------|
| REQUIRED | 기존 트랜잭션 사용, 없으면 새로 생성 (기본값) |
| REQUIRES_NEW | 항상 새로운 트랜잭션 생성 |
| NESTED | 중첩 트랜잭션 생성 |
| SUPPORTS | 트랜잭션이 있으면 사용, 없으면 없이 실행 |

## 주의사항

`REQUIRES_NEW`를 사용할 때는 **같은 클래스 내부 호출**에서는 프록시를 거치지 않아 적용되지 않습니다. 반드시 다른 Bean에서 호출해야 합니다.

```java
// 잘못된 예시 - 같은 클래스 내부 호출
@Service
public class OrderService {

    @Transactional
    public void createOrder() {
        this.decreaseStock(); // REQUIRES_NEW 적용 안됨!
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void decreaseStock() {
        // ...
    }
}
```

## 결론

트랜잭션 전파 속성은 비즈니스 요구사항에 맞게 신중하게 선택해야 합니다. 특히 외부 시스템과의 연동이 있는 경우, 트랜잭션 경계를 명확히 설계하는 것이 중요합니다.
