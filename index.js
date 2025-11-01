import Matter from 'matter-js';
import * as faceapi from 'face-api.js';

// --- Matter.js module aliases ---
const { Engine, Render, Runner, World, Bodies, Composite, Composites, Constraint, Mouse, MouseConstraint } = Matter;

const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';

// --- DOM Elements ---
const gameContainer = document.getElementById('game-container');
const characterContainer = document.getElementById('character-container');
const humanImage = document.getElementById('human');
const canvas = document.getElementById('hair-canvas');
const loadingOverlay = document.getElementById('loading-overlay');

// --- Physics setup ---
let engine;
let renderer;
let runner;
let mouseConstraint;
let hairComposite;

async function loadModels() {
    try {
        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL), // Use a more robust model
            faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL) // Use the corresponding landmark model
        ]);
    } catch (error) {
        console.error("Error loading face-api models:", error);
        loadingOverlay.innerText = "Error loading AI models. Please refresh.";
    }
}

async function getScalpPoints() {
    // Using SsdMobilenetv1Options now
    const detections = await faceapi.detectSingleFace(humanImage, new faceapi.SsdMobilenetv1Options()).withFaceLandmarks();

    const containerRect = characterContainer.getBoundingClientRect();
    const scalpPoints = [];

    if (detections) {
        console.log("Face detected!");
        const box = detections.detection.box;

        // Image has different dimensions than its display size, so we need to scale the detection box
        const scaleX = containerRect.width / humanImage.naturalWidth;
        const scaleY = containerRect.height / humanImage.naturalHeight;

        // Use the top of the detected face box as the scalp line
        // Add a small negative offset to place hair slightly inside the head outline
        const scalpTop = box.top * scaleY - 5;
        const scalpWidth = box.width * scaleX * 0.8; // Use 80% of the face width for hair
        const startX = box.x * scaleX + (box.width * scaleX * 0.1); // Center the hair area
        const endX = startX + scalpWidth;
        const numStrands = 15;
        const strandSpacing = scalpWidth / (numStrands - 1);

        for (let i = 0; i < numStrands; i++) {
            const x = startX + (i * strandSpacing);
            scalpPoints.push({ x, y: scalpTop });
        }

    } else {
        console.warn("No face detected. Falling back to percentage-based positioning.");
        // Fallback for when face detection fails
        const scalpTop = containerRect.height * 0.2; // 20% from the top
        const scalpWidth = containerRect.width * 0.5; // 50% of the width
        const startX = (containerRect.width - scalpWidth) / 2;
        const endX = startX + scalpWidth;
        const numStrands = 15;
        const strandSpacing = scalpWidth / (numStrands - 1);

        for (let i = 0; i < numStrands; i++) {
            const x = startX + (i * strandSpacing);
            scalpPoints.push({ x, y: scalpTop });
        }
    }

    return scalpPoints;
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
        Composite.clear(hairComposite, false); // Clear existing hair
    } else {
        hairComposite = Composite.create();
        World.add(engine.world, hairComposite);
    }

    if (!scalpPoints || scalpPoints.length === 0) {
        console.error("Scalp points not available for hair creation.");
        return;
    }

    const group = 1; // Bodies in the same group do not collide
    const hairSegments = 10;
    const segmentSize = 2;
    const hairColor = '#3a2411';
    
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
    const scalpPoints = await getScalpPoints();
    createHair(scalpPoints);
    
    // Resume engine
    Runner.run(runner, engine);
}


// --- Initialization ---
async function initializeApp() {
    await loadModels();
    loadingOverlay.style.display = 'none';

    // Wait for the character image to load to ensure container has correct dimensions
    if (!humanImage.complete) {
        humanImage.onload = start;
    } else {
        start();
    }

    async function start() {
        const scalpPoints = await getScalpPoints();
        setupPhysics(scalpPoints);
    }
}

window.addEventListener('load', initializeApp);
window.addEventListener('resize', handleResize);