
// ═══════════════════════════════════════════════════════════════
// BLE CONFIG  (unchanged — protocol, UUIDs, and characteristics)
// ═══════════════════════════════════════════════════════════════
const SERVICE_UUID = '12345678-1234-1234-1234-1234567890ab';
const CHAR_CMD_UUID = 'abcd1234-5678-1234-5678-1234567890ab';
const CHAR_TELEMETRY_UUID = 'abcd1234-5678-1234-5678-1234567890ac';

let bleDevice = null;
let cmdCharacteristic = null;
let telemetryCharacteristic = null;
let sessionStartTime = null;

const DIR_META = {
  F: {label:'FORWARD', sub:'DRIVE FWD'},
  B: {label:'BACK',    sub:'REVERSE'},
  L: {label:'LEFT',    sub:'TURN CCW'},
  R: {label:'RIGHT',   sub:'TURN CW'},
  S: {label:'IDLE',    sub:'STANDBY'}
};

// Session stats
let sessionStats = {
  commands: 0,
  lastTimeout: 0
};

let gestureHands = null;
let gestureCamera = null;
let gestureOverlayCanvas = null;
let gestureOverlayCtx = null;
let lastGestureName = null;
let lastGestureSentAt = 0;
const GESTURE_SEND_DELAY = 900;

function initGesturePipeline() {
  if (gestureHands) return;
  gestureOverlayCanvas = document.getElementById('gesture-overlay');
  gestureOverlayCtx = gestureOverlayCanvas ? gestureOverlayCanvas.getContext('2d') : null;

  gestureHands = new Hands({
    locateFile: function(file) {
      return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + file;
    }
  });

  gestureHands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.6
  });

  gestureHands.onResults(onGestureResults);
}

function onGestureResults(results) {
  if (!gestureOverlayCtx) return;

  gestureOverlayCtx.save();
  gestureOverlayCtx.clearRect(0, 0, gestureOverlayCanvas.width, gestureOverlayCanvas.height);
  if (results.image) {
    gestureOverlayCtx.drawImage(results.image, 0, 0, gestureOverlayCanvas.width, gestureOverlayCanvas.height);
  }

  var detectionEl = document.getElementById('detection-status');
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    detectionEl.textContent = 'HAND DETECTED';
    drawGestureLandmarks(results.multiHandLandmarks[0]);
    var gesture = detectGesture(results.multiHandLandmarks[0]);
    if (gesture) {
      if (gesture.name !== lastGestureName || Date.now() - lastGestureSentAt > GESTURE_SEND_DELAY) {
        lastGestureName = gesture.name;
        lastGestureSentAt = Date.now();
        handleGestureDetected(gesture.name, gesture.confidence);
      } else {
        document.getElementById('current-gesture').textContent = gesture.name.replace('_', ' ');
        document.getElementById('gesture-confidence').textContent = Math.round(gesture.confidence * 100) + '%';
      }
    } else {
      lastGestureName = null;
      document.getElementById('current-gesture').textContent = 'NONE';
      document.getElementById('gesture-confidence').textContent = '--%';
    }
  } else {
    detectionEl.textContent = 'NO HAND';
    lastGestureName = null;
    document.getElementById('current-gesture').textContent = 'NONE';
    document.getElementById('gesture-confidence').textContent = '--%';
  }

  gestureOverlayCtx.restore();
}

function drawGestureLandmarks(landmarks) {
  if (!gestureOverlayCtx) return;
  gestureOverlayCtx.strokeStyle = 'rgba(255,255,255,0.75)';
  gestureOverlayCtx.lineWidth = 2;
  for (var i = 0; i < landmarks.length; i++) {
    var x = landmarks[i].x * gestureOverlayCanvas.width;
    var y = landmarks[i].y * gestureOverlayCanvas.height;
    gestureOverlayCtx.beginPath();
    gestureOverlayCtx.arc(x, y, 4, 0, Math.PI * 2);
    gestureOverlayCtx.fillStyle = 'rgba(139,107,255,0.85)';
    gestureOverlayCtx.fill();
  }
}

function detectGesture(landmarks) {
  function isExtended(tip, pip) {
    return tip.y < pip.y - 0.03;
  }
  var indexOpen = isExtended(landmarks[8], landmarks[6]);
  var middleOpen = isExtended(landmarks[12], landmarks[10]);
  var ringOpen = isExtended(landmarks[16], landmarks[14]);
  var pinkyOpen = isExtended(landmarks[20], landmarks[18]);

  if (indexOpen && middleOpen && ringOpen && pinkyOpen) {
    return {name: 'OPEN_PALM', confidence: 0.92};
  }

  if (!indexOpen && !middleOpen && !ringOpen && !pinkyOpen) {
    return {name: 'FIST', confidence: 0.92};
  }

  if (indexOpen && !middleOpen && !ringOpen && !pinkyOpen) {
    var wristX = landmarks[0].x;
    var indexX = landmarks[8].x;
    var indexY = landmarks[8].y;
    var pipY = landmarks[6].y;
    var dx = indexX - wristX;
    if (indexY > pipY + 0.04) {
      return {name: 'POINT_DOWN', confidence: 0.88};
    }
    if (dx < -0.05) {
      return {name: 'THUMBS_LEFT', confidence: 0.88};
    }
    if (dx > 0.05) {
      return {name: 'THUMBS_RIGHT', confidence: 0.88};
    }
  }

  return null;
}

async function toggleConnect() {
  if (bleDevice && bleDevice.gatt.connected) {
    bleDevice.gatt.disconnect();
    bleDevice = null; 
    cmdCharacteristic = null;
    telemetryCharacteristic = null;
    updateUI(false);
  } else {
    try {
      bleDevice = await navigator.bluetooth.requestDevice({
        filters: [{services: [SERVICE_UUID]}]
      });
      const server = await bleDevice.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      
      cmdCharacteristic = await service.getCharacteristic(CHAR_CMD_UUID);
      telemetryCharacteristic = await service.getCharacteristic(CHAR_TELEMETRY_UUID);
      
      // Subscribe to telemetry notifications
      await telemetryCharacteristic.startNotifications();
      telemetryCharacteristic.addEventListener('characteristicvaluechanged', handleTelemetry);
      
      updateUI(true);
      sessionStartTime = Date.now();
      updateSessionTime();
      
      bleDevice.addEventListener('gattserverdisconnected', function() {
        cmdCharacteristic = null;
        telemetryCharacteristic = null;
        updateUI(false);
      });
      
      addHistoryItem('BLE CONNECTED');
    } catch(e) {
      console.error('BLE error:', e);
      addHistoryItem('CONNECTION FAILED');
    }
  }
}

function updateUI(connected) {
  var btn = document.getElementById('connect-btn');
  var statLink = document.getElementById('stat-link');
  var dot = document.getElementById('link-dot');
  
  if (connected) {
    btn.textContent = 'LINK ACTIVE';
    btn.classList.add('connected');
    statLink.textContent = 'ONLINE';
    dot.classList.remove('off');
  } else {
    btn.textContent = 'ESTABLISH LINK';
    btn.classList.remove('connected');
    statLink.textContent = 'OFF';
    dot.classList.add('off');
    sessionStartTime = null;
  }
}

// Handle telemetry data from rover
function handleTelemetry(event) {
  var value = new TextDecoder().decode(event.target.value);
  var parts = value.split(',');
  
  if (parts.length >= 5) {
    var cmd = parts[0];
    var distStr = parts[1];
    var timeStr = parts[2];
    var countStr = parts[3];
    var timeoutStr = parts[4];
    
    // Update telemetry displays
    var dist = parseFloat(distStr);
    var moveTime = parseInt(timeStr);
    var count = parseInt(countStr);
    var timeout = parseInt(timeoutStr);
    
    document.getElementById('telem-dist').textContent = dist.toFixed(2) + ' cm';
    document.getElementById('telem-time').textContent = (moveTime / 1000).toFixed(1) + ' s';
    
    // Calculate average speed
    var avgSpeed = moveTime > 0 ? (dist / (moveTime / 1000)) : 0;
    document.getElementById('telem-speed').textContent = avgSpeed.toFixed(1) + ' cm/s';
    
    document.getElementById('stat-cmds').textContent = count;
    
    // Update timeout indicator
    var timeoutCell = document.getElementById('timeout-cell');
    var timeoutDisplay = document.getElementById('stat-timeout');
    var timeoutRemaining = 2000 - timeout;
    
    if (cmd !== 'S' && timeout < 2000) {
      timeoutDisplay.textContent = (timeoutRemaining / 1000).toFixed(1) + 's';
      
      if (timeout > 1500) {
        timeoutCell.classList.remove('ok');
        timeoutCell.classList.add('warn');
        document.getElementById('link-dot').classList.add('warn');
      } else {
        timeoutCell.classList.add('ok');
        timeoutCell.classList.remove('warn');
        document.getElementById('link-dot').classList.remove('warn');
      }
    } else {
      timeoutDisplay.textContent = '--';
      timeoutCell.classList.add('ok');
      timeoutCell.classList.remove('warn');
      document.getElementById('link-dot').classList.remove('warn');
    }
  }
}

function send(cmd) {
  if (!cmdCharacteristic) return;
  try {
    var encoder = new TextEncoder();
    cmdCharacteristic.writeValue(encoder.encode(cmd));
    updateDirection(cmd);
    sessionStats.commands++;
    addHistoryItem(DIR_META[cmd].label);
  } catch(e) {
    console.error('Send error:', e);
  }
}

function updateDirection(cmd) {
  var label = document.getElementById('dir-label');
  var sub = document.getElementById('dir-sub');
  var icon = document.getElementById('rover-icon');
  if (DIR_META[cmd]) {
    label.textContent = DIR_META[cmd].label;
    sub.textContent = DIR_META[cmd].sub;
  }
  if (cmd !== 'S') {
    icon.classList.add('moving');
    updateRoverPosition(cmd);
  } else {
    icon.classList.remove('moving');
  }
}

// Update session time
function updateSessionTime() {
  if (!sessionStartTime) return;
  
  var elapsed = Date.now() - sessionStartTime;
  var minutes = Math.floor(elapsed / 60000);
  var seconds = Math.floor((elapsed % 60000) / 1000);
  
  document.getElementById('telem-session').textContent = 
    String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
  
  setTimeout(updateSessionTime, 1000);
}

// Add item to command history
function addHistoryItem(cmdText) {
  var feed = document.getElementById('history-feed');
  var now = new Date();
  var timestamp = String(now.getHours()).padStart(2, '0') + ':' + 
                   String(now.getMinutes()).padStart(2, '0') + ':' + 
                   String(now.getSeconds()).padStart(2, '0');
  
  var item = document.createElement('div');
  item.className = 'history-item';
  item.innerHTML = '<span class="timestamp">' + timestamp + '</span><span class="cmd">' + cmdText + '</span>';
  
  feed.appendChild(item);
  feed.scrollTop = feed.scrollHeight;
  
  // Keep only last 20 items
  while (feed.children.length > 20) {
    feed.removeChild(feed.firstChild);
  }
}

// ===== D-PAD =====
var currentPad = null;

function padDown(cmd) {
  currentPad = cmd;
  send(cmd);
}
function padUp() {
  if (currentPad) { send('S'); currentPad = null; }
}

function touchStart(e, cmd) {
  e.preventDefault();
  padDown(cmd);
}
function touchEnd(e) {
  e.preventDefault();
  padUp();
}

function emergencyStop() {
  currentPad = null;
  currentKey = null;
  send('S');
}

// ===== KEYBOARD =====
var currentKey = null;
document.addEventListener('keydown', function(e) {
  if (currentKey === e.key) return;
  currentKey = e.key;
  if      (e.key==='w'||e.key==='ArrowUp')    send('F');
  else if (e.key==='s'||e.key==='ArrowDown')  send('B');
  else if (e.key==='a'||e.key==='ArrowLeft')  send('L');
  else if (e.key==='d'||e.key==='ArrowRight') send('R');
});
document.addEventListener('keyup', function(e) {
  if (e.key === currentKey) { currentKey = null; send('S'); }
});
window.addEventListener('blur', function() { currentKey = null; send('S'); });

// ===== VOICE =====
var recognition = null;
var isVoiceActive = false;

function startVoice() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    document.getElementById('v-text').textContent = 'NOT SUPPORTED';
    return;
  }
  
  if (isVoiceActive) return;
  
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = false;

  var btn = document.getElementById('voice-btn');
  var stopBtn = document.getElementById('stop-voice-btn');
  
  btn.style.display = 'none';
  stopBtn.style.display = 'flex';
  stopBtn.classList.add('listening');
  
  isVoiceActive = true;
  document.getElementById('v-text').textContent = 'LISTENING...';
  document.getElementById('v-cmd').textContent = 'CONTINUOUS MODE ACTIVE';

  recognition.onresult = function(e) {
    var last = e.results.length - 1;
    var text = e.results[last][0].transcript.toLowerCase();
    document.getElementById('v-text').textContent = text.toUpperCase();
    
    var cmd = null;
    if      (text.indexOf('forward') !== -1) { cmd='F'; }
    else if (text.indexOf('back') !== -1)    { cmd='B'; }
    else if (text.indexOf('left') !== -1)    { cmd='L'; }
    else if (text.indexOf('right') !== -1)   { cmd='R'; }
    else if (text.indexOf('stop') !== -1)    { cmd='S'; }
    
    if (cmd) {
      document.getElementById('v-cmd').textContent = '→ CMD: ' + DIR_META[cmd].label;
      send(cmd);
      if (cmd !== 'S') {
        setTimeout(function(){ send('S'); }, 800);
      }
    } else {
      document.getElementById('v-cmd').textContent = '✗ UNRECOGNIZED';
    }
  };

  recognition.onerror = function(e) {
    console.error('Speech recognition error:', e.error);
    if (e.error === 'no-speech') return;
    document.getElementById('v-text').textContent = 'ERROR: ' + e.error;
  };

  recognition.onend = function() {
    if (isVoiceActive) {
      try { recognition.start(); } catch(e) {}
    }
  };

  recognition.start();
}

function stopVoice() {
  if (recognition) {
    isVoiceActive = false;
    recognition.stop();
    recognition = null;
  }
  
  var btn = document.getElementById('voice-btn');
  var stopBtn = document.getElementById('stop-voice-btn');
  
  btn.style.display = 'flex';
  stopBtn.style.display = 'none';
  stopBtn.classList.remove('listening');
  
  document.getElementById('v-text').textContent = 'READY';
  document.getElementById('v-cmd').textContent = 'SAY: FORWARD / BACK / LEFT / RIGHT / STOP';
}

// ===== CANVAS =====
var canvas = document.getElementById('map');
var ctx = canvas.getContext('2d');
var CANVAS_SIZE = 500;
var SCALE = 50 / CANVAS_SIZE;
var SPEED = 41.9;

var ROVER_WIDTH = 13;
var ROVER_LENGTH = 8;

var START_POS = {
  x: CANVAS_SIZE / 2,
  y: CANVAS_SIZE / 2
};

var roverPos = {
  x: START_POS.x,
  y: START_POS.y,
  angle: 0
};

var drawMode = 'line';
var path = [];
var movementTrail = [];
var running = false;
var isDrawing = false;

function updateRoverPosition(cmd) {
  var MOVE_DELTA = 5;
  
  switch(cmd) {
    case 'F': roverPos.y -= MOVE_DELTA; break;
    case 'B': roverPos.y += MOVE_DELTA; break;
    case 'L': roverPos.x -= MOVE_DELTA; break;
    case 'R': roverPos.x += MOVE_DELTA; break;
  }
  
  roverPos.x = Math.max(0, Math.min(CANVAS_SIZE, roverPos.x));
  roverPos.y = Math.max(0, Math.min(CANVAS_SIZE, roverPos.y));
  
  // Add to movement trail
  movementTrail.push({x: roverPos.x, y: roverPos.y});
  if (movementTrail.length > 100) movementTrail.shift();
  
  updateRoverPositionDisplay();
  redrawPath();
}

function updateRoverPositionDisplay() {
  var xCm = (roverPos.x * SCALE).toFixed(2);
  var yCm = (roverPos.y * SCALE).toFixed(2);
  document.getElementById('rover-x').textContent = xCm + ' cm';
  document.getElementById('rover-y').textContent = yCm + ' cm';
}

function drawGrid() {
  ctx.clearRect(0,0,CANVAS_SIZE,CANVAS_SIZE);
  ctx.strokeStyle = 'rgba(0,212,255,0.07)';
  ctx.lineWidth = 0.5;
  var step = CANVAS_SIZE / 10;
  for (var i=0;i<=10;i++) {
    ctx.beginPath(); ctx.moveTo(i*step,0); ctx.lineTo(i*step,CANVAS_SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,i*step); ctx.lineTo(CANVAS_SIZE,i*step); ctx.stroke();
  }
  
  // Start position
  ctx.fillStyle = '#00ff88';
  ctx.shadowColor = '#00ff88';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(START_POS.x, START_POS.y, 6, 0, Math.PI*2);
  ctx.fill();
  ctx.shadowBlur = 0;
  
  ctx.fillStyle = '#00ff88';
  ctx.font = '10px Orbitron,monospace';
  ctx.fillText('START', START_POS.x - 18, START_POS.y - 10);
  
  // Draw movement trail
  if (movementTrail.length > 1) {
    ctx.strokeStyle = 'rgba(0,255,136,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(movementTrail[0].x, movementTrail[0].y);
    for (var j = 1; j < movementTrail.length; j++) {
      ctx.lineTo(movementTrail[j].x, movementTrail[j].y);
    }
    ctx.stroke();
  }
  
  drawRover();
  
  ctx.fillStyle = 'rgba(0,212,255,0.3)';
  ctx.font = '10px Orbitron,monospace';
  for (var k=0;k<=10;k++) {
    ctx.fillText(k*5, k*step+2, CANVAS_SIZE-3);
  }
}

function drawRover() {
  ctx.save();
  
  var roverWidthPx = ROVER_WIDTH / SCALE;
  var roverLengthPx = ROVER_LENGTH / SCALE;
  
  ctx.translate(roverPos.x, roverPos.y);
  ctx.rotate(roverPos.angle * Math.PI / 180);
  
  ctx.fillStyle = 'rgba(0,212,255,0.3)';
  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#00d4ff';
  ctx.shadowBlur = 10;
  
  ctx.fillRect(-roverWidthPx/2, -roverLengthPx/2, roverWidthPx, roverLengthPx);
  ctx.strokeRect(-roverWidthPx/2, -roverLengthPx/2, roverWidthPx, roverLengthPx);
  
  ctx.fillStyle = '#00ffea';
  ctx.beginPath();
  ctx.moveTo(0, -roverLengthPx/2 - 5);
  ctx.lineTo(-5, -roverLengthPx/2);
  ctx.lineTo(5, -roverLengthPx/2);
  ctx.closePath();
  ctx.fill();
  
  ctx.shadowBlur = 0;
  ctx.restore();
}

function redrawPath() {
  drawGrid();
  if (path.length < 1) return;
  ctx.strokeStyle = '#00d4ff';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#00d4ff';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (var i=1;i<path.length;i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.stroke();
  ctx.shadowBlur = 0;
  
  ctx.fillStyle = '#00d4ff';
  ctx.beginPath(); ctx.arc(path[0].x,path[0].y,5,0,Math.PI*2); ctx.fill();
  
  if (path.length > 1) {
    ctx.fillStyle = '#ffb300';
    ctx.beginPath(); ctx.arc(path[path.length-1].x,path[path.length-1].y,5,0,Math.PI*2); ctx.fill();
  }
}

drawGrid();
updateRoverPositionDisplay();

function getPos(e) {
  var rect = canvas.getBoundingClientRect();
  var scaleX = CANVAS_SIZE / rect.width;
  var scaleY = CANVAS_SIZE / rect.height;
  var src = e.touches ? e.touches[0] : e;
  return {
    x: (src.clientX - rect.left) * scaleX,
    y: (src.clientY - rect.top)  * scaleY
  };
}

canvas.addEventListener('mousedown', onDown);
canvas.addEventListener('touchstart', onDown, {passive:false});
canvas.addEventListener('mouseup',   onUp);
canvas.addEventListener('touchend',  onUp, {passive:false});
canvas.addEventListener('mousemove', onMove);
canvas.addEventListener('touchmove', onMove, {passive:false});

function onDown(e) {
  e.preventDefault();
  isDrawing = true;
  var p = getPos(e);
  if (drawMode === 'line') path = [p];
  else { path = [p]; }
  redrawPath();
}
function onUp(e) {
  e.preventDefault();
  if (!isDrawing) return;
  isDrawing = false;
  var p = getPos(e);
  if (drawMode === 'line' && path.length === 1) path.push(p);
  redrawPath();
  calculateMetrics();
}
function onMove(e) {
  e.preventDefault();
  if (!isDrawing) return;
  var p = getPos(e);
  if (drawMode === 'line') {
    path = [path[0], p];
    redrawPath();
  } else {
    path.push(p);
    redrawPath();
  }
}

function setMode(m) {
  drawMode = m;
  document.getElementById('btn-line').classList.toggle('active',  m==='line');
  document.getElementById('btn-curve').classList.toggle('active', m==='curve');
  document.getElementById('stat-mode').textContent = m==='line' ? 'PATH/LINE' : 'PATH/FREE';
}

function clearPath() {
  path = [];
  movementTrail = [];
  roverPos.x = START_POS.x;
  roverPos.y = START_POS.y;
  roverPos.angle = 0;
  updateRoverPositionDisplay();
  drawGrid();
  updateMetrics(0, 0);
}

function calculateMetrics() {
  var len = 0;
  for (var i=1;i<path.length;i++) {
    var dx=path[i].x-path[i-1].x, dy=path[i].y-path[i-1].y;
    len += Math.sqrt(dx*dx+dy*dy);
  }
  updateMetrics(len*SCALE, (len*SCALE)/SPEED);
}
function updateMetrics(cm, sec) {
  document.getElementById('m-length').textContent = cm.toFixed(2)+' cm';
  document.getElementById('m-time').textContent   = sec.toFixed(2)+' s';
}

async function startPath() {
  if (path.length < 2) return;
  running = true;
  document.getElementById('stat-mode').textContent = 'EXECUTING';

  for (var i=1;i<path.length;i++) {
    if (!running) break;
    var dx=path[i].x-path[i-1].x, dy=path[i].y-path[i-1].y;
    var distCm = Math.sqrt(dx*dx+dy*dy)*SCALE;
    var duration = (distCm/SPEED)*1000;
    var cmd;
    if (Math.abs(dx)>Math.abs(dy)) cmd = dx>0?'R':'L';
    else cmd = dy>0?'B':'F';
    send(cmd);
    await new Promise(function(r){setTimeout(r,duration);});
  }

  send('S');
  running = false;
  document.getElementById('stat-mode').textContent = 'MANUAL';
}

function stopPath() {
  running = false;
  send('S');
  document.getElementById('stat-mode').textContent = 'MANUAL';
}

// ═══════════════════════════════════════════════════════════════
// TOPBAR LIVE CLOCK
// ═══════════════════════════════════════════════════════════════
function updateTopbarClock() {
  var el = document.getElementById('topbar-clock');
  if (!el) return;
  var now = new Date();
  el.textContent = String(now.getHours()).padStart(2,'0') + ':' +
                    String(now.getMinutes()).padStart(2,'0') + ':' +
                    String(now.getSeconds()).padStart(2,'0');
}
setInterval(updateTopbarClock, 1000);
updateTopbarClock();

// ═══════════════════════════════════════════════════════════════
// CONTROL MODE SWITCHER
// ═══════════════════════════════════════════════════════════════
var activeControlMode = 'manual';
var MODE_BUTTON_IDS = {
  manual: 'mode-btn-manual',
  keyboard: 'mode-btn-keyboard',
  voice: 'mode-btn-voice',
  gesture: 'mode-btn-gesture'
};

function setControlMode(mode) {
  activeControlMode = mode;

  Object.keys(MODE_BUTTON_IDS).forEach(function(key) {
    var btn = document.getElementById(MODE_BUTTON_IDS[key]);
    if (btn) btn.classList.toggle('active', key === mode);
  });

  var label = document.getElementById('active-mode-label');
  if (label) label.textContent = mode.toUpperCase();

  var panels = document.querySelectorAll('[data-mode-panel]');
  for (var i = 0; i < panels.length; i++) {
    panels[i].classList.toggle('mode-focused', panels[i].getAttribute('data-mode-panel') === mode);
  }

  addHistoryItem('MODE → ' + mode.toUpperCase());
}

// ═══════════════════════════════════════════════════════════════
// KEYBOARD CONTROL VISUALIZATION
// ═══════════════════════════════════════════════════════════════
var KB_KEY_MAP = {
  'w':'kb-key-w', 'a':'kb-key-a', 's':'kb-key-s', 'd':'kb-key-d',
  'arrowup':'kb-key-up', 'arrowdown':'kb-key-down',
  'arrowleft':'kb-key-left', 'arrowright':'kb-key-right'
};

document.addEventListener('keydown', function(e) {
  var keyId = KB_KEY_MAP[e.key.toLowerCase()];
  if (!keyId) return;
  var el = document.getElementById(keyId);
  if (el) el.classList.add('kb-key-active');
  var curEl = document.getElementById('kb-current-key');
  if (curEl) curEl.textContent = e.key.replace('Arrow','').toUpperCase();
});

document.addEventListener('keyup', function(e) {
  var keyId = KB_KEY_MAP[e.key.toLowerCase()];
  if (!keyId) return;
  var el = document.getElementById(keyId);
  if (el) el.classList.remove('kb-key-active');
  var lastEl = document.getElementById('kb-last-key');
  if (lastEl) lastEl.textContent = e.key.replace('Arrow','').toUpperCase();
  var curEl = document.getElementById('kb-current-key');
  if (curEl) curEl.textContent = '--';
});

// ═══════════════════════════════════════════════════════════════
// AI GESTURE CONTROL - FULLY FIXED
// ═══════════════════════════════════════════════════════════════
var gestureStream = null;
var gestureFrameCount = 0;
var gestureFpsInterval = null;

var GESTURE_COMMAND_MAP = {
  'OPEN_PALM': 'F',
  'FIST': 'S',
  'THUMBS_LEFT': 'L',
  'THUMBS_RIGHT': 'R',
  'POINT_DOWN': 'B'
};

function startGestureCamera() {
  var video = document.getElementById('gesture-video');
  var wrapper = document.getElementById('gesture-video-wrapper');
  var statusEl = document.getElementById('gesture-status');
  var mediapipeEl = document.getElementById('mediapipe-status');
  var detectionEl = document.getElementById('detection-status');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    statusEl.textContent = 'CAMERA UNSUPPORTED';
    return;
  }

  initGesturePipeline();
  if (!gestureHands) {
    statusEl.textContent = 'MEDIA PIPE MISSING';
    return;
  }

  wrapper.classList.remove('inactive');
  statusEl.textContent = 'CAMERA ACTIVE';
  mediapipeEl.textContent = 'LOADING';
  detectionEl.textContent = 'SCANNING';

  document.getElementById('gesture-start-btn').style.display = 'none';
  document.getElementById('gesture-stop-btn').style.display = 'flex';
  document.getElementById('ai-status-dot').classList.remove('off');

  gestureCamera = new Camera(video, {
    onFrame: async function() {
      await gestureHands.send({image: video});
      gestureFrameCount++;
    },
    width: 640,
    height: 480
  });

  gestureCamera.start().then(function() {
    document.getElementById('gesture-resolution').textContent = video.videoWidth + '×' + video.videoHeight;
    mediapipeEl.textContent = 'MODEL LOADED';
    gestureFrameCount = 0;
    if (gestureFpsInterval) clearInterval(gestureFpsInterval);
    gestureFpsInterval = setInterval(function() {
      var fpsEl = document.getElementById('gesture-fps');
      if (fpsEl) fpsEl.textContent = gestureFrameCount + ' FPS';
      gestureFrameCount = 0;
    }, 1000);
    addHistoryItem('CAMERA READY');
  }).catch(function(e) {
    console.error('Camera error:', e);
    statusEl.textContent = 'CAMERA DENIED';
    mediapipeEl.textContent = 'NOT LOADED';
    addHistoryItem('CAMERA ACCESS DENIED');
  });
}

function stopGestureCamera() {
  if (gestureCamera) {
    try {
      gestureCamera.stop();
    } catch (e) {
      console.warn('Error stopping camera:', e);
    }
    gestureCamera = null;
  }

  if (gestureStream) {
    gestureStream.getTracks().forEach(function(t) { t.stop(); });
    gestureStream = null;
  }

  if (gestureFpsInterval) {
    clearInterval(gestureFpsInterval);
    gestureFpsInterval = null;
  }

  var video = document.getElementById('gesture-video');
  if (video) video.srcObject = null;

  document.getElementById('gesture-video-wrapper').classList.add('inactive');
  document.getElementById('gesture-status').textContent = 'CAMERA OFFLINE';
  document.getElementById('gesture-start-btn').style.display = 'flex';
  document.getElementById('gesture-stop-btn').style.display = 'none';
  document.getElementById('gesture-fps').textContent = '0 FPS';
  document.getElementById('gesture-confidence').textContent = '--%';
  document.getElementById('current-gesture').textContent = 'NONE';
  document.getElementById('mediapipe-status').textContent = 'NOT LOADED';
  document.getElementById('detection-status').textContent = 'IDLE';
  document.getElementById('ai-status-dot').classList.add('off');

  if (gestureOverlayCtx) {
    gestureOverlayCtx.clearRect(0, 0, gestureOverlayCanvas.width, gestureOverlayCanvas.height);
  }

  addHistoryItem('CAMERA STOPPED');
}

function flipGestureCamera() {
  var video = document.getElementById('gesture-video');
  if (video) video.classList.toggle('mirrored');
}

function fullscreenGestureCamera() {
  var wrapper = document.getElementById('gesture-video-wrapper');
  if (wrapper && wrapper.requestFullscreen) wrapper.requestFullscreen();
}

// Called whenever a gesture is recognized
function handleGestureDetected(gestureName, confidence) {
  document.getElementById('current-gesture').textContent = gestureName.replace('_', ' ');
  document.getElementById('gesture-confidence').textContent = Math.round(confidence * 100) + '%';
  addGestureHistoryItem(gestureName);

  var cmd = GESTURE_COMMAND_MAP[gestureName];
  if (cmd && activeControlMode === 'gesture') {
    send(cmd);
    if (cmd !== 'S') {
      setTimeout(function() { send('S'); }, 800);
    }
  }
}

function addGestureHistoryItem(name) {
  var feed = document.getElementById('gesture-history-feed');
  if (!feed) return;
  var now = new Date();
  var ts = String(now.getHours()).padStart(2,'0') + ':' +
             String(now.getMinutes()).padStart(2,'0') + ':' +
             String(now.getSeconds()).padStart(2,'0');
  var item = document.createElement('div');
  item.className = 'history-item';
  item.innerHTML = '<span class="timestamp">' + ts + '</span><span class="cmd">' + name.replace('_',' ') + '</span>';
  feed.appendChild(item);
  feed.scrollTop = feed.scrollHeight;
  while (feed.children.length > 15) {
    feed.removeChild(feed.firstChild);
  }
}

// Dev test triggers — simulate a detected gesture
function testGesture(name) {
  handleGestureDetected(name, 0.9 + Math.random() * 0.1);
}
