(() => {
  const PAGE_SIZE = 6; // 한 번에 보여줄 카드 수
  let activeTag = "ALL";
  let visibleCount = PAGE_SIZE;

  const tabs = Array.from(document.querySelectorAll(".tag-tab"));
  const cards = Array.from(document.querySelectorAll(".post-card"));
  const moreBtn = document.getElementById("moreBtn");

  function matchesTag(card, tag) {
    if (tag === "ALL") return true;
    const tags = (card.dataset.tags || "").split(",").map(s => s.trim());
    return tags.includes(tag);
  }

  function apply() {
    // 1) 태그로 필터된 카드만 추리기
    const filtered = cards.filter(c => matchesTag(c, activeTag));

    // 2) 우선 전부 숨기기
    cards.forEach(c => (c.style.display = "none"));

    // 3) visibleCount만큼 보여주기
    filtered.slice(0, visibleCount).forEach(c => (c.style.display = "block"));

    // 4) MORE 버튼 표시/숨김
    if (filtered.length > visibleCount) {
      moreBtn.style.display = "inline-block";
    } else {
      moreBtn.style.display = "none";
    }
  }

  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("is-active"));
      btn.classList.add("is-active");

      activeTag = btn.dataset.tag;
      visibleCount = PAGE_SIZE; // 태그 바꾸면 처음부터
      apply();
    });
  });

  moreBtn.addEventListener("click", () => {
    visibleCount += PAGE_SIZE;
    apply();
  });

  // 초기 적용
  apply();
})();