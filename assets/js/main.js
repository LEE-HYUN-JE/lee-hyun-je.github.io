// Mobile Menu Toggle
document.addEventListener('DOMContentLoaded', function() {
  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const navLinks = document.querySelector('.nav-links');

  if (mobileMenuBtn && navLinks) {
    mobileMenuBtn.addEventListener('click', function() {
      navLinks.classList.toggle('active');
      this.classList.toggle('active');
    });
  }

  // Tag Filter
  const tagButtons = document.querySelectorAll('.tag-btn');
  const postCards = document.querySelectorAll('.post-card');

  tagButtons.forEach(button => {
    button.addEventListener('click', function() {
      const tag = this.dataset.tag;

      // Update active button
      tagButtons.forEach(btn => btn.classList.remove('active'));
      this.classList.add('active');

      // Filter posts
      postCards.forEach(card => {
        if (tag === 'all') {
          card.classList.remove('hidden');
        } else {
          const cardTags = card.dataset.tags ? card.dataset.tags.split(',') : [];
          if (cardTags.includes(tag)) {
            card.classList.remove('hidden');
          } else {
            card.classList.add('hidden');
          }
        }
      });
    });
  });

  // Search Functionality
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');

  if (searchInput && searchResults) {
    let searchIndex = [];

    // Fetch search data
    fetch('/search.json')
      .then(response => response.json())
      .then(data => {
        searchIndex = data;
      })
      .catch(error => {
        console.log('Search index not found');
      });

    searchInput.addEventListener('input', function() {
      const query = this.value.toLowerCase().trim();

      if (query.length < 2) {
        searchResults.classList.remove('active');
        searchResults.innerHTML = '';
        return;
      }

      const results = searchIndex.filter(item => {
        return item.title.toLowerCase().includes(query) ||
               item.content.toLowerCase().includes(query) ||
               (item.tags && item.tags.some(tag => tag.toLowerCase().includes(query)));
      }).slice(0, 5);

      if (results.length > 0) {
        searchResults.innerHTML = results.map(item => `
          <a href="${item.url}" class="search-item">
            <div class="title">${item.title}</div>
            <div class="excerpt">${item.excerpt}</div>
          </a>
        `).join('');
        searchResults.classList.add('active');
      } else {
        searchResults.innerHTML = '<div class="search-item"><div class="title">검색 결과가 없습니다</div></div>';
        searchResults.classList.add('active');
      }
    });

    // Close search results when clicking outside
    document.addEventListener('click', function(e) {
      if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
        searchResults.classList.remove('active');
      }
    });

    // Close search results on escape
    searchInput.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        searchResults.classList.remove('active');
        this.blur();
      }
    });
  }
});

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth'
      });
    }
  });
});
