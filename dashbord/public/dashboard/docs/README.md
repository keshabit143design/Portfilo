# Mission Control — Smart Survey Robot Dashboard

A production-quality, futuristic mission-control web dashboard for an **ESP32-based smart survey robot**.
Built with pure **HTML5, CSS3 and Vanilla JavaScript** — no frameworks, no build step.

## Robot Hardware

- ESP32 SuperMini
- L9110S Motor Driver
- 4 × DC Motors
- 3 × Batteries

## Communication (upcoming)

- **WiFi** — WebSocket
- **Bluetooth** — Web Bluetooth API

## Folder Structure

```
dashboard/
├── index.html
├── css/
│   ├── style.css          # Core design system (Part 2)
│   ├── responsive.css     # Breakpoints & mobile layout (Part 2)
│   └── themes.css         # Theme tokens / dark theme (Part 2)
├── js/
│   ├── app.js             # App bootstrap
│   ├── router.js          # Page routing
│   ├── utils.js           # Shared helpers
│   ├── config.js          # Global configuration
│   └── modules/
│       ├── connection.js
│       ├── manual-control.js
│       ├── keyboard-control.js
│       ├── gesture-control.js
│       ├── voice-control.js
│       ├── draw-line.js
│       ├── free-draw.js
│       ├── auto-mode.js
│       ├── telemetry.js
│       ├── robot-map.js
│       ├── notifications.js
│       ├── history.js
│       └── settings.js
├── assets/
│   ├── images/
│   ├── icons/
│   ├── fonts/
│   ├── videos/
│   └── audio/
└── docs/
    └── README.md
```

## Deployment Pipeline

GitHub Repository → Cloudflare Pages → Custom Domain → Accessible worldwide.

## Status

- ✅ Part 1 — Project foundation & semantic HTML shell
- ⏳ Part 2 — CSS architecture
- ⏳ Later — JavaScript modules, ESP32 connectivity, telemetry, path planning
