import Matter from 'matter-js';

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

function setupPhysics() {
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
    createHair();

    // --- Start simulation ---
    Render.run(renderer);
    runner = Runner.create();
    Runner.run(runner, engine);
}

function createHair() {
    if (hairComposite) {
        World.remove(engine.world, hairComposite);
    }

    const group = 1; // Bodies in the same group do not collide
    const hairSegments = 10;
    const segmentSize = 2;
    const strandSpacing = renderer.options.width / 15;
    const hairColor = '#3a2411';

    hairComposite = Composite.create();

    // Define the scalp area based on canvas size
    const scalpTop = renderer.options.height * 0.2;
    const scalpWidth = renderer.options.width * 0.45;
    const scalpX = renderer.options.width / 2;

    for (let x = scalpX - scalpWidth / 2; x < scalpX + scalpWidth / 2; x += strandSpacing) {
        const strand = Composites.stack(x, scalpTop, 1, hairSegments, 0, 0, (x, y) => {
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
    }

    World.add(engine.world, hairComposite);
}


function handleResize() {
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
    
    // Recreate hair for the new size
    createHair();
    
    // Resume engine
    Runner.run(runner, engine);
}


// --- Event Listeners ---
// Wait for the character image to load to get its dimensions
if (humanImage.complete) {
    setupPhysics();
} else {
    humanImage.onload = setupPhysics;
}

window.addEventListener('resize', handleResize);