(() => {
  const words = [
    "기술을 도구로 활용하는",
    "협업과 성장을 사랑하는",
    "도메인을 구분 짓지 않는"
  ];

  const el = document.getElementById("rotatingWord");
  if (!el) return;

  let wordIdx = 0;
  let charIdx = 0;
  let isDeleting = false;

  const typingSpeed = 65;
  const deletingSpeed = 35;
  const pauseAfterTyping = 1200;
  const pauseAfterDeleting = 300;

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