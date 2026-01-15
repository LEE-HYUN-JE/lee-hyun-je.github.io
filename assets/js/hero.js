(() => {
  const words = [
    "기술을 도구로 활용하는",
    "협업을 사랑하는",
    "문제를 끝까지 해결하는",
    "도메인을 빠르게 학습하는"
  ];

  const el = document.getElementById("rotatingWord");
  if (!el) return;

  let wordIdx = 0;
  let charIdx = 0;
  let isDeleting = false;

  const typingSpeed = 90;
  const deletingSpeed = 55;
  const pauseAfterTyping = 1600;
  const pauseAfterDeleting = 400;

  function tick() {
    const current = words[wordIdx];

    if (!isDeleting) {
      charIdx++;
      el.textContent = current.slice(0, charIdx);

      if (charIdx === current.length) {
        setTimeout(() => {
          isDeleting = true;
          tick();
        }, pauseAfterTyping);
        return;
      }
      setTimeout(tick, typingSpeed);
    } else {
      charIdx--;
      el.textContent = current.slice(0, charIdx);

      if (charIdx === 0) {
        isDeleting = false;
        wordIdx = (wordIdx + 1) % words.length;
        setTimeout(tick, pauseAfterDeleting);
        return;
      }
      setTimeout(tick, deletingSpeed);
    }
  }

  tick();
})();