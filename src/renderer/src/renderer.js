import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import { HeadAudio } from '@met4citizen/headaudio/dist/headaudio.min.mjs';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GammaCorrectionShader } from 'three/examples/jsm/shaders/GammaCorrectionShader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

//#region THREEJS SHIT
// ==========================================
// --- DOM ELEMENTS & STATE ---
// ==========================================
const chatInput = document.getElementById('chatInput');
const API_BASE = "http://localhost:5042";

const WS_BASE_URL = "wss://devil-macbook-air-2.tail1737c0.ts.net";
let currentSessionId = null;
let currentlyPlayingChunkId = 0;
let isInterrupted = false;

// ==========================================
// --- SCENE & RENDERER SETUP ---
// ==========================================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
camera.position.set(0, 1.4, 1);
camera.lookAt(0, 1, 0);
const cameraRig = new THREE.Group();
cameraRig.position.set(0,0.6,1.4);
scene.add(cameraRig);
cameraRig.add(camera);
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: "high-performance"
});
renderer.xr.enabled = true;
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearAlpha(0);
renderer.setClearColor(0x000000, 0);
document.body.appendChild(renderer.domElement);

const keyLight = new THREE.DirectionalLight(0xffffff, 2);
keyLight.position.set(0, 4, 2); 
scene.add(keyLight);

const pinkRim = new THREE.DirectionalLight(0xff00ff, 1); 
pinkRim.position.set(3, 1, -2); 
scene.add(pinkRim);

const cyanRim = new THREE.DirectionalLight(0x00ffff, 1); 
cyanRim.position.set(-3, 1, -2); 
scene.add(cyanRim);

// Global state variables
let globalCurrYpos = 1.3;       // Starting Y position
const Y_INCREMENT = -0.5;       // Distance between text lines (adjust this to your liking)
let activeTextMeshes = [];      // Array to keep track of meshes for deletion

async function LoadTextShit(text) {
    const fontLoaderS = new FontLoader();
    const font = await fontLoaderS.loadAsync( '/helvetiker_regular.typeface.json' );
     
    const textGeometry = new TextGeometry(text, {
        font: font,
        size: 2,       
        depth: 0.5,    
        curveSegments: 12,
        bevelEnabled: true,
        bevelThickness: 0.1, 
        bevelSize: 0.05,
        bevelSegments: 2
    });

    textGeometry.center();

    const material = new THREE.MeshStandardMaterial({ 
        color: 0x00FF00,
        roughness: 0.2,
        metalness: 0.3
    });

    const textMesh = new THREE.Mesh(textGeometry, material);
    textMesh.scale.set(0.01, 0.01, 0.01); 
    
    // 1. Set the position using the global variable
    textMesh.position.set(0, globalCurrYpos, 0.3);
    
    // 2. Add to scene
    scene.add(textMesh);
    
    clear3DTextMeshes();
    // 3. Save the mesh to our array so we can delete it later
    activeTextMeshes.push(textMesh);

    
}
function clear3DTextMeshes() {
    // Loop through all currently active text meshes
    for (let i = 0; i < activeTextMeshes.length; i++) {
        const mesh = activeTextMeshes[i];
        
        // Remove from the visual scene
        scene.remove(mesh);
        
        // CRITICAL: Dispose of geometry and materials to prevent memory leaks
        if (mesh.geometry) mesh.geometry.dispose();
        
        if (mesh.material) {
            // Materials can sometimes be arrays (e.g., if you use different materials for front/sides)
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.dispose());
            } else {
                mesh.material.dispose();
            }
        }
    }
    
    // Empty the tracking array
    activeTextMeshes = [];
    
    // Reset the Y position back to its original starting point
    globalCurrYpos = 1.3; 
}
// ==========================================
// --- VRM LOADER & ANIMATION ---
// ==========================================
let currentVrm = undefined;
let currentMixer = undefined;
let currentAction = null;

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
loader.register((parser) => new VRMAnimationLoaderPlugin(parser)); 

loader.load('/model.vrm', (gltf) => {
    const vrm = gltf.userData.vrm;
    scene.add(vrm.scene);
    currentVrm = vrm;
    vrm.scene.rotation.y = Math.PI; 
    
    
    switchAnimation('/IdleNew.vrma');
  },
  (progress) => console.log('Loading VRM...', 100.0 * (progress.loaded / progress.total), '%'),
  (error) => console.error('VRM Error:', error)
);

function switchAnimation(animationUrl) {
  loader.load(animationUrl, (gltf) => {
      const vrmAnimations = gltf.userData.vrmAnimations;
      
      if (vrmAnimations && vrmAnimations.length > 0) {
        if (!currentMixer) currentMixer = new THREE.AnimationMixer(currentVrm.scene);
        
        const clip = createVRMAnimationClip(vrmAnimations[0], currentVrm);
        const newAction = currentMixer.clipAction(clip);
        const fadeDuration = 0.1;
        
        if (currentAction) currentAction.fadeOut(fadeDuration);
        
        newAction.reset().fadeIn(fadeDuration).play();
        currentAction = newAction;
      }
    },
    undefined, 
    (error) => console.error(`Failed to load ${animationUrl}:`, error)
  );
}
//#endregion
// ==========================================
// --- AUDIO & LIPSYNC (HEADAUDIO) ---
// ==========================================
//#region AUDIO PLAYER
let audioContext = undefined;
let headAudioNode = undefined;
let lipsyncMixer = undefined;
let targetVisemes = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
async function initAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    lipsyncMixer = audioContext.createGain();
    lipsyncMixer.gain.value = 1.0;
  }
  
  if (!headAudioNode) {
    try {
        await audioContext.audioWorklet.addModule('/headworklet.min.mjs');
        headAudioNode = new HeadAudio(audioContext, {});
        await headAudioNode.loadModel('/model-en-mixed.bin'); 
        
        const targetNode = headAudioNode.node || headAudioNode;
        lipsyncMixer.connect(targetNode);
        console.log("✅ Neural Network Lipsync Hooked Up!");
        
        headAudioNode.onvalue = (rawVisemeName, value) => {
          const name = rawVisemeName.replace('viseme_', '');
          
          // ANTI-TWITCH DEADZONE
          // Ignore values under 0.15. This stops the eyelids from fluttering 
          // every time the neural net picks up a tiny breath or background noise.
          let boost = value;
          if (boost < 0.15) {
              boost = 0.0;
          }

          // Explicitly map your model's 13 outputs to the VRM's 5 mouth shapes
          const mapping = {
              'PP': 'aa', 'FF': 'aa',
              'E':  'ee',
              'I':  'ih', 'CH': 'ih', 'SS': 'ih', 'TH': 'ih', 'DD': 'ih', 'nn': 'ih',
              'O':  'oh', 'kk': 'oh', 'RR': 'oh',
              'U':  'ou'
          };

          const targetKey = mapping[name];
          
          if (targetKey) {
              // We use Math.max so if the model rapidly outputs 'I' and 'SS' at the same time,
              // it takes the strongest signal instead of compounding them into a twitch.
              targetVisemes[targetKey] = Math.max(targetVisemes[targetKey] || 0, boost);
          }
        };
    } catch (err) {
        console.error("FATAL: OVR Lipsync Initialization failed!", err);
    }
  }
  
  if (audioContext.state === 'suspended') {
      await audioContext.resume();
  }
}

// ==========================================
// --- AUDIO PLAYBACK & STREAMING ---
// ==========================================
let interruptedSessions = {};
let activeWebSockets = {}; // Keep track of WS to close them if interrupted
let scheduledAudioNodes = []; // Keep track of playing buffers for instant cutoff
async function streamAndPlayAudio(sessionId) {
    currentSessionId = sessionId;
    interruptedSessions[sessionId] = {interrupted: false, chunkId: -1};
    
    
    // 1. Clean up ANY and ALL existing sockets, not just this session's ID
    Object.keys(activeWebSockets).forEach(oldSessionId => {
        console.log(`🧹 Cleaning up orphaned socket for: ${oldSessionId}`);
        activeWebSockets[oldSessionId].close();
        delete activeWebSockets[oldSessionId];
    });
    
    // Stop any previously playing audio immediately
    scheduledAudioNodes.forEach(node => {
        try { 
            node.stop(); 
            node.disconnect();
        } catch (e) {}
    });
    scheduledAudioNodes = [];

    const token = localStorage.getItem('baratrum_auth_token');
    if (!token) {
        console.error("❌ No auth token found in localStorage.");
        return;
    }

    const wsUrl = `${WS_BASE_URL}/ws?token=${encodeURIComponent(token)}&session_id=${encodeURIComponent(sessionId)}`;
    const ws = new WebSocket(wsUrl);
    activeWebSockets[sessionId] = ws;
    
    ws.binaryType = "arraybuffer";

    const SAMPLE_RATE = 24000; 
    let nextPlayTime = audioContext.currentTime;

    ws.onopen = () => {
        console.log(`[WS DEBUG] 🔌 Connected to live audio stream. Session: ${sessionId}`);
    };

   

    ws.onmessage = (event) => {
        // If interrupted mid-stream, terminate the socket and bail out
        if (interruptedSessions[sessionId].interrupted) {
            ws.close();
            return;
        }

        // 1. Handle string messages (Metadata & Control Signals)
        if (typeof event.data === "string") {
            if (event.data === "EOS") {
                console.log(`[WS DEBUG] 🏁 End of stream received for session ${sessionId}`);
                ws.close();
                return;
            }
            
            return;
        }

        // 2. Handle Binary Audio
        if (event.data instanceof ArrayBuffer) {
            const int16Array = new Int16Array(event.data);
            const float32Array = new Float32Array(int16Array.length);
            
            for (let i = 0; i < int16Array.length; i++) {
                float32Array[i] = int16Array[i] / 32768.0;
            }

            const audioBuffer = audioContext.createBuffer(1, float32Array.length, SAMPLE_RATE);
            audioBuffer.getChannelData(0).set(float32Array);

            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            
            source.connect(audioContext.destination);
            if (typeof lipsyncMixer !== 'undefined' && lipsyncMixer) {
                source.connect(lipsyncMixer);
            }

            if (nextPlayTime < audioContext.currentTime) {
                nextPlayTime = audioContext.currentTime + 0.05;
            }


            source.start(nextPlayTime);
            nextPlayTime += audioBuffer.duration;
            
            // Push it into our queue array
            scheduledAudioNodes.push(source);


            
            // --- The onEnded Event ---
            source.onended = () => {
                scheduledAudioNodes.shift();
                interruptedSessions[sessionId].chunkId += 1;
            };
        }

    };

    ws.onerror = (error) => {
        console.error(`[WS DEBUG] ❌ WebSocket error for session ${sessionId}:`, error);
    };

    ws.onclose = () => {
        console.log(`[WS DEBUG] 🔌 WebSocket disconnected. Session: ${sessionId}`);
        delete activeWebSockets[sessionId];
    };
}
//#endregion
// ==========================================
// --- WEBSOCKET & RAW AUDIO PIPELINE ---
// ==========================================
//#region VOICE ACTIVATION
// Global flags and variables
let isAudioPipelineInitialized = false;
let ws = null; 
let interruptTimer = null;
const INTERRUPT_DELAY_MS = 1000;
async function initializeAudioPipeline() {
    // 1. Guard check: Only run this once
    if (isAudioPipelineInitialized) {
        console.log("Audio pipeline already running. Skipping initialization.");
        return;
    }

    try {
        // 2. Request Mic access ONLY after the user logs in
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                sampleRate: 16000,
                channelCount: 1,
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        // 3. Connect the WebSocket with the Auth Token
        const wsUrl = `ws://${API_BASE.replace(/^https?:\/\//, '')}/ws?access_token=${encodeURIComponent(localStorage.getItem('baratrum_auth_token'))}`;
        ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => console.log("WebSocket connected. The pipe is open.");
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.state === "text") {
                let payloadSet = " " + data.message;
                chatInput.value +=  payloadSet;
                console.log("Transcript chunk:", data.message);
                // append to your UI
            } else if (data.state === "session") {
                console.log("LLM Session started:", data.message);
                streamAndPlayAudio(data.message);
            }
        };

        // 4. Setup AudioContext and ScriptProcessor for the continuous raw audio pipe
        // Using window.AudioContext to ensure cross-browser compatibility
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const audioContextMicStream = new AudioContext({ sampleRate: 16000 });
        const source = audioContextMicStream.createMediaStreamSource(stream);
        const processor = audioContextMicStream.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                const inputData = e.inputBuffer.getChannelData(0);
                
                // Convert Float32 to Int16 (Raw PCM)
                const pcm16 = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                    let s = Math.max(-1, Math.min(1, inputData[i]));
                    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }
                
                ws.send(pcm16.buffer); 
            }
        };

        //for echo cancellation or some shit idk
        const gainNode = audioContextMicStream.createGain();
        gainNode.gain.value = 0;
        source.connect(processor);
        processor.connect(gainNode);
        gainNode.connect(audioContextMicStream.destination);
        
        let isSpeechRunning = false;
        let readyForNextChunk = 0; 

        const myvad = await vad.MicVAD.new({
            stream: stream, 
            model: "v5",
            
            // Drastically higher thresholds. 
            positiveSpeechThreshold: 0.65, 
            negativeSpeechThreshold: 0.55, 
            minSpeechFrames: 4, 
            preSpeechPadFrames: 75, 
            redemptionFrames: 25, 

            onSpeechStart: () => {
                console.log("Speech start detected.");
                isSpeechRunning = true;
                readyForNextChunk = 0; 
                const newSessionId = crypto.randomUUID(); 
                const sessionToInterrupt = currentSessionId;
                currentSessionId = newSessionId;
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ 
                        action: "speech_start", 
                        session_id: newSessionId 
                    }));
                }
                if (sessionToInterrupt) {
                    console.log(`Starting ${INTERRUPT_DELAY_MS}ms interrupt timer for old session: ${sessionToInterrupt}`);
                    interruptTimer = setTimeout(() => {
                        console.log(`Firing interrupt!`);
                        triggerInterrupt(sessionToInterrupt);
                        interruptTimer = null;
                    }, INTERRUPT_DELAY_MS);
                }
            },

            onFrameProcessed: (probabilities) => {
                if (isSpeechRunning) {
                    if (probabilities.isSpeech > 0.65) {
                        readyForNextChunk = 0;
                    }
                    else if (probabilities.isSpeech < 0.65 && probabilities.notSpeech > 0.65) {
                        if (readyForNextChunk >= 0) {
                            readyForNextChunk++;
                            if (readyForNextChunk === 15) {
                                console.log("Mid-speech dip (15 frames) detected. Sending 'speech_chunk'.");
                                
                                if (ws && ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({action: "speech_chunk"}));
                                }
                                
                                readyForNextChunk = -1; 
                            }
                        }
                    }
                }
            },

            onVADMisfire: () => {
                console.log("VAD misfire detected. Telling backend to dump the buffer.");
                isSpeechRunning = false; 
                
                // Kill the interrupt timer before it fires!
                if (interruptTimer) {
                    clearTimeout(interruptTimer);
                    interruptTimer = null;
                    console.log("Interrupt cancelled because it was a misfire.");
                }

                if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({action: "misfire"}));
                }
            },

            onSpeechEnd: () => {
                console.log("Valid speech ended. Sending 'speech_end'.");
                isSpeechRunning = false; 
                
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({action: "speech_end"}));
                }
            },
            
            onnxWASMBasePath: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/",
            baseAssetPath: "https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.29/dist/",
        });

        myvad.start();
        isAudioPipelineInitialized = true;

    } catch (err) {
        console.error("Failed to initialize audio pipeline. Ensure microphone permissions are granted.", err);
    }
}
//#endregion
//#region ANIMATE LOOP
// ==========================================
// --- MAIN ANIMATION LOOP ---
// ==========================================
const clock = new THREE.Clock();
let currentVisemes = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
let nextBlinkTime = 0;
let isBlinking = false;
let blinkStartTime = 0;
const blinkDuration = 0.15;
const gazeProxy = new THREE.Object3D(); 
scene.add(gazeProxy);
const tempV3 = new THREE.Vector3(); 
const GAZE_SMOOTHING = 10; 
let gazeState = 'looking'; 
let gazeTimer = 0;
const distractionPoint = new THREE.Object3D();
distractionPoint.position.set(0.5, 0.5, 0); 
scene.add(distractionPoint);

function animate() {
  //requestAnimationFrame(animate);
  
  const deltaTime = clock.getDelta();
  const time = clock.elapsedTime; 

  if (currentMixer) currentMixer.update(deltaTime); 
  if (headAudioNode) headAudioNode.update(deltaTime * 1000); 

  if (currentVrm) {
    for (const key in targetVisemes) {
      if (currentVisemes[key] === undefined) currentVisemes[key] = 0;
      targetVisemes[key] = Math.max(0, targetVisemes[key] - (deltaTime * 10.0));
      currentVisemes[key] += (targetVisemes[key] - currentVisemes[key]) * 25.0 * deltaTime;
      currentVisemes[key] = Math.max(0, Math.min(1.0, currentVisemes[key]));

      if (currentVrm.expressionManager) {
        currentVrm.expressionManager.setValue(key, currentVisemes[key]);
        const legacy = { aa: 'a', ih: 'i', ou: 'u', ee: 'e', oh: 'o' }[key];
        if (legacy) currentVrm.expressionManager.setValue(legacy, currentVisemes[key]);
      }
    }

    // Set your resting eyelid level. 
    // Tweak this until the resting eyes match the position they snap to when she says "aa" or "ih".
    const BASE_SQUINT = 0.15; 

    if (!isBlinking && time > nextBlinkTime) {
        isBlinking = true;
        blinkStartTime = time;
        nextBlinkTime = time + 2.0 + Math.random() * 4.0;
    }

    if (isBlinking) {
        const elapsedBlinkTime = time - blinkStartTime;
        if (elapsedBlinkTime < blinkDuration) {
            // rawBlink goes 0.0 -> 1.0 -> 0.0
            const rawBlink = Math.sin((elapsedBlinkTime / blinkDuration) * Math.PI);
            
            // Compress the math so the blink starts at BASE_SQUINT, peaks at 1.0 (fully closed), and returns to BASE_SQUINT
            const blinkValue = BASE_SQUINT + (rawBlink * (1.0 - BASE_SQUINT));
            currentVrm.expressionManager.setValue('blink', blinkValue);
        } else {
            isBlinking = false;
            currentVrm.expressionManager.setValue('blink', BASE_SQUINT); 
        }
    } else {
        // Enforce the resting state whenever she is not actively blinking
        currentVrm.expressionManager.setValue('blink', BASE_SQUINT);
    }

    gazeTimer -= deltaTime;
    if (gazeTimer <= 0) {
      if (gazeState === 'steady') {
        gazeState = 'shy';
        gazeTimer = 1.5 + Math.random() * 2;
      } else {
        gazeState = 'steady';
        gazeTimer = 4.0 + Math.random() * 6;
      }
    }
    
    const targetGoal = (gazeState === 'steady') ? camera : distractionPoint;
    targetGoal.getWorldPosition(tempV3);
    gazeProxy.position.lerp(tempV3, GAZE_SMOOTHING * deltaTime);
    currentVrm.lookAt.target = gazeProxy;
    
    const expressionManager = currentVrm.expressionManager;
    const currentRelaxed = expressionManager.getValue('relaxed') || 0;
    const currentHappy = expressionManager.getValue('happy') || 0;
    const currentSurprised = expressionManager.getValue('surprised') || 0;
    
    if (gazeState === 'shy') {
        expressionManager.setValue('relaxed', THREE.MathUtils.lerp(currentRelaxed, 0.1, deltaTime * 2.0));
        expressionManager.setValue('happy', THREE.MathUtils.lerp(currentHappy, 0.01, deltaTime * 2.0));
        expressionManager.setValue('surprised', THREE.MathUtils.lerp(currentSurprised, 0, deltaTime * 2.0));
    } else {
        expressionManager.setValue('relaxed', THREE.MathUtils.lerp(currentRelaxed, 0, deltaTime * 2.0));
        expressionManager.setValue('happy', THREE.MathUtils.lerp(currentHappy, 0, deltaTime * 2.0));
    }
    
    currentVrm.update(deltaTime); 
  }

  renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);
//#endregion
//#region EVENT LISTENERS
// ==========================================
// --- UI & EVENT LISTENERS ---
// ==========================================
const animationSelect = document.getElementById('animationSelect');
if (animationSelect) {
  animationSelect.addEventListener('change', (event) => {
    if (currentVrm) switchAnimation(event.target.value);
  });
}

const remSleepBtn = document.getElementById('remSleepBtn');
if (remSleepBtn) {
  remSleepBtn.addEventListener('click', async () => {
    remSleepBtn.disabled = true;
    remSleepBtn.innerText = "Processing...";
    try {
      await fetch(`${API_BASE}/api/rem-sleep`, { method: 'POST', headers: getAuthHeaders() });
    } finally {
      remSleepBtn.disabled = false;
      remSleepBtn.innerText = "REM Sleep";
      updateTokenDisplay();
    }
  });
}
// 1. Create a standalone function for sending
async function sendChatMessage() {
    await initAudio(); 
    const text = chatInput.value;
    if (!text) return;

    chatInput.disabled = true;
    chatInput.placeholder = "Thinking...";

    try {
        const response = await fetch(`${API_BASE}/api/chat`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ text })
        });
        const data = await response.json();
        
        if (data.status === "success") streamAndPlayAudio(data.session_id);
    } catch (err) {
        console.error("API Error:", err);
    } finally {
        chatInput.disabled = false;
        chatInput.value = "";
        chatInput.placeholder = "Type a message...";
        updateTokenDisplay();
    }
}

// 2. Attach it to the button (for regular non-VR mode)
const sendBtn = document.getElementById('sendBtn');
if (sendBtn) {
    sendBtn.addEventListener('click', sendChatMessage);
}
//#endregion

//#region INTERRUPT
async function triggerInterrupt(sessionIdToKill) {
    if (!sessionIdToKill) {
        console.log("No active session to interrupt.");
        return;
    }

    console.log(`⚠️ Interrupting session ${sessionIdToKill}`);
    if(interruptedSessions[sessionIdToKill] != null)
    {
        interruptedSessions[sessionIdToKill].interrupted = true;
    }
    else{
        interruptedSessions[sessionIdToKill] = {
            interrupted : true,
            chunkId : -1
        }
    }
    
    // 1. Actively kill the WebSocket immediately so no more data arrives
    if (activeWebSockets[sessionIdToKill]) {
        activeWebSockets[sessionIdToKill].close();
        delete activeWebSockets[sessionIdToKill];
    }

    // 2. Stop AND disconnect all scheduled audio nodes to prevent ghost buffering
    scheduledAudioNodes.forEach(node => {
        try {
            node.stop();
            node.disconnect(); // Fully detach from the audio graph
        } catch (e) {}
    });
    scheduledAudioNodes = []; // Empty the array!

    targetVisemes = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };

    try {
        await fetch(`${API_BASE}/api/interrupt`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ 
                session_id: sessionIdToKill, 
                chunkID: interruptedSessions[sessionIdToKill].chunkId != null ? interruptedSessions[sessionIdToKill].chunkId : 0
            })
        });
    } catch (err) {
        console.error("Failed to send interrupt:", err);
    }
}
//#endregion

//#region AUTH

window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});

// ==========================================
// --- AUTH & INITIALIZATION ---
// ==========================================
let isLoginMode = true;
let authToken = localStorage.getItem('baratrum_auth_token') || null;
let refreshToken = localStorage.getItem('baratrum_refresh_token') || null;
let tokenExpiresAt = localStorage.getItem('baratrum_token_expires_at') || null;
let refreshTimeoutId = null;

const authWrapper = document.getElementById('auth-wrapper');
const uiWrapper = document.getElementById('ui-wrapper');
const tokenCnt = document.getElementById('tokenCnt');
const authTitle = document.getElementById('authTitle');
const authForm = document.getElementById('authForm');
const submitAuthBtn = document.getElementById('submitAuthBtn');
const toggleAuthModeBtn = document.getElementById('toggleAuthModeBtn');
const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');

function getAuthHeaders(includeJsonContentType = true) {
    const headers = { 'Authorization': `Bearer ${authToken}` };
    if (includeJsonContentType) {
        headers['Content-Type'] = 'application/json';
    }
    return headers;
}

// For file uploads — never send Content-Type, browser sets the boundary
function getMultipartAuthHeaders() {
    return { 'Authorization': `Bearer ${authToken}` };
}

//HELPER
async function updateTokenDisplay() {
    const display = document.getElementById('tokenCnt');
    if (!display) return;

    try {
        const tokenResponse = await fetch(`${API_BASE}/short-term-memory-token-count`, { headers: getAuthHeaders(false) });
        const longTokenResponse = await fetch(`${API_BASE}/long-term-memory-token-count`, { headers: getAuthHeaders(false) });
        const balanceResponse = await fetch(`${API_BASE}/balance`, { headers: getAuthHeaders(false) });
        if (balanceResponse.status === 401) {
            lockApplication();
            return;
        }
        const balanceData = await balanceResponse.json();
        const tokenData = await tokenResponse.json();
        const longTokenData = await longTokenResponse.json();
        const count = tokenData.tokenCount;
        const countLong = longTokenData.tokenCount;
        
        display.value = `Short term memory token count: ${count.toLocaleString()} tokens`;
        display.className = ''; 

        if (count > 50000) {
            display.classList.add('status-critical');
            display.value += " - Responses will be much slower.";
        } else if (count > 30000) {
            display.style.color = '#ff4d4d'; 
            display.value += " - Memory is getting bloated !";
        } else if (count > 10000) {
            display.style.color = '#ffa500'; 
            display.value += " - rem sleep should be called";
        } else if (count > 4000) {
            display.style.color = '#ffff00'; 
        } else {
            display.style.color = 'white'; 
        }
        display.value += ` Long term memory token count ${countLong.toLocaleString()}`

    } catch (err) {
        console.error("Failed to fetch tokens:", err);
    }
}



function unlockApplication() {
    authWrapper.classList.add('hidden');
    uiWrapper.classList.remove('hidden');
    tokenCnt.classList.remove('hidden');
    
    updateTokenDisplay();
    scheduleTokenRefresh(); // Start the timer when the app unlocks
    initializeAudioPipeline();
    initAudio();
    loadUserLanguage();
    document.getElementById('languageSelect').addEventListener('change', updateLanguage);
}

function lockApplication() {
    authToken = null;
    refreshToken = null;
    tokenExpiresAt = null;
    
    if (refreshTimeoutId) clearTimeout(refreshTimeoutId);

    localStorage.removeItem('baratrum_auth_token');
    localStorage.removeItem('baratrum_refresh_token');
    localStorage.removeItem('baratrum_token_expires_at');

    uiWrapper.classList.add('hidden');
    tokenCnt.classList.add('hidden');
    authWrapper.classList.remove('hidden');

    
    
    console.log("🔒 Application locked. Please log in again.");
}


if (authToken && tokenExpiresAt > Date.now()) {
    unlockApplication();
    updateTokenDisplay();
} else if (authToken && tokenExpiresAt < Date.now()) {
    lockApplication(); 
}
else{
    lockApplication();
}


//#endregion



authForm.addEventListener('submit', async (e) => {
    e.preventDefault(); // Good practice to prevent any native form submissionsRq
    
    const email = emailInput.value;
    const password = passwordInput.value;
    const endpoint = isLoginMode ? '/login' : '/api/Auth/register'; 
    
    submitAuthBtn.disabled = true;
    submitAuthBtn.innerText = "Processing...";

    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if (isLoginMode) {
                authToken = data.accessToken; 
                refreshToken = data.refreshToken;
                // Convert expiresIn (seconds) to absolute milliseconds timestamp
                tokenExpiresAt = Date.now() + (data.expiresIn * 1000);

                localStorage.setItem('baratrum_auth_token', authToken);
                localStorage.setItem('baratrum_refresh_token', refreshToken);
                localStorage.setItem('baratrum_token_expires_at', tokenExpiresAt);
                
                unlockApplication();
            } else {
                alert("Registration successful! Please check your email to confirm your account before logging in.");
                toggleAuthModeBtn.click(); 
                passwordInput.value = ''; 
            }
        } else {
            if (data.detail) alert(data.detail);
            else if (data.title) alert(data.title);
            else alert("Authentication failed. Please check your credentials.");
        }
    } catch (err) {
        console.error("Auth API Error:", err);
        alert("Failed to connect to server.");
    } finally {
        submitAuthBtn.disabled = false;
        submitAuthBtn.innerText = isLoginMode ? "Login" : "Register";
    }
});

toggleAuthModeBtn.addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    authTitle.innerText = isLoginMode ? "Login" : "Register";
    submitAuthBtn.innerText = isLoginMode ? "Login" : "Register";
    toggleAuthModeBtn.innerText = isLoginMode ? "Need an account? Register" : "Already have an account? Login";
});
async function autoLoginLocal() {
    const email = "LOCAL@LOCAL.com";
    const password = "TESTtest123*-";

    try {
        // 1. Register — 400 on production or if user exists, ignored
        await fetch(`${API_BASE}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        // 2. Initialise (confirm email + starting balance) — 404 on production, ignored
        await fetch(`${API_BASE}/init-local-user`, {
            method: 'POST'
        });

        // 3. Login — only succeeds on a real local install
        const response = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
            authToken = data.accessToken;
            refreshToken = data.refreshToken;
            tokenExpiresAt = Date.now() + (data.expiresIn * 1000);

            localStorage.setItem('baratrum_auth_token', authToken);
            localStorage.setItem('baratrum_refresh_token', refreshToken);
            localStorage.setItem('baratrum_token_expires_at', tokenExpiresAt);

            unlockApplication();
        }
    } catch (err) {
        console.error("Local auto-login error:", err);
    }
}

function scheduleTokenRefresh() {
    if (refreshTimeoutId) clearTimeout(refreshTimeoutId);
    if (!tokenExpiresAt || !refreshToken) return;

    // Calculate time remaining minus a 60-second safety buffer
    const timeUntilRefresh = tokenExpiresAt - Date.now() - (60 * 1000);

    if (timeUntilRefresh <= 0) {
        // If we are already within the 1-minute window (or expired), refresh immediately
        executeTokenRefresh();
    } else {
        refreshTimeoutId = setTimeout(executeTokenRefresh, timeUntilRefresh);
    }
}

async function executeTokenRefresh() {
    console.log("🔄 Attempting to refresh access token...");
    try {
        // .NET Identity expects a simple JSON body with the refreshToken
        const response = await fetch(`${API_BASE}/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: refreshToken })
        });

        if (!response.ok) throw new Error("Refresh token invalid or expired.");

        const data = await response.json();
        
        authToken = data.accessToken;
        refreshToken = data.refreshToken;
        tokenExpiresAt = Date.now() + (data.expiresIn * 1000);

        localStorage.setItem('baratrum_auth_token', authToken);
        localStorage.setItem('baratrum_refresh_token', refreshToken);
        localStorage.setItem('baratrum_token_expires_at', tokenExpiresAt);

        scheduleTokenRefresh(); // Schedule the next one
    } catch (err) {
        lockApplication();
    }
}


//#region unrelated shit

// ==========================================
// --- TOKEN MODAL LOGIC ---
// ==========================================
const tokenModal = document.getElementById('tokenModal');
//const addTokensBtn = document.getElementById('addTokensBtn');
const closeModal = document.getElementById('closeModal');

addTokensBtn.addEventListener('click', () => {
    tokenModal.classList.remove('hidden');
});

closeModal.addEventListener('click', () => {
    tokenModal.classList.add('hidden');
});





// Add your actual addresses here



const vrBtn = document.getElementById('vr-btn');
if (vrBtn) {
  console.log("GREPME: vrBtn found in DOM.");
  if ('xr' in navigator) {
    console.log("GREPME: navigator.xr exists. Checking immersive-vr support...");
    navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
      console.log(`GREPME: isSessionSupported returned: ${supported}`);
      if (supported) {
        vrBtn.addEventListener('click', async () => {
          
          if (renderer.xr.isPresenting) {
            renderer.xr.getSession()?.end();
            vrBtn.innerText = "ENTER VR";
            return;
          }
          
          try {
            const session = await navigator.xr.requestSession('immersive-vr');
            
            renderer.xr.setSession(session);
            renderer.xr.setReferenceSpaceType('local');
            
            vrBtn.innerText = "EXIT VR";
            
            session.addEventListener('end', () => {
              vrBtn.innerText = "ENTER VR";
            });
          } catch (err) {
          }
        });
      } else {
        vrBtn.innerText = "VR UNAVAILABLE";
        vrBtn.style.opacity = "0.5";
        vrBtn.disabled = true;
      }
    }).catch((err) => {
      console.error("GREPME: isSessionSupported threw an exception ->", err);
    });
  } else {
    vrBtn.style.display = "none";
  }
}
async function loadUserLanguage() {
    try {
        const response = await fetch(`${API_BASE}/api/get-language`,{headers: getAuthHeaders() });
        if (response.ok) {
            const langCode = await response.text();
            const selectBox = document.getElementById("languageSelect");
            selectBox.value = langCode;
        }
    } catch (error) {
        console.error('Error fetching language:', error);
    }
}
async function updateLanguage() {
        const selectBox = document.getElementById("languageSelect");
        const lang = selectBox.value;

        if (!lang) return;

        await fetch(`${API_BASE}/api/set-language?language=${lang}`, {
            method: 'POST', 
            headers: getAuthHeaders() 
        });
        
    }
//#endregion

// Export memories
document.getElementById('exportMemoriesBtn').addEventListener('click', async () => {
    try {
        const response = await fetch(`${API_BASE}/api/export-memories`, {
            method: 'GET',
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(err || 'Export failed');
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `memories_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);

    } catch (e) {
        alert('Export failed: ' + e.message);
    }
});
// Open file dialog when Import is clicked
document.getElementById('importMemoriesBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
});

// Handle the selected file
document.getElementById('importFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById('importStatus');
    statusEl.textContent = 'Importing...';
    statusEl.style.color = '#aaa';

    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch(`${API_BASE}/api/import-memories`, {
            method: 'POST',
            headers: getMultipartAuthHeaders(),
            body: formData
        });

        if (!response.ok) throw new Error(await response.text());

        const result = await response.json();

        // Auto-download the backup that was returned
        if (result.backedUpMemories) {
            const backupBlob = new Blob(
                [JSON.stringify(result.backedUpMemories, null, 2)],
                { type: 'application/json' }
            );
            const url = URL.createObjectURL(backupBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `memories_backup_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'')}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }

        statusEl.textContent = 'Import successful! Old memories backed up.';
        statusEl.style.color = '#4caf50';
        e.target.value = '';

    } catch (err) {
        statusEl.textContent = 'Import failed: ' + err.message;
        statusEl.style.color = '#f44336';
    }
});
autoLoginLocal();