/* LabTrack Website UI Enhancer
   Adds scroll reveal, fade-out/re-entry, toggle pulse and button ripple.
   No Appwrite queries or application data are changed. */

const LABTRACK_MOTION_SELECTOR = [
  ".lt-header",
  ".lt-stat-card",
  ".lt-card",
  ".lt-add-card",
  ".lt-request-card",
  ".lt-culture-card",
  ".lt-culture-summary",
  ".lt-table-wrap",
  ".lt-chat-wrap",
  ".lt-conv-list",
  ".lt-conv-layout",
  ".lt-maintenance-form",
  ".lt-material-details-hero",
  ".lt-material-detail-row",
  ".lt-note",
  ".lt-pagination",
  ".lt-section-title",
  ".lt-filter-row"
].join(", ");

const LABTRACK_INTERACTIVE_SELECTOR = [
  ".lt-btn",
  ".lt-sidebar-tab",
  ".lt-subtab",
  ".lt-auth-switch button",
  ".lt-add-card",
  ".lt-card-clickable"
].join(", ");

const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

function startLabTrackUiEnhancer() {
  if (window.__labTrackUiEnhancerStarted) return;
  window.__labTrackUiEnhancerStarted = true;

  const observed = new WeakSet();
  let revealObserver = null;

  const setPositionClass = (element, visible) => {
    const rect = element.getBoundingClientRect();
    const isVisible = visible ?? (
      rect.bottom > 0 &&
      rect.top < window.innerHeight
    );

    element.classList.toggle("lt-in-view", isVisible);
    element.classList.toggle("lt-out-above", !isVisible && rect.bottom <= 0);
    element.classList.toggle("lt-out-below", !isVisible && rect.top >= window.innerHeight);
  };

  if (!reducedMotion?.matches && "IntersectionObserver" in window) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setPositionClass(entry.target, entry.isIntersecting);
        }
      },
      {
        threshold: [0, 0.08, 0.22, 0.55],
        rootMargin: "-3% 0px -7% 0px"
      }
    );
  }

  const registerElement = (element, index = 0) => {
    if (!(element instanceof HTMLElement) || observed.has(element)) return;

    observed.add(element);
    element.classList.add("lt-motion-item");
    element.style.setProperty(
      "--lt-motion-delay",
      `${Math.min(index % 8, 7) * 34}ms`
    );

    setPositionClass(element);

    if (revealObserver) {
      revealObserver.observe(element);
    } else {
      element.classList.add("lt-in-view");
    }
  };

  const registerTree = (root = document) => {
    const elements = [];

    if (root instanceof Element && root.matches(LABTRACK_MOTION_SELECTOR)) {
      elements.push(root);
    }

    root.querySelectorAll?.(LABTRACK_MOTION_SELECTOR).forEach((element) => {
      elements.push(element);
    });

    elements.forEach(registerElement);
  };

  registerTree(document);

  // Activate transitions only after visible elements have been measured.
  requestAnimationFrame(() => {
    document.documentElement.classList.add("lt-motion-enabled");
  });

  const mutationObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          registerTree(node);
        }
      }
    }
  });

  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true
  });

  let scrollFrame = 0;
  const updateScrollState = () => {
    scrollFrame = 0;

    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const scrollRange = Math.max(
      1,
      document.documentElement.scrollHeight - window.innerHeight
    );
    const progress = Math.min(1, Math.max(0, scrollTop / scrollRange));

    document.documentElement.style.setProperty(
      "--lt-scroll-progress",
      progress.toFixed(4)
    );
    document.body.classList.toggle("lt-page-scrolled", scrollTop > 12);
  };

  window.addEventListener(
    "scroll",
    () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(updateScrollState);
    },
    { passive: true }
  );

  updateScrollState();

  document.addEventListener("click", (event) => {
    const target = event.target.closest?.(LABTRACK_INTERACTIVE_SELECTOR);
    if (!(target instanceof HTMLElement)) return;

    target.classList.remove("lt-toggle-pulse");
    void target.offsetWidth;
    target.classList.add("lt-toggle-pulse");

    window.setTimeout(() => {
      target.classList.remove("lt-toggle-pulse");
    }, 470);

    if (
      reducedMotion?.matches ||
      target.matches(".lt-sidebar-tab, .lt-subtab, .lt-auth-switch button")
    ) {
      return;
    }

    const rect = target.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "lt-ripple";

    const pointerX = "clientX" in event && event.clientX
      ? event.clientX - rect.left
      : rect.width / 2;

    const pointerY = "clientY" in event && event.clientY
      ? event.clientY - rect.top
      : rect.height / 2;

    ripple.style.left = `${pointerX}px`;
    ripple.style.top = `${pointerY}px`;

    target.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 680);
  });

  // Recalculate states after orientation changes and responsive layout shifts.
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      document.querySelectorAll(".lt-motion-item").forEach((element) => {
        setPositionClass(element);
      });
    }, 120);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startLabTrackUiEnhancer, {
    once: true
  });
} else {
  startLabTrackUiEnhancer();
}
