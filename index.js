import Matter from 'matter-js';
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// --- Matter.js module aliases ---
const { Engine, Render, Runner, World, Bodies, Composite, Composites, Constraint, Mouse, MouseConstraint } = Matter;

// --- DOM Elements ---
const gameContainer = document.getElementById('game-container');
const characterContainer = document.getElementById('character-container');
const humanImage = document.getElementById('human');
const canvas = document.getElementById('hair-canvas');

// --- Physics setup ---
let engine;
let renderer;
let runner;
let mouseConstraint;
let hairComposite;

// --- MediaPipe setup ---
let faceLandmarker;

// Scalp landmark indices from MediaPipe FaceLandmarker
const SCALP_LANDMARK_INDICES = [103, 67, 109, 10, 338, 297, 332, 284, 293, 296];

async function detectScalp() {
    // Wait for the image to be fully loaded and have dimensions
    if (!humanImage.complete || humanImage.naturalWidth === 0) {
        await new Promise(resolve => humanImage.onload = resolve);
    }
    
    if (!faceLandmarker) {
        const filesetResolver = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
                delegate: "GPU"
            },
            outputFaceBlendshapes: false,
            runningMode: "IMAGE",
            numFaces: 1
        });
    }

    const results = faceLandmarker.detect(humanImage);

    if (results.faceLandmarks && results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        const containerRect = characterContainer.getBoundingClientRect();

        // Map normalized landmark coordinates to the container's coordinate space
        const scalpCoords = SCALP_LANDMARK_INDICES.map(i => ({
            x: landmarks[i].x * containerRect.width,
            y: landmarks[i].y * containerRect.height
        }));

        // Sort points from left to right to ensure hair is generated in order
        scalpCoords.sort((a, b) => a.x - b.x);

        return scalpCoords;
    }
    return null; // No face found
}


function setupPhysics(scalpPoints) {
    // --- Engine and World ---
    engine = Engine.create();
    engine.world.gravity.y = 0.6; // Softer gravity for hair

    // --- Renderer ---
    // Ensure the canvas is sized correctly relative to the character container
    const containerRect = characterContainer.getBoundingClientRect();
    canvas.width = containerRect.width;
    canvas.height = containerRect.height;

    renderer = Render.create({
        canvas: canvas,
        engine: engine,
        options: {
            width: canvas.width,
            height: canvas.height,
            wireframes: false, // We want to see colored hair
            background: 'transparent'
        }
    });
    
    // --- Mouse for interaction ---
    const mouse = Mouse.create(renderer.canvas);
    mouse.element.removeEventListener("mousewheel", mouse.mousewheel);
    mouse.element.removeEventListener("DOMMouseScroll", mouse.mousewheel);
    
    // We need to change the pointer-events so the mouse can interact.
    renderer.canvas.style.pointerEvents = 'auto';

    mouseConstraint = MouseConstraint.create(engine, {
        mouse: mouse,
        constraint: {
            stiffness: 0.1,
            render: {
                visible: false
            }
        }
    });
    World.add(engine.world, mouseConstraint);

    // --- Hair creation ---
    createHair(scalpPoints);

    // --- Start simulation ---
    Render.run(renderer);
    runner = Runner.create();
    Runner.run(runner, engine);
}

function createHair(scalpPoints) {
    if (hairComposite) {
        World.remove(engine.world, hairComposite);
    }

    const group = 1; // Bodies in the same group do not collide
    const hairSegments = 10;
    const segmentSize = 2;
    const hairColor = '#3a2411';

    hairComposite = Composite.create();
    
    if (!scalpPoints) {
        console.error("Scalp points not available for hair creation.");
        // Fallback to old method if detection fails
        const scalpTop = renderer.options.height * 0.2;
        const scalpWidth = renderer.options.width * 0.45;
        const scalpX = renderer.options.width / 2;
        const strandSpacing = renderer.options.width / 15;
        scalpPoints = [];
        for (let x = scalpX - scalpWidth / 2; x < scalpX + scalpWidth / 2; x += strandSpacing) {
            scalpPoints.push({x: x, y: scalpTop});
        }
    }

    scalpPoints.forEach(point => {
        const strand = Composites.stack(point.x, point.y, 1, hairSegments, 0, 0, (x, y) => {
            return Bodies.circle(x, y, segmentSize, {
                collisionFilter: { group: group },
                render: { fillStyle: hairColor }
            });
        });

        Composites.chain(strand, 0.5, 0, -0.5, 0, {
            stiffness: 0.9,
            length: 1,
            render: { type: 'line', visible: false }
        });
        
        // Pin the first segment of the strand to the "scalp"
        const firstSegment = strand.bodies[0];
        const pin = Constraint.create({
            pointA: { x: firstSegment.position.x, y: firstSegment.position.y },
            bodyB: firstSegment,
            stiffness: 1
        });

        Composite.add(hairComposite, [strand, pin]);
    });

    World.add(engine.world, hairComposite);
}


async function handleResize() {
    if (!renderer || !engine) return;

    // Temporarily pause the engine to avoid weird physics during resize
    Runner.stop(runner);

    const containerRect = characterContainer.getBoundingClientRect();
    
    // Update render bounds
    renderer.bounds.max.x = containerRect.width;
    renderer.bounds.max.y = containerRect.height;

    // Update canvas size
    renderer.options.width = containerRect.width;
    renderer.options.height = containerRect.height;
    renderer.canvas.width = containerRect.width;
    renderer.canvas.height = containerRect.height;
    
    // Re-detect scalp and recreate hair for the new size
    const scalpPoints = await detectScalp();
    createHair(scalpPoints);
    
    // Resume engine
    Runner.run(runner, engine);
}


// --- Initialization ---
async function initializeApp() {
    try {
        const scalpPoints = await detectScalp();
        if (scalpPoints) {
            setupPhysics(scalpPoints);
        } else {
            console.error("Could not detect face landmarks. Using fallback hair placement.");
            // Setup with fallback hair if detection fails
            setupPhysics(null);
        }
    } catch (error) {
        console.error("Initialization failed:", error);
        // Fallback if Mediapipe fails to load or run
        setupPhysics(null);
    }
}

initializeApp();
window.addEventListener('resize', handleResize);