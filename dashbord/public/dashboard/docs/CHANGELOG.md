# Changelog

## v1.1.0 — Camera removal & Gesture Control redesign
- **Removed** the Camera Stream feature entirely (the robot has no onboard
  camera): card, sidebar item, module (`camera.js`), script tag, command
  types (`camera:start/stop/snapshot`), config flags and docs references.
- **Redesigned Gesture Control** to use the operator's laptop webcam:
  live mirrored preview via `getUserMedia()`, MediaPipe Hands landmark
  overlay, real-time classification of 7 gestures (Thumb Up, Open Palm,
  Closed Fist, Point Left/Right, Peace, One Finger) mapped to robot
  commands and dispatched through the existing `command:sent` pipeline.
- Added Start/Stop/Calibrate controls, sensitivity slider, camera status
  indicator and FPS counter; camera never auto-starts and the stream +
  MediaPipe worker are released when leaving the page.
- Shipped modules now render a focused single-card page instead of the
  "Phase Pending" placeholder; the card grid stays mounted so module
  state survives navigation.

## v1.0.0
- Part 1: Project foundation & semantic HTML shell
- Part 2: CSS architecture (variables.css, style.css)
