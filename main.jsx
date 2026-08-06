import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/space-grotesk/latin-500.css";
import "@fontsource/space-grotesk/latin-600.css";
import "@fontsource/space-grotesk/latin-700.css";
import "@fontsource/jetbrains-mono/latin-400.css";
import "@fontsource/jetbrains-mono/latin-500.css";
import "./labtrack-stable-ui.css";
import "./labtrack-original-font.css";
import "./labtrack-ios-glass-ui.css";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);




const LABTRACK_CACHE_VERSION = "labtrack-ios-glass-20260802-v2";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const previousVersion = localStorage.getItem("labtrack-cache-version");

      if (previousVersion !== LABTRACK_CACHE_VERSION && "caches" in window) {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((key) => key.startsWith("labtrack-shell-"))
            .map((key) => caches.delete(key))
        );
        localStorage.setItem("labtrack-cache-version", LABTRACK_CACHE_VERSION);
      }

      const registration = await navigator.serviceWorker.register(
        `/sw.js?v=${LABTRACK_CACHE_VERSION}`,
        { updateViaCache: "none" }
      );

      await registration.update();
    } catch (error) {
      console.warn("LabTrack service-worker refresh failed:", error);
    }
  });
}

// LABTRACK_IOS_GLASS_MOTION_START
function initializeLabTrackGlassMotion() {
  if (window.__labTrackGlassMotionReady) return;
  window.__labTrackGlassMotionReady = true;

  let motionTimer = 0;

  document.addEventListener(
    "click",
    (event) => {
      const trigger = event.target.closest(".lt-sidebar-tab, .lt-subtab");
      if (!trigger || trigger.classList.contains("active")) return;

      const main = document.querySelector(".lt-main");
      if (!main) return;

      window.clearTimeout(motionTimer);
      main.classList.remove("lt-section-entering");
      void main.offsetWidth;
      main.classList.add("lt-section-entering");

      motionTimer = window.setTimeout(() => {
        main.classList.remove("lt-section-entering");
      }, 620);
    },
    true
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeLabTrackGlassMotion, { once: true });
} else {
  initializeLabTrackGlassMotion();
}
// LABTRACK_IOS_GLASS_MOTION_END



// LABTRACK_SW_V150
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js?v=150", { updateViaCache: "none" });
      await registration.update();
    } catch (error) { console.warn("LabTrack offline shell registration failed:", error); }
  });
}
